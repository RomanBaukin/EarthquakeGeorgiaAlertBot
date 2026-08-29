# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это за проект

Telegram-бот оповещений о землетрясениях в Грузии. Работает как Cloudflare Worker: `fetch` принимает webhook Telegram (grammY), `scheduled` раз в минуту по Cron Trigger парсит таблицу землетрясений с сайта Ilia State University и рассылает алерты подписанным чатам. Состояние — в Cloudflare D1 через Kysely.

## Команды

- `npm run dev` — локальный запуск (`wrangler dev`)
- `npm test` / `npm run test:watch` — vitest
- `npx vitest run src/domain/geo.test.ts` — один тестовый файл
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:migrate:local` / `npm run db:migrate:remote` — миграции D1
- `npm run deploy` — `wrangler deploy`

## Архитектура

Слои, от внешнего мира внутрь:

- `src/scraper/` — загрузка страницы (`fetchPage.ts`, нативный fetch с retry) и парсинг таблицы (`parseTable.ts`, cheerio). Не знает про Telegram и БД. Колонки сопоставляются по нормализованному тексту заголовка, не по индексу.
- `src/domain/` — чистые функции без побочных эффектов: время (`time.ts`), координаты и ссылки на карту (`geo.ts`), фильтр подписки (`filters.ts`), статистика (`stats.ts`). Здесь же лежат все unit-тесты.
- `src/db/` — единственное место, работающее с D1: `client.ts` (Kysely + kysely-d1), `schema.ts` (типы таблиц), `repositories/*`.
- `src/poller/` — оркестрация: `checkForNewEarthquakes.ts` (fetch → parse → insert → рассылка) и `alertDispatcher.ts` (фильтрация подписок и отправка).
- `src/bot/` — UI: `bot.ts` (команды, middleware регистрации чата), `menus.ts` (@grammyjs/menu).
- `src/templates/` — тексты на русском и HTML-шаблоны сообщений.
- `src/worker.ts` — точка входа Worker'а (`fetch` + `scheduled`).

## Важные ограничения

- Бандл Worker'а на free-плане ограничен 1MB — не добавлять тяжёлые зависимости (Prisma, luxon, axios, jsdom здесь неприменимы).
- CPU-время на вызов ~10мс на free-плане; парсинг должен оставаться лёгким.
- D1 не поддерживает транзакции — использовать идемпотентные операции (`onConflict().doNothing()`), не `db.transaction()`.
- Дедупликация событий — по `dedupe_key`: id события из ссылки источника (`id:588000`), с откатом на составной ключ время+координаты+магнитуда.
- Ячейка региона в источнике содержит постороннюю ссылку на опрос — она вырезается при парсинге; не полагаться на сырой `textContent` ячейки.
- Все пользовательские тексты — на русском, в `src/templates/texts.ts`; данные из источника всегда проходят через `escapeHtml()`.
- Первый запуск на пустой БД («холодный старт») наполняет историю без рассылки — иначе в чат ушёл бы десяток старых событий.
