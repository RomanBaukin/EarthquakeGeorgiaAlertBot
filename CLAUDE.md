# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это за проект

Telegram-бот на Node.js (`telegraf`), который парсит таблицу землетрясений с сайта Ilia State University (`https://ies.iliauni.edu.ge/?page_id=183&lang=en`), периодически проверяет появление нового землетрясения и рассылает алерт в заданный Telegram-чат. Весь код находится в двух файлах: [index.js](index.js) (логика бота) и [const.js](const.js) (тексты сообщений на русском).

## Команды разработки

- Установка зависимостей: `npm install`
- Запуск в проде: `npm start` (`node index.js`)
- Запуск с автоперезагрузкой: `npm run dev` (`nodemon index.js`)
- Тестов и линтера в проекте нет.
- Деплой — через Procfile (`worker: npm start`), рассчитан на Heroku-подобную платформу с воркер-процессом (не web-дино).

## Конфигурация

Бот требует переменную окружения `BOT_TOKEN` (токен Telegram-бота), читается через `dotenv` из `.env` в корне (файл в `.gitignore`, в репозитории отсутствует — создавать локально вручную).

## Архитектура

Всё приложение — один процесс без БД и без веб-сервера, состояние («последние землетрясения») хранится в памяти в переменной `earthquakes` в [index.js](index.js).

Поток данных:
1. При старте вызывается `generationListEarthquakes()` — забирает HTML страницы через `axios`, парсит DOM через `jsdom` (`JSDOM`), достаёт первые 10 строк таблицы `.eartquakes-table tbody` и складывает их в массив `earthquakes` (каждый элемент: `time`, `magnitude`, `depth`, `coordinates`, `region`).
2. `setInterval(checkLastEarthquake, 60000)` — раз в минуту заново парсит первую строку таблицы и сравнивает её `time` с `earthquakes[0].time`. Если время отличается — значит появилось новое землетрясение: бот шлёт форматированное сообщение в чат `chatID` (константа в [index.js](index.js#L7)) и пересобирает список через `generationListEarthquakes()`.
3. `changeTimeToLocal()` — сдвигает время из ответа сайта на +4 часа (14400000 мс, часовой пояс Грузии) и обрезает строку до 24 символов.

Команды бота (регистрируются через `bot.command(...)` в [index.js](index.js)):
- `/start` — приветствие
- `/5_recent_earthquakes`, `/10_recent_earthquakes` — форматированный список последних N из массива `earthquakes` (через `generationMessage(amountEarthquake)`)
- `/behavior_during_earthquakes` — статичный текст из `const.js`
- `/help` — список команд из `const.js`

## Важные нюансы при изменениях

- `chatID` (боевой чат) и `chatIDTEST` (тестовый) — захардкоженные числовые ID в [index.js](index.js#L7-L8); сейчас реальные оповещения шлются только в `chatID`. При тестировании рассылки переключайте на `chatIDTEST` вручную, а не отправляйте в боевой чат.
- Парсинг завязан на конкретную структуру HTML-таблицы (`.eartquakes-table`, порядок `childNodes` по индексам 0/1/3/4/5) — если сайт-источник поменяет вёрстку, парсинг молча сломается (ошибки только логируются в `console.log`, без уведомления).
- `generationMessage()` и `checkLastEarthquake()` обращаются к `earthquakes[i]` без проверки на пустой массив/выход за границы — вызывать команды `/5_recent_earthquakes` и `/10_recent_earthquakes` до первой успешной загрузки данных небезопасно.
- Все пользовательские тексты — на русском, в [const.js](const.js); при добавлении новых сообщений держите тот же тон и формат (эмодзи-акценты для алертов, `\n\n` между блоками).
