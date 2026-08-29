import { GrammyError, type Bot } from "grammy";
import type { BotContext } from "../bot/context";
import type { Db } from "../db/client";
import type { EarthquakeRow } from "../db/repositories/earthquakeRepository";
import {
  listActiveSubscriptions,
  setSubscriptionActive,
} from "../db/repositories/subscriptionRepository";
import { matchesSubscription } from "../domain/filters";
import { alertMessage } from "../templates/messages";

export async function dispatchAlerts(
  bot: Bot<BotContext>,
  db: Db,
  event: EarthquakeRow,
): Promise<number> {
  const subscriptions = await listActiveSubscriptions(db);
  const text = alertMessage(event);
  let delivered = 0;

  for (const subscription of subscriptions) {
    const matches = matchesSubscription(event, {
      minMagnitude: subscription.min_magnitude,
      regionKeyword: subscription.region_keyword,
    });
    if (!matches) continue;

    try {
      await bot.api.sendMessage(subscription.chat_id, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      delivered += 1;
    } catch (error) {
      if (error instanceof GrammyError && (error.error_code === 403 || error.error_code === 400)) {
        await setSubscriptionActive(db, subscription.chat_id, false);
        console.warn(`Подписка чата ${subscription.chat_id} отключена: ${error.description}`);
      } else {
        console.error(`Не удалось отправить алерт в чат ${subscription.chat_id}:`, error);
      }
    }
  }

  return delivered;
}
