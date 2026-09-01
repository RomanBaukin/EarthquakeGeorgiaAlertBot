// Навигация по меню — единственная часть слоя бота, которую стоит держать под тестом:
// её легко сломать молча. Разница между `ctx.reply` и `ctx.editMessageText` не видна
// ни типам, ни глазу при чтении диффа, а цена ошибки — меню снова начинает плодить
// сообщения и уезжать вверх по чату, ради чего всё и затевалось.
//
// Тест гоняет настоящие хендлеры (`createBot`) против настоящей SQLite через тот же
// D1-шим, что и repositories.test.ts. В сеть не ходит ничего: транcформер grammY
// перехватывает вызовы Telegram API и отвечает вместо api.telegram.org, поэтому
// боевой токен не нужен, а вызовы можно проверять как обычные данные.
//
// Остальной UI (тексты команд, вёрстка сообщений) по-прежнему проверяется руками
// в Telegram — см. CLAUDE.md.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import type { BotContext } from "./context";
import { createDb } from "../db/client";
import { insertIfNew, listPendingAlerts } from "../db/repositories/earthquakeRepository";
import { dispatchAlerts } from "../poller/alertDispatcher";

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
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
          };
        },
      }),
    }),
  } as unknown as D1Database;
}

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations", "0001_init.sql"),
  "utf8",
);

const CHAT = { id: 42, type: "private" as const, first_name: "Tester" };
const FROM = { id: 42, is_bot: false, first_name: "Tester" };

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

let sqlite: DatabaseSync;
let bot: Bot<BotContext>;
let calls: ApiCall[];
let shim: D1Database;
// Пусть editMessageText имитирует реальную ошибку Telegram при повторном нажатии.
let editFailsAsNotModified = false;
let editFailsAsOtherError = false;

beforeEach(async () => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(migration);
  shim = createD1Shim(sqlite);
  calls = [];
  editFailsAsNotModified = false;
  editFailsAsOtherError = false;

  bot = createBot({
    BOT_TOKEN: "123:fake",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    SOURCE_URL: "https://example.com",
    DB: shim,
  });

  // Ни один вызов не уходит в сеть: транформер отвечает вместо api.telegram.org.
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });

    if (method === "getMe") {
      return {
        ok: true,
        result: { id: 1, is_bot: true, first_name: "Bot", username: "test_bot" },
      } as never;
    }
    if (method === "editMessageText" && editFailsAsNotModified) {
      return {
        ok: false,
        error_code: 400,
        description:
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
      } as never;
    }
    if (method === "editMessageText" && editFailsAsOtherError) {
      return {
        ok: false,
        error_code: 400,
        description: "Bad Request: message to edit not found",
      } as never;
    }
    if (method === "sendMessage" || method === "editMessageText") {
      return {
        ok: true,
        result: {
          message_id: 100 + calls.length,
          date: 0,
          chat: CHAT,
          text: (payload as { text?: string }).text ?? "",
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  await bot.init();
});

function messageUpdate(text: string, isCommand: boolean) {
  return {
    update_id: calls.length + 1,
    message: {
      message_id: 1,
      date: 0,
      chat: CHAT,
      from: FROM,
      text,
      ...(isCommand
        ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.length }] }
        : {}),
    },
  };
}

function callbackUpdate(data: string, replyMarkup: unknown) {
  return {
    update_id: calls.length + 1,
    callback_query: {
      id: `cb-${calls.length}`,
      from: FROM,
      chat_instance: "1",
      data,
      message: {
        message_id: 500,
        date: 0,
        chat: CHAT,
        text: "Главное меню:",
        reply_markup: replyMarkup,
      },
    },
  };
}

/** Открывает меню и возвращает callback_data кнопок, как их сгенерировал сам бот. */
async function openMenuAndGetKeyboard() {
  await bot.handleUpdate(messageUpdate("/menu", true) as never);
  const menuCall = calls.filter((c) => c.method === "sendMessage").at(-1)!;
  return menuCall.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data?: string }[][];
  };
}

