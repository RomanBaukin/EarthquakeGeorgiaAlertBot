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

    // Ошибки хендлеров ловятся здесь, а не через `bot.catch`: `webhookCallback`
    // дёргает `bot.handleUpdate` напрямую, а тот всегда перебрасывает ошибку наружу —
    // `errorHandler` из `bot.catch` работает только при long polling, которого здесь нет.
    //
    // Отвечаем 200, а не 500: на любой другой код Telegram повторит тот же апдейт, а
    // хендлер к моменту падения уже мог отправить часть сообщений — ретрай продублировал
    // бы их. Ошибка уходит в логи (включён `[observability]`), апдейт теряется.
    //
    // Сюда же попадает падение `bot.init()` при неверном `BOT_TOKEN` — тогда теряется
    // каждый апдейт, и единственный признак этого будет в логах. Проверку секрета это не
    // трогает: при несовпадении `webhookCallback` возвращает 401, а не бросает.
    try {
      return await handleUpdate(request);
    } catch (error) {
      console.error("Ошибка обработки апдейта:", error);
      return new Response("ok");
    }
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
