// Репозитории — единственный слой, который нельзя проверить чистой функцией: его
// поведение определяется сгенерированным SQL и схемой. Именно здесь мажорный апгрейд
// kysely или смена схемы ломает всё молча, без ошибок типов.
//
// Тесты гоняют настоящие функции репозиториев против настоящей SQLite (node:sqlite)
// через шим, повторяющий контракт D1: kysely-d1 дёргает только
// `prepare(sql).bind(...params).all()` и читает `results` и `meta`. Полноценный
// Workers-рантайм ради этого не нужен, а vitest остаётся в обычном Node.
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedEarthquake } from "../../scraper/types";
import { createDb, type Db } from "../client";
import { loadMigrations } from "../testing/loadMigrations";
import { upsertChat } from "./chatRepository";
import {
  applyEventUpdate,
  countEvents,
  insertIfNew,
  listPendingAlerts,
  listRecent,
  listSince,
  listWindow,
  markAllPendingNotified,
  markNotified,
  markRetracted,
} from "./earthquakeRepository";
import {
  getOrCreateSubscription,
  listActiveSubscriptions,
  setMinMagnitude,
  setSubscriptionActive,
} from "./subscriptionRepository";

const RETURNS_ROWS = /^\s*select|\breturning\b/i;

function createD1Shim(sqlite: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        async all() {
          const statement = sqlite.prepare(sql);
          if (RETURNS_ROWS.test(sql)) {
            return {
              results: statement.all(...(params as never[])),
              meta: { changes: 0, last_row_id: 0 },
            };
          }
          const info = statement.run(...(params as never[]));
          return {
            results: [],
            meta: {
              changes: Number(info.changes),
              last_row_id: Number(info.lastInsertRowid),
            },
          };
        },
      }),
    }),
  } as unknown as D1Database;
}

const migration = loadMigrations();

let sqlite: DatabaseSync;
let db: Db;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  // D1 включает контроль внешних ключей; без этого тест не поймал бы запись
  // подписки для незарегистрированного чата.
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(migration);
  db = createDb(createD1Shim(sqlite));
});

afterEach(() => {
  sqlite.close();
});

function earthquake(overrides: Partial<ParsedEarthquake> = {}): ParsedEarthquake {
  return {
    dedupeKey: "id:588000",
    sourceTimeRaw: "2026-08-28 05:45:32",
    sourceTime: "2026-08-28T05:45:32.000Z",
    magnitude: 3.2,
    depthKm: 23,
    latitude: 41.1403,
    longitude: 46.6916,
    coordinatesRaw: "41.1403/46.6916",
    region: "Azerbaijan. From Georgia border - 2km.",
    ...overrides,
  };
}

