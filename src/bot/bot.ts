import { Bot } from "grammy";
import type { Env } from "../config/env";
import { createDb } from "../db/client";
import { computeStats } from "../domain/stats";
import { listRecent, listSince } from "../db/repositories/earthquakeRepository";
import { upsertChat } from "../db/repositories/chatRepository";
import { getOrCreateSubscription } from "../db/repositories/subscriptionRepository";
import { recentListMessage, settingsMessage, statsMessage } from "../templates/messages";
import { texts } from "../templates/texts";
import type { BotContext } from "./context";
import { MENU_BUTTON_LABEL, mainReplyKeyboard } from "./keyboard";
import { mainMenu, openMainMenu } from "./menus";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function createBot(env: Env): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);
  const db = createDb(env.DB);

  bot.use(async (ctx, next) => {
    ctx.db = db;
    if (ctx.chat) {
      await upsertChat(db, {
        id: ctx.chat.id,
        type: ctx.chat.type,
        title: ctx.chat.type === "private" ? null : ctx.chat.title,
      });
      await getOrCreateSubscription(db, ctx.chat.id);
    }
    await next();
  });

  bot.use(mainMenu);

  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name ?? "незнакомец";
    await ctx.reply(texts.greeting(name), { reply_markup: mainReplyKeyboard });
    await openMainMenu(ctx);
  });

  bot.command("menu", async (ctx) => {
    await openMainMenu(ctx);
  });

  bot.hears(MENU_BUTTON_LABEL, async (ctx) => {
    await openMainMenu(ctx);
  });

  bot.callbackQuery("open-menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openMainMenu(ctx);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(texts.commands, { reply_markup: mainReplyKeyboard });
  });

  bot.command("behavior", async (ctx) => {
    await ctx.reply(texts.behaviorDuringEarthquakes, { reply_markup: mainReplyKeyboard });
  });

  bot.command("recent", async (ctx) => {
    const events = await listRecent(ctx.db, 10);
    await ctx.reply(recentListMessage(events, 10), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: mainReplyKeyboard,
    });
  });

  bot.command("stats", async (ctx) => {
    const [weekly, monthly] = await Promise.all([
      listSince(ctx.db, daysAgoIso(7)),
      listSince(ctx.db, daysAgoIso(30)),
    ]);
    await ctx.reply(statsMessage(computeStats(weekly), computeStats(monthly)), {
      parse_mode: "HTML",
      reply_markup: mainReplyKeyboard,
    });
  });

  bot.command("settings", async (ctx) => {
    const subscription = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
    await ctx.reply(settingsMessage(subscription), {
      parse_mode: "HTML",
      reply_markup: mainMenu.at("settings"),
    });
  });

  // `bot.catch` здесь намеренно нет: при вебхуке он не вызывается никогда (см. worker.ts),
  // и его наличие создавало ложное впечатление, что ошибки хендлеров залогированы.

  return bot;
}
