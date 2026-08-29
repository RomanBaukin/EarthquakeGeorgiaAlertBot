import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN обязателен"),
  SOURCE_URL: z.string().url().default("https://ies.iliauni.edu.ge/?page_id=183&lang=en"),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_CHAT_ID: z.string().optional(),
});

export interface Env extends z.infer<typeof envSchema> {
  DB: D1Database;
}

export function parseEnv(env: Record<string, unknown>): Env {
  const parsed = envSchema.parse(env);
  const db = env.DB as D1Database | undefined;
  if (!db) throw new Error("D1-биндинг DB не подключён");

  return { ...parsed, DB: db };
}