describe("earthquakeRepository", () => {
  it("сохраняет все поля события без потерь", async () => {
    await insertIfNew(db, earthquake());

    const [saved] = await listRecent(db, 1);
    expect(saved).toMatchObject({
      dedupe_key: "id:588000",
      source_time_raw: "2026-08-28 05:45:32",
      source_time: "2026-08-28T05:45:32.000Z",
      magnitude: 3.2,
      depth_km: 23,
      latitude: 41.1403,
      longitude: 46.6916,
      coordinates_raw: "41.1403/46.6916",
      region: "Azerbaijan. From Georgia border - 2km.",
      notified_at: null,
    });
  });

  it("сохраняет событие с нераспознанными координатами и глубиной", async () => {
    await insertIfNew(db, earthquake({ depthKm: null, latitude: null, longitude: null }));

    const [saved] = await listRecent(db, 1);
    expect(saved).toMatchObject({ depth_km: null, latitude: null, longitude: null });
  });

  // Единственная защита от повторной рассылки одного события каждую минуту.
  it("вставляет событие один раз и отвергает повтор по dedupe_key", async () => {
    expect(await insertIfNew(db, earthquake())).toBe(true);
    expect(await insertIfNew(db, earthquake())).toBe(false);
    expect(await countEvents(db)).toBe(1);
  });

  it("различает события с разными dedupe_key", async () => {
    expect(await insertIfNew(db, earthquake({ dedupeKey: "id:1" }))).toBe(true);
    expect(await insertIfNew(db, earthquake({ dedupeKey: "id:2" }))).toBe(true);
    expect(await countEvents(db)).toBe(2);
  });

  it("возвращает последние события в порядке убывания времени", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:1", sourceTime: "2026-08-27T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:2", sourceTime: "2026-08-29T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:3", sourceTime: "2026-08-28T00:00:00.000Z" }));

    expect((await listRecent(db, 10)).map((row) => row.dedupe_key)).toEqual([
      "id:2",
      "id:3",
      "id:1",
    ]);
  });

  it("ограничивает выборку последних событий", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:1" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:2", sourceTime: "2026-08-29T00:00:00.000Z" }));

    expect(await listRecent(db, 1)).toHaveLength(1);
  });

  it("отбирает события начиная с указанного момента включительно", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:old", sourceTime: "2026-08-01T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:edge", sourceTime: "2026-08-20T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:new", sourceTime: "2026-08-25T00:00:00.000Z" }));

    const since = await listSince(db, "2026-08-20T00:00:00.000Z");
    expect(since.map((row) => row.dedupe_key)).toEqual(["id:new", "id:edge"]);
  });

  it("выдаёт неразосланные события от самых старых", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:new", sourceTime: "2026-08-29T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:old", sourceTime: "2026-08-27T00:00:00.000Z" }));

    expect((await listPendingAlerts(db, 10)).map((row) => row.dedupe_key)).toEqual([
      "id:old",
      "id:new",
    ]);
  });

  it("исключает событие из неразосланных после пометки", async () => {
    await insertIfNew(db, earthquake());
    const [pending] = await listPendingAlerts(db, 10);

    await markNotified(db, pending!.id);

    expect(await listPendingAlerts(db, 10)).toHaveLength(0);
    expect((await listRecent(db, 1))[0]!.notified_at).not.toBeNull();
  });

  // Холодный старт обязан погасить всю историю целиком, а не первые N событий:
  // остаток иначе уйдёт живыми алертами на следующем тике.
  it("гасит все неразосланные события разом, без ограничения по количеству", async () => {
    for (let index = 0; index < 12; index += 1) {
      await insertIfNew(db, earthquake({ dedupeKey: `id:${index}` }));
    }

    await markAllPendingNotified(db);

    expect(await listPendingAlerts(db, 100)).toHaveLength(0);
    expect(await countEvents(db)).toBe(12);
  });

  it("считает события на пустой базе как ноль", async () => {
    expect(await countEvents(db)).toBe(0);
  });

  // Переиздание события источником: строка обязана сменить ключ на месте, а не
  // завестись второй, и сохранить отметку о рассылке — иначе алерт уйдёт повторно.
  it("переносит строку на новый ключ источника, не трогая отметку о рассылке", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:588681", magnitude: 4.1 }));
    const [saved] = await listRecent(db, 1);
    await markNotified(db, saved!.id);

    await applyEventUpdate(
      db,
      saved!.id,
      earthquake({ dedupeKey: "id:588683", magnitude: 4.2, region: "Уточнённый регион" }),
    );

    expect(await countEvents(db)).toBe(1);
    const [updated] = await listRecent(db, 1);
    expect(updated).toMatchObject({
      id: saved!.id,
      dedupe_key: "id:588683",
      magnitude: 4.2,
      region: "Уточнённый регион",
    });
    expect(updated!.notified_at).not.toBeNull();
    expect(await listPendingAlerts(db, 10)).toHaveLength(0);
  });

  it("убирает отозванное событие из списков, статистики и очереди рассылки", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:gone" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:alive", sourceTime: "2026-08-29T00:00:00.000Z" }));
    const [, retracted] = await listRecent(db, 10);

    await markRetracted(db, retracted!.id);

    expect((await listRecent(db, 10)).map((row) => row.dedupe_key)).toEqual(["id:alive"]);
    expect((await listSince(db, "2026-01-01T00:00:00.000Z")).map((row) => row.dedupe_key)).toEqual([
      "id:alive",
    ]);
    expect((await listPendingAlerts(db, 10)).map((row) => row.dedupe_key)).toEqual(["id:alive"]);
  });

  // Окно сверки не должно захватывать архив: всё, что старше самого старого события
  // страницы, источник просто перестал показывать.
  it("отдаёт для сверки только неотозванные события начиная с границы окна", async () => {
    await insertIfNew(db, earthquake({ dedupeKey: "id:old", sourceTime: "2026-08-01T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:edge", sourceTime: "2026-08-20T00:00:00.000Z" }));
    await insertIfNew(db, earthquake({ dedupeKey: "id:gone", sourceTime: "2026-08-25T00:00:00.000Z" }));
    const [gone] = await listRecent(db, 1);
    await markRetracted(db, gone!.id);

    const window = await listWindow(db, "2026-08-20T00:00:00.000Z");
    expect(window.map((row) => row.dedupe_key)).toEqual(["id:edge"]);
  });
});

