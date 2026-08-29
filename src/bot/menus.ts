import { Menu } from "@grammyjs/menu";
import { computeStats } from "../domain/stats";
import { listRecent, listSince } from "../db/repositories/earthquakeRepository";
import {
  getOrCreateSubscription,
  setMinMagnitude,
  setSubscriptionActive,
} from "../db/repositories/subscriptionRepository";
import { recentListMessage, settingsMessage, statsMessage } from "../templates/messages";
import { texts } from "../templates/texts";
import type { BotContext } from "./context";

const MAGNITUDE_PRESETS = [0, 3, 4, 5];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export const settingsMenu = new Menu<BotContext>("settings")
  .text(
    async (ctx) => {
      const subscription = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
      return subscription.active === 1 ? "🔔 Уведомления: вкл" : "🔕 Уведомления: выкл";
    },
    async (ctx) => {
      const subscription = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
      await setSubscriptionActive(ctx.db, ctx.chat!.id, subscription.active !== 1);
      const updated = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
      ctx.menu.update();
      await ctx.editMessageText(settingsMessage(updated), { parse_mode: "HTML" });
    },
  )
  .row();

for (const preset of MAGNITUDE_PRESETS) {
  settingsMenu.text(
    async (ctx) => {
      const subscription = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
      const label = preset === 0 ? "любая" : `от ${preset}`;
      return subscription.min_magnitude === preset ? `✅ ${label}` : label;
    },
    async (ctx) => {
      await setMinMagnitude(ctx.db, ctx.chat!.id, preset);
      const updated = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
      ctx.menu.update();
      await ctx.editMessageText(settingsMessage(updated), { parse_mode: "HTML" });
    },
  );
}

settingsMenu.row().back("⬅️ Назад");

export const mainMenu = new Menu<BotContext>("main")
  .text("📋 Последние 5", async (ctx) => {
    const events = await listRecent(ctx.db, 5);
    await ctx.reply(recentListMessage(events, 5), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  })
  .text("📋 Последние 10", async (ctx) => {
    const events = await listRecent(ctx.db, 10);
    await ctx.reply(recentListMessage(events, 10), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  })
  .row()
  .text("📊 Статистика", async (ctx) => {
    const [weekly, monthly] = await Promise.all([
      listSince(ctx.db, daysAgoIso(7)),
      listSince(ctx.db, daysAgoIso(30)),
    ]);
    await ctx.reply(statsMessage(computeStats(weekly), computeStats(monthly)), {
      parse_mode: "HTML",
    });
  })
  .text("🛟 Что делать", async (ctx) => {
    await ctx.reply(texts.behaviorDuringEarthquakes);
  })
  .row()
  .submenu("⚙️ Настройки", "settings", async (ctx) => {
    const subscription = await getOrCreateSubscription(ctx.db, ctx.chat!.id);
    await ctx.editMessageText(settingsMessage(subscription), { parse_mode: "HTML" });
  });

mainMenu.register(settingsMenu);
