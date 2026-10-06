import { sql } from "kysely";
import type { Db } from "../client";

export interface AdminStats {
  /** «Получают алерты» — подписка включена. Кто заблокировал бота, числится здесь до первого недошедшего алерта. */
  chats: { total: number; active: number; private: number; groups: number };
  newChats: { day: number; week: number; month: number };
  /** Только включённые подписки, по возрастанию порога. */
  thresholds: { minMagnitude: number; chats: number }[];
  /** Время самого свежего неотозванного толчка, ISO UTC. */
  lastEventTime: string | null;
  /** Когда поллер последний раз записал строку в базу, ISO UTC. */
  lastRecordedAt: string | null;
  pendingAlerts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// created_at проставляет сама SQLite через datetime('now'): «2026-10-06 12:00:00», без
// «T» и «Z». Сравнивать его с ISO-строкой нельзя — пробел меньше «T», и граница поедет.
function toSqliteTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function fromSqliteTime(value: string): string {
  return `${value.replace(" ", "T")}.000Z`;
}

export async function getAdminStats(db: Db, now: Date): Promise<AdminStats> {
  const since = (days: number) => toSqliteTime(new Date(now.getTime() - days * DAY_MS));

  const [chats, thresholds, events] = await Promise.all([
    db
      .selectFrom("chat")
      .select((eb) => [
        eb.fn.countAll<number>().as("total"),
        sql<number>`sum(type = 'private')`.as("private"),
        sql<number>`sum(created_at >= ${since(1)})`.as("day"),
        sql<number>`sum(created_at >= ${since(7)})`.as("week"),
        sql<number>`sum(created_at >= ${since(30)})`.as("month"),
      ])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("subscription")
      .select((eb) => ["min_magnitude", eb.fn.countAll<number>().as("chats")])
      .where("active", "=", 1)
      .groupBy("min_magnitude")
      .orderBy("min_magnitude", "asc")
      .execute(),
    db
      .selectFrom("earthquake_event")
      .select([
        sql<string | null>`max(case when retracted_at is null then source_time end)`.as(
          "lastEventTime",
        ),
        sql<string | null>`max(created_at)`.as("lastRecordedAt"),
        sql<number>`sum(notified_at is null and retracted_at is null)`.as("pending"),
      ])
      .executeTakeFirstOrThrow(),
  ]);

  const total = Number(chats.total);
  const privateChats = Number(chats.private ?? 0);

  return {
    chats: {
      total,
      active: thresholds.reduce((sum, row) => sum + Number(row.chats), 0),
      private: privateChats,
      groups: total - privateChats,
    },
    newChats: {
      day: Number(chats.day ?? 0),
      week: Number(chats.week ?? 0),
      month: Number(chats.month ?? 0),
    },
    thresholds: thresholds.map((row) => ({
      minMagnitude: row.min_magnitude,
      chats: Number(row.chats),
    })),
    lastEventTime: events.lastEventTime,
    lastRecordedAt: events.lastRecordedAt === null ? null : fromSqliteTime(events.lastRecordedAt),
    pendingAlerts: Number(events.pending ?? 0),
  };
}