describe("chatRepository", () => {
  it("создаёт чат и обновляет его при повторном вызове", async () => {
    await upsertChat(db, { id: -1001858418173, type: "supergroup", title: "Старое имя" });
    await upsertChat(db, { id: -1001858418173, type: "supergroup", title: "Новое имя" });

    const rows = sqlite.prepare("SELECT id, type, title FROM chat").all();
    expect(rows).toEqual([
      { id: -1001858418173, type: "supergroup", title: "Новое имя" },
    ]);
  });

  it("хранит id супергруппы без потери точности", async () => {
    await upsertChat(db, { id: -1001858418173, type: "supergroup", title: null });

    const [row] = sqlite.prepare("SELECT id FROM chat").all() as { id: number }[];
    expect(row!.id).toBe(-1001858418173);
  });

  it("допускает чат без названия", async () => {
    await upsertChat(db, { id: 42, type: "private", title: null });

    const [row] = sqlite.prepare("SELECT title FROM chat").all() as { title: string | null }[];
    expect(row!.title).toBeNull();
  });
});

describe("subscriptionRepository", () => {
  const chatId = -1001858418173;

  beforeEach(async () => {
    await upsertChat(db, { id: chatId, type: "supergroup", title: "Чат" });
  });

  it("создаёт подписку с настройками по умолчанию", async () => {
    const subscription = await getOrCreateSubscription(db, chatId);

    expect(subscription).toMatchObject({
      chat_id: chatId,
      active: 1,
      min_magnitude: 0,
      region_keyword: null,
    });
  });

  it("возвращает ту же подписку при повторном вызове, не создавая вторую", async () => {
    const first = await getOrCreateSubscription(db, chatId);
    const second = await getOrCreateSubscription(db, chatId);

    expect(second.id).toBe(first.id);
    expect(await listActiveSubscriptions(db)).toHaveLength(1);
  });

  it("не затирает уже настроенный порог при повторном обращении", async () => {
    await getOrCreateSubscription(db, chatId);
    await setMinMagnitude(db, chatId, 4);

    expect((await getOrCreateSubscription(db, chatId)).min_magnitude).toBe(4);
  });

  it("сохраняет изменённый порог магнитуды", async () => {
    await getOrCreateSubscription(db, chatId);
    await setMinMagnitude(db, chatId, 4.5);

    expect((await getOrCreateSubscription(db, chatId)).min_magnitude).toBe(4.5);
  });

  it("убирает отключённую подписку из рассылки и возвращает при включении", async () => {
    await getOrCreateSubscription(db, chatId);

    await setSubscriptionActive(db, chatId, false);
    expect(await listActiveSubscriptions(db)).toHaveLength(0);

    await setSubscriptionActive(db, chatId, true);
    expect(await listActiveSubscriptions(db)).toHaveLength(1);
  });

  it("выдаёт для рассылки поля фильтра в ожидаемом виде", async () => {
    await getOrCreateSubscription(db, chatId);
    await setMinMagnitude(db, chatId, 3);

    const [subscription] = await listActiveSubscriptions(db);
    expect(subscription).toMatchObject({
      chat_id: chatId,
      min_magnitude: 3,
      region_keyword: null,
    });
  });

  it("не создаёт подписку для незарегистрированного чата", async () => {
    await expect(getOrCreateSubscription(db, 999)).rejects.toThrow();
  });
});
