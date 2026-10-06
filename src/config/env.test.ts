import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  BOT_TOKEN: "123:fake",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  DB: {} as D1Database,
};

describe("ADMIN_IDS", () => {
  it("разбирает список id через запятую, допуская пробелы", () => {
    expect(parseEnv({ ...base, ADMIN_IDS: "42, 1001" }).ADMIN_IDS).toEqual([42, 1001]);
  });

  it("без переменной админов нет, а бот запускается", () => {
    expect(parseEnv(base).ADMIN_IDS).toEqual([]);
  });

  // Опечатка в списке админов не должна ронять parseEnv: он зовётся на каждом
  // апдейте, и бот перестал бы отвечать всем пользователям, а не только админу.
  it("отбрасывает мусор вместо того, чтобы ронять бота", () => {
    expect(parseEnv({ ...base, ADMIN_IDS: "42,abc,,4.5,-7" }).ADMIN_IDS).toEqual([42, -7]);
  });
});
