import type { Db } from "../client";

export async function upsertChat(
  db: Db,
  chat: { id: number; type: string; title: string | null },
): Promise<void> {
  await db
    .insertInto("chat")
    .values({ id: chat.id, type: chat.type, title: chat.title })
    .onConflict((oc) => oc.column("id").doUpdateSet({ type: chat.type, title: chat.title }))
    .execute();
}
