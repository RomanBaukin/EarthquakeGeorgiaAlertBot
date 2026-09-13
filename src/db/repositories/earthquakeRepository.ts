import type { Selectable } from "kysely";
import type { ParsedEarthquake } from "../../scraper/types";
import type { Db } from "../client";
import type { EarthquakeEventTable } from "../schema";

export type EarthquakeRow = Selectable<EarthquakeEventTable>;

export async function insertIfNew(db: Db, event: ParsedEarthquake): Promise<boolean> {
  const inserted = await db
    .insertInto("earthquake_event")
    .values({
      dedupe_key: event.dedupeKey,
      source_time_raw: event.sourceTimeRaw,
      source_time: event.sourceTime,
      magnitude: event.magnitude,
      depth_km: event.depthKm,
      latitude: event.latitude,
      longitude: event.longitude,
      coordinates_raw: event.coordinatesRaw,
      region: event.region,
      notified_at: null,
      retracted_at: null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();

  return inserted !== undefined;
}

export async function listRecent(db: Db, limit: number): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("retracted_at", "is", null)
    .orderBy("source_time", "desc")
    .limit(limit)
    .execute();
}

export async function listSince(db: Db, sinceIso: string): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("retracted_at", "is", null)
    .where("source_time", ">=", sinceIso)
    .orderBy("source_time", "desc")
    .execute();
}

export async function listPendingAlerts(db: Db, limit: number): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("retracted_at", "is", null)
    .where("notified_at", "is", null)
    .orderBy("source_time", "asc")
    .limit(limit)
    .execute();
}

// Окно сверки со страницей. Отозванные строки отсюда не исключаются, хотя из всех
// остальных списков исключены: источник переиздаёт событие и через несколько минут
// после того, как убрал его со страницы, и лечь такая ревизия обязана на прежнюю
// строку. Иначе переиздание выглядит новым событием и о том же толчке уходит второй
// алерт — 12.09.2026 id:588971 отозван в 20:40, id:588972 выложен в 20:43.
export async function listWindow(db: Db, sinceIso: string): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("source_time", ">=", sinceIso)
    .orderBy("source_time", "desc")
    .execute();
}

// Приводит строку к тому, что сейчас показывает источник. Перезаписывает и
// dedupe_key: у переизданного события он другой, а у просто поправленного — тот же,
// и повторная запись прежнего значения безвредна. notified_at сознательно не
// трогается: ревизия — это тот же толчок, повторный алерт о нём и есть та проблема,
// ради которой сверка написана. Зато retracted_at снимается: раз источник показывает
// строку, она не отозвана. Возврат идёт той же записью, что и обновление полей, —
// транзакций в D1 нет, и разваливаться между «обновил» и «вернул» тут нечему.
export async function applyEventUpdate(db: Db, id: number, event: ParsedEarthquake): Promise<void> {
  await db
    .updateTable("earthquake_event")
    .set({
      retracted_at: null,
      dedupe_key: event.dedupeKey,
      source_time_raw: event.sourceTimeRaw,
      source_time: event.sourceTime,
      magnitude: event.magnitude,
      depth_km: event.depthKm,
      latitude: event.latitude,
      longitude: event.longitude,
      coordinates_raw: event.coordinatesRaw,
      region: event.region,
    })
    .where("id", "=", id)
    .execute();
}

export async function markRetracted(db: Db, id: number): Promise<void> {
  await db
    .updateTable("earthquake_event")
    .set({ retracted_at: new Date().toISOString() })
    .where("id", "=", id)
    .execute();
}

export async function markNotified(db: Db, id: number): Promise<void> {
  await db
    .updateTable("earthquake_event")
    .set({ notified_at: new Date().toISOString() })
    .where("id", "=", id)
    .execute();
}

export async function markAllPendingNotified(db: Db): Promise<void> {
  await db
    .updateTable("earthquake_event")
    .set({ notified_at: new Date().toISOString() })
    .where("notified_at", "is", null)
    .execute();
}

export async function countEvents(db: Db): Promise<number> {
  const row = await db
    .selectFrom("earthquake_event")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .executeTakeFirstOrThrow();

  return Number(row.total);
}
