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
import { mainMenu } from "./menus";

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
    await ctx.reply(texts.greeting(name), { reply_markup: mainMenu });
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply("Главное меню:", { reply_markup: mainMenu });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(texts.commands);
  });

  bot.command("behavior", async (ctx) => {
    await ctx.reply(texts.behaviorDuringEarthquakes);
  });

  bot.command("recent", async (ctx) => {
    const events = await listRecent(ctx.db, 10);
    await ctx.reply(recentListMessage(events, 10), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("stats", async (ctx) => {
    const [weekly, monthly] = await Promise.all([
      listSince(ctx.db, daysAgoIso(7)),
      listSince(ctx.db, daysAgoIso(30)),
    ]);
    await ctx.reply(statsMessage(computeStats(weekly), computeStats(monthly)), {
      parse_mode: "HTML",
    });
  });

  bot.command("settings", async (ctx) => {
    const subscription = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
    await ctx.reply(settingsMessage(subscription), {
      parse_mode: "HTML",
      reply_markup: mainMenu.at("settings"),
    });
  });

  bot.catch((error) => {
    console.error("Ошибка обработки апдейта:", error);
  });

  return bot;
}
