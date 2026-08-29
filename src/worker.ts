import { webhookCallback } from "grammy";
import { createBot } from "./bot/bot";
import { parseEnv } from "./config/env";
import { checkForNewEarthquakes } from "./poller/checkForNewEarthquakes";

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
    const env = parseEnv(rawEnv);
    const bot = createBot(env);

    const handleUpdate = webhookCallback(bot, "cloudflare-mod", {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
    });

    return handleUpdate(request);
  },

  async scheduled(
    _controller: ScheduledController,
    rawEnv: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<void> {
    const env = parseEnv(rawEnv);
    ctx.waitUntil(
      checkForNewEarthquakes(env)
        .then(({ inserted, alerted }) =>
          console.log(`Проверка завершена: новых ${inserted}, разослано ${alerted}`),
        )
        .catch((error) => console.error("Проверка землетрясений упала:", error)),
    );
  },
};
