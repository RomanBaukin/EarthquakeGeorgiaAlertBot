import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN обязателен"),
  SOURCE_URL: z.string().url().default("https://ies.iliauni.edu.ge/?page_id=183&lang=en"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, "TELEGRAM_WEBHOOK_SECRET обязателен"),
  // Telegram user id админов через запятую. Необязательна: без неё админки просто нет.
  // Мусор отбрасывается, а не роняет разбор — parseEnv зовётся на каждом апдейте, и
  // опечатка в списке админов иначе положила бы бота для всех пользователей.
  ADMIN_IDS: z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => /^-?\d+$/.test(part))
        .map(Number),
    ),
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
