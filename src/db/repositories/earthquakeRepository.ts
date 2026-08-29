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
    .orderBy("source_time", "desc")
    .limit(limit)
    .execute();
}

export async function listSince(db: Db, sinceIso: string): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("source_time", ">=", sinceIso)
    .orderBy("source_time", "desc")
    .execute();
}

export async function listPendingAlerts(db: Db, limit: number): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("notified_at", "is", null)
    .orderBy("source_time", "asc")
    .limit(limit)
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
