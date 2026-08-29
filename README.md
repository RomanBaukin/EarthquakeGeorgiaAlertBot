# EarthquakeGeorgiaAlertBot

Telegram-бот, который следит за землетрясениями в Грузии (данные Института наук о Земле Университета Ильи) и присылает уведомления в подписанные чаты.

## Возможности

- Автоматические оповещения о новых землетрясениях (проверка раз в минуту)
- Настраиваемый порог магнитуды для каждого чата
- Список последних землетрясений и статистика за 7 и 30 дней
- Ссылка на карту по координатам эпицентра
- Памятка о поведении во время землетрясения

## Стек

TypeScript, grammY, Cloudflare Workers (Cron Triggers + webhook), D1, Kysely, cheerio.

## Локальная разработка

```bash
npm install
cp .dev.vars.example .dev.vars   # вписать BOT_TOKEN
npm run db:migrate:local
npm run dev
npm test
npm run typecheck
```

## Деплой

```bash
npx wrangler login
npx wrangler d1 create earthquake-bot
```

Команда выше выведет `database_id` новой базы. Впишите его в `wrangler.toml` (поле `database_id` в блоке `[[d1_databases]]`) **до** следующего шага — иначе миграции и деплой уйдут на плейсхолдер `REPLACE_WITH_REAL_DATABASE_ID`.

```bash
npm run db:migrate:remote
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run deploy
```

После деплоя зарегистрировать webhook (один раз):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<worker>.<subdomain>.workers.dev/&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

Значение `secret_token` здесь обязано в точности совпадать с секретом, сохранённым через `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET` — иначе Telegram будет получать 401 и бот молча перестанет принимать апдейты, без единой видимой ошибки.

Первый запуск cron-триггера на пустой базе наполняет историю без рассылки — оповещения начинаются со следующего нового землетрясения.

Если после деплоя бот не отвечает — смотреть логи воркера вживую: `npx wrangler tail`.
