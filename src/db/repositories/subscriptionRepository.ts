import type { Selectable } from "kysely";
import type { Db } from "../client";
import type { SubscriptionTable } from "../schema";

export type SubscriptionRow = Selectable<SubscriptionTable>;

export async function getOrCreateSubscription(db: Db, chatId: number): Promise<SubscriptionRow> {
  await db
    .insertInto("subscription")
    .values({ chat_id: chatId })
    .onConflict((oc) => oc.column("chat_id").doNothing())
    .execute();

  const row = await db
    .selectFrom("subscription")
    .selectAll()
    .where("chat_id", "=", chatId)
    .executeTakeFirstOrThrow();

  return row;
}

export async function setSubscriptionActive(
  db: Db,
  chatId: number,
  active: boolean,
): Promise<void> {
  await db
    .updateTable("subscription")
    .set({ active: active ? 1 : 0, updated_at: new Date().toISOString() })
    .where("chat_id", "=", chatId)
    .execute();
}

export async function setMinMagnitude(
  db: Db,
  chatId: number,
  minMagnitude: number,
): Promise<void> {
  await db
    .updateTable("subscription")
    .set({ min_magnitude: minMagnitude, updated_at: new Date().toISOString() })
    .where("chat_id", "=", chatId)
    .execute();
}

export async function listActiveSubscriptions(db: Db): Promise<SubscriptionRow[]> {
  return db.selectFrom("subscription").selectAll().where("active", "=", 1).execute();
}