// Клавиатура закреплена на стороне Telegram: перестать её слать недостаточно,
// нужен явный remove_keyboard, иначе она висит у старых чатов навсегда.
describe("снятие reply-клавиатуры", () => {
  it("/start снимает клавиатуру и сразу показывает меню", async () => {
    await bot.handleUpdate(messageUpdate("/start", true) as never);

    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends).toHaveLength(2);
    expect(sends[0]!.payload.reply_markup).toEqual({ remove_keyboard: true });
    expect(sends[1]!.payload.reply_markup).toHaveProperty("inline_keyboard");
  });

  it("нажатие старой кнопки «☰ Меню» снимает её и открывает меню", async () => {
    await bot.handleUpdate(messageUpdate("☰ Меню", false) as never);

    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends).toHaveLength(2);
    expect(sends[0]!.payload.reply_markup).toEqual({ remove_keyboard: true });
    expect(sends[1]!.payload.text).toBe("Главное меню:");
    expect(sends[1]!.payload.reply_markup).toHaveProperty("inline_keyboard");
  });

  it("команды без своей разметки тоже досевают снятие", async () => {
    for (const command of ["/help", "/behavior", "/recent", "/stats"]) {
      calls = [];
      await bot.handleUpdate(messageUpdate(command, true) as never);
      const send = calls.find((c) => c.method === "sendMessage")!;
      expect(send.payload.reply_markup, command).toEqual({ remove_keyboard: true });
    }
  });

  it("ни одно сообщение не шлёт reply-клавиатуру обратно", async () => {
    for (const command of ["/start", "/menu", "/help", "/behavior", "/recent", "/stats"]) {
      calls = [];
      await bot.handleUpdate(messageUpdate(command, true) as never);
      for (const call of calls.filter((c) => c.method === "sendMessage")) {
        expect(call.payload.reply_markup, command).not.toHaveProperty("keyboard");
      }
    }
  });
});

describe("кнопки меню правят сообщение на месте", () => {
  it("«Последние 5», «Статистика», «Что делать» не шлют новых сообщений", async () => {
    const keyboard = await openMenuAndGetKeyboard();
    const labels = keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("📋 Последние 5");
    expect(labels).toContain("📋 Последние 10");

    for (const label of ["📋 Последние 5", "📊 Статистика", "🛟 Что делать"]) {
      const button = keyboard.inline_keyboard.flat().find((b) => b.text === label)!;
      calls = [];
      await bot.handleUpdate(callbackUpdate(button.callback_data!, keyboard) as never);

      const methods = calls.map((c) => c.method);
      expect(methods, label).toContain("editMessageText");
      expect(methods, label).not.toContain("sendMessage");
    }
  });

  // bot.handleUpdate всегда перебрасывает ошибку middleware наружу (bot.catch к
  // вебхуку не подключён), поэтому отсутствие reject — честный признак, что
  // «message is not modified» проглочена именно нашим catch.
  it("повторное нажатие той же кнопки не роняет хендлер", async () => {
    const keyboard = await openMenuAndGetKeyboard();
    const button = keyboard.inline_keyboard.flat().find((b) => b.text === "📊 Статистика")!;

    editFailsAsNotModified = true;
    await expect(
      bot.handleUpdate(callbackUpdate(button.callback_data!, keyboard) as never),
    ).resolves.toBeUndefined();
  });

  // Контрольный опыт: любая другая ошибка редактирования обязана всплыть, иначе
  // предыдущий тест ничего не доказывает — он прошёл бы и при catch-all.
  it("прочие ошибки редактирования по-прежнему всплывают", async () => {
    const keyboard = await openMenuAndGetKeyboard();
    const button = keyboard.inline_keyboard.flat().find((b) => b.text === "📊 Статистика")!;

    editFailsAsOtherError = true;
    await expect(
      bot.handleUpdate(callbackUpdate(button.callback_data!, keyboard) as never),
    ).rejects.toThrow("message to edit not found");
  });
});

// Reply-клавиатуры у бота нет, так что эта кнопка — единственный постоянный
// вход в меню помимо команды. Потерять её значит спрятать меню совсем.
describe("кнопка «⬅️ Меню» в алертах", () => {
  it("алерт уходит с инлайн-кнопкой, и она открывает меню", async () => {
    const db = createDb(shim);
    await bot.handleUpdate(messageUpdate("/start", true) as never); // регистрируем чат и подписку
    await insertIfNew(db, {
      dedupeKey: "id:1",
      sourceTimeRaw: "2026-08-29 10:00:00",
      sourceTime: new Date().toISOString(),
      magnitude: 4.5,
      depthKm: 10,
      latitude: 41.7,
      longitude: 44.8,
      coordinatesRaw: "41.7/44.8",
      region: "Tbilisi",
    });
    const [event] = await listPendingAlerts(db, 10);

    calls = [];
    const delivered = await dispatchAlerts(bot, db, event!);
    expect(delivered).toBe(1);

    const alert = calls.find((c) => c.method === "sendMessage")!;
    const markup = alert.payload.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup.inline_keyboard[0]![0]).toEqual({
      text: "⬅️ Меню",
      callback_data: "open-menu",
    });

    calls = [];
    await bot.handleUpdate(callbackUpdate("open-menu", markup) as never);
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("answerCallbackQuery");
    const send = calls.find((c) => c.method === "sendMessage")!;
    expect(send.payload.text).toBe("Главное меню:");
  });
});
