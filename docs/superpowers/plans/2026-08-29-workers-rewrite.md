# EarthquakeGeorgiaAlertBot Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переписать Telegram-бота оповещений о землетрясениях в Грузии с Node.js/telegraf на TypeScript/grammY, развернуть на Cloudflare Workers + D1, добавить персистентные подписки с фильтром по магнитуде, инлайн-меню, ссылки на карту и статистику.

**Architecture:** Stateless Cloudflare Worker с двумя точками входа: `fetch` (webhook Telegram через grammY `webhookCallback`) и `scheduled` (Cron Trigger раз в минуту вместо `setInterval`). Данные — в D1 (SQLite) через Kysely. Слои: `scraper` (HTTP + парсинг, ничего не знает о Telegram/БД) → `domain` (чистые функции, покрыты unit-тестами) → `db` (единственное место с Kysely) → `poller`/`bot` (оркестрация и UI).

**Tech Stack:** TypeScript, grammY + @grammyjs/menu, Cloudflare Workers (wrangler), D1, Kysely + kysely-d1, cheerio, zod, vitest.

**Spec:** `C:\Users\rbauk\.claude\plans\wondrous-swimming-wilkinson.md` (согласованный с владельцем план-спецификация; данный документ — его исполняемая детализация).

## Global Constraints

- Язык всех пользовательских сообщений бота — **русский**. Идентификаторы в коде — английские.
- Источник данных: `https://ies.iliauni.edu.ge/?page_id=183&lang=en`, таблица `table.eartquakes-table`.
- Колонки таблицы (порядок подтверждён 2026-08-29): `Time(UTC)`, ` Magnitude(ml)`, ` Fm`, ` Depth(km)`, ` Lat/Long(degree)`, ` Region`, ` M/A`. **Заголовки содержат ведущие пробелы и не содержат пробела перед `(`** — сопоставлять по нормализованному тексту (trim + lowercase + удаление всех пробелов), никогда по числовому индексу.
- Время источника — UTC в формате `YYYY-MM-DD HH:mm:ss`. Хранить в БД в ISO UTC. Пользователю показывать в зоне `Asia/Tbilisi`.
- Часовой пояс конвертируется через нативный `Intl.DateTimeFormat` с `timeZone: "Asia/Tbilisi"` (workerd включает полный ICU). Библиотека `luxon` **не используется** — экономия размера бандла.
- Бандл Worker'а на free-плане ограничен 1MB. Не добавлять зависимости сверх перечисленных в этом плане. `prisma`, `axios`, `jsdom`, `luxon`, `telegraf` — запрещены.
- CPU-время на вызов на free-плане ~10мс (сетевое ожидание не считается). Парсинг должен обрабатывать только строки таблицы, без лишних проходов по всему документу.
- D1 не поддерживает транзакции — не использовать `db.transaction()`. Последовательные запросы с идемпотентными операциями (`INSERT ... ON CONFLICT DO NOTHING`).
- Все сообщения отправляются с `parse_mode: "HTML"`; любые данные из источника проходят через `escapeHtml()`.
- Тесты — `vitest` в обычном Node-окружении (не `vitest-pool-workers`): покрываются только чистые модули `src/domain/**` и `src/scraper/parseTable.ts`.
- Каждая задача заканчивается коммитом. Формат сообщения: `feat: ...` / `test: ...` / `chore: ...` / `refactor: ...`.

---

### Task 1: Scaffolding проекта (TypeScript, wrangler, vitest)

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `vitest.config.ts`
- Create: `.dev.vars.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: ничего.
- Produces: рабочие npm-скрипты `test`, `typecheck`, `dev`, `deploy`, `db:migrate:local`, `db:migrate:remote`; конфиг wrangler с биндингом D1 по имени `DB` и cron-триггером `* * * * *`.

- [ ] **Step 1: Переписать `package.json`**

Заменить содержимое файла целиком (старые зависимости `telegraf`, `jsdom`, `axios`, `dotenv`, `nodemon` удаляются):

```json
{
  "name": "earthquakegeorgiaalertbot",
  "version": "2.0.0",
  "private": true,
  "description": "Telegram bot alerting about earthquakes in Georgia",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate:local": "wrangler d1 migrations apply DB --local",
    "db:migrate:remote": "wrangler d1 migrations apply DB --remote"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/RomanBaukin/EarthquakeGeorgiaAlertBot.git"
  },
  "license": "ISC",
  "dependencies": {
    "@grammyjs/menu": "^1.3.0",
    "cheerio": "^1.0.0",
    "grammy": "^1.30.0",
    "kysely": "^0.27.4",
    "kysely-d1": "^0.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Создать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Создать `wrangler.toml`**

`database_id` заполняется позже (Task 10) — оставить плейсхолдер как есть:

```toml
name = "earthquake-georgia-alert-bot"
main = "src/worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["* * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "earthquake-bot"
database_id = "REPLACE_WITH_REAL_DATABASE_ID"
migrations_dir = "migrations"

[vars]
SOURCE_URL = "https://ies.iliauni.edu.ge/?page_id=183&lang=en"
```

- [ ] **Step 4: Создать `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Создать `.dev.vars.example`**

```
BOT_TOKEN=123456:replace-with-your-telegram-bot-token
TELEGRAM_WEBHOOK_SECRET=replace-with-a-long-random-string
ADMIN_CHAT_ID=
```

- [ ] **Step 6: Дополнить `.gitignore`**

Файл сейчас содержит `/node_modules` и `.env`. Добавить строки:

```
.dev.vars
.wrangler
dist
```

- [ ] **Step 7: Установить зависимости и проверить**

Run: `npm install`
Затем: `npx tsc --noEmit`
Expected: установка проходит; `tsc` завершается без ошибок (файлов в `src/` ещё нет — это нормально, ошибок быть не должно).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml vitest.config.ts .dev.vars.example .gitignore
git commit -m "chore: scaffold TypeScript + wrangler + vitest project"
```

---

### Task 2: Чистые доменные утилиты времени и геокоординат

**Files:**
- Create: `src/domain/time.ts`
- Create: `src/domain/time.test.ts`
- Create: `src/domain/geo.ts`
- Create: `src/domain/geo.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `parseSourceTime(raw: string): string | null` — из `"2026-08-28 05:45:32"` (UTC) в ISO `"2026-08-28T05:45:32.000Z"`; `null` если формат не распознан.
  - `formatTbilisi(isoUtc: string): string` — в `"28.08.2026, 09:45"` (зона `Asia/Tbilisi`).
  - `parseCoordinates(raw: string): { latitude: number; longitude: number } | null`
  - `buildMapLinks(latitude: number, longitude: number): { google: string; osm: string }`

- [ ] **Step 1: Написать падающие тесты `src/domain/time.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { formatTbilisi, parseSourceTime } from "./time";

describe("parseSourceTime", () => {
  it("парсит формат источника как UTC", () => {
    expect(parseSourceTime("2026-08-28 05:45:32")).toBe("2026-08-28T05:45:32.000Z");
  });

  it("игнорирует окружающие пробелы", () => {
    expect(parseSourceTime("  2026-08-28 05:45:32 ")).toBe("2026-08-28T05:45:32.000Z");
  });

  it("возвращает null на нераспознанном формате", () => {
    expect(parseSourceTime("28.08.2026 05:45")).toBeNull();
    expect(parseSourceTime("")).toBeNull();
  });

  it("возвращает null на несуществующей дате", () => {
    expect(parseSourceTime("2026-02-31 10:00:00")).toBeNull();
  });
});

describe("formatTbilisi", () => {
  it("конвертирует UTC в тбилисское время (+4)", () => {
    expect(formatTbilisi("2026-08-28T05:45:32.000Z")).toBe("28.08.2026, 09:45");
  });

  it("корректно переносит дату через полночь", () => {
    expect(formatTbilisi("2026-08-28T21:30:00.000Z")).toBe("29.08.2026, 01:30");
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/domain/time.test.ts`
Expected: FAIL — модуль `./time` не найден.

- [ ] **Step 3: Реализовать `src/domain/time.ts`**

```ts
const SOURCE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const TBILISI_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Tbilisi",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function parseSourceTime(raw: string): string | null {
  const match = SOURCE_TIME_PATTERN.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match as unknown as string[];
  const isoCandidate = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) return null;
  // Отсекает переполнение вроде 2026-02-31, которое Date молча нормализует в март.
  if (parsed.toISOString() !== isoCandidate) return null;

  return isoCandidate;
}

export function formatTbilisi(isoUtc: string): string {
  return TBILISI_FORMATTER.format(new Date(isoUtc));
}
```

- [ ] **Step 4: Проверить тесты времени**

Run: `npx vitest run src/domain/time.test.ts`
Expected: PASS (6/6).

Если `formatTbilisi` вернёт неразрывный пробел вместо обычного (различия ICU между версиями Node), нормализовать вывод в реализации: `.replace(/\u202f|\u00a0/g, " ")`, тест не менять.

- [ ] **Step 5: Написать падающие тесты `src/domain/geo.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildMapLinks, parseCoordinates } from "./geo";

describe("parseCoordinates", () => {
  it("парсит формат lat/long источника", () => {
    expect(parseCoordinates("41.1403/46.6916")).toEqual({
      latitude: 41.1403,
      longitude: 46.6916,
    });
  });

  it("игнорирует пробелы вокруг значений", () => {
    expect(parseCoordinates(" 42.994 / 41.152 ")).toEqual({
      latitude: 42.994,
      longitude: 41.152,
    });
  });

  it("возвращает null на мусоре", () => {
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("нет данных")).toBeNull();
    expect(parseCoordinates("41.1403")).toBeNull();
  });

  it("возвращает null при выходе за допустимые диапазоны", () => {
    expect(parseCoordinates("120.0/46.0")).toBeNull();
    expect(parseCoordinates("41.0/200.0")).toBeNull();
  });
});

describe("buildMapLinks", () => {
  it("строит ссылки на Google Maps и OpenStreetMap", () => {
    expect(buildMapLinks(41.1403, 46.6916)).toEqual({
      google: "https://www.google.com/maps?q=41.1403,46.6916",
      osm: "https://www.openstreetmap.org/?mlat=41.1403&mlon=46.6916#map=9/41.1403/46.6916",
    });
  });
});
```

- [ ] **Step 6: Убедиться, что тесты падают**

Run: `npx vitest run src/domain/geo.test.ts`
Expected: FAIL — модуль `./geo` не найден.

- [ ] **Step 7: Реализовать `src/domain/geo.ts`**

```ts
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function parseCoordinates(raw: string): Coordinates | null {
  const parts = raw.split("/");
  if (parts.length !== 2) return null;

  const latitude = Number.parseFloat(parts[0]!.trim());
  const longitude = Number.parseFloat(parts[1]!.trim());
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}

export function buildMapLinks(latitude: number, longitude: number): {
  google: string;
  osm: string;
} {
  return {
    google: `https://www.google.com/maps?q=${latitude},${longitude}`,
    osm: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=9/${latitude}/${longitude}`,
  };
}
```

- [ ] **Step 8: Проверить все тесты**

Run: `npx vitest run`
Expected: PASS (все тесты обоих файлов).

- [ ] **Step 9: Commit**

```bash
git add src/domain/time.ts src/domain/time.test.ts src/domain/geo.ts src/domain/geo.test.ts
git commit -m "feat: add time and geo domain utilities"
```

---

### Task 3: Скрапер — загрузка страницы и устойчивый парсинг таблицы

**Files:**
- Create: `src/scraper/types.ts`
- Create: `src/scraper/parseTable.ts`
- Create: `src/scraper/fetchPage.ts`
- Create: `src/scraper/fixtures/sample-page.html`
- Create: `src/scraper/parseTable.test.ts`

**Interfaces:**
- Consumes: `parseSourceTime` из `src/domain/time.ts`, `parseCoordinates` из `src/domain/geo.ts` (Task 2).
- Produces:
  - `interface ParsedEarthquake { dedupeKey: string; sourceTimeRaw: string; sourceTime: string; magnitude: number; depthKm: number | null; latitude: number | null; longitude: number | null; coordinatesRaw: string; region: string }`
  - `parseEarthquakesTable(html: string): ParsedEarthquake[]` — бросает `ScrapeError` если таблица или обязательные колонки не найдены.
  - `class ScrapeError extends Error`
  - `fetchEarthquakesPage(url: string, attempts?: number): Promise<string>`

- [ ] **Step 1: Создать фикстуру `src/scraper/fixtures/sample-page.html`**

Это сокращённый, но структурно точный снимок реальной страницы (заголовки с ведущими пробелами, ссылка с `id=` в ячейке времени, посторонняя ссылка на опрос внутри ячейки региона, пустая колонка `Fm`, последняя строка — намеренно битая, без магнитуды):

```html
<!doctype html>
<html lang="en">
<body>
<div class="table-responsive">
<table  style="width:100%; "  class="easy-table easy-table-default eartquakes-table" ><thead><tr><th >Time(UTC)</th><th > Magnitude(ml)</th><th > Fm</th><th > Depth(km)</th><th > Lat/Long(degree)</th><th > Region</th><th > M/A</th></tr></thead><tbody>
<tr><td class="selected-eq-row"><a href='https://ies.iliauni.edu.ge/?page_id=183&lang=en&id=588000&'>2026-08-28 05:45:32</a></td><td class="selected-eq-row">3.2</td><td class="selected-eq-row"></td><td class="selected-eq-row">23</td><td class="selected-eq-row">41.1403/46.6916</td><td class="selected-eq-row">Azerbaijan. From Georgia border - 2km.</td><td class="selected-eq-row">M</td></tr>
<tr><td ><a href='https://ies.iliauni.edu.ge/?page_id=183&lang=en&id=587996&'>2026-08-27 23:05:04</a></td><td >3.1</td><td ></td><td >14</td><td >41.2821/43.8913</td><td > City Dmanisi - West - 23km. Village Saghamo - 11km.<a style='color:red' href='https://ies.iliauni.edu.ge/poll/poll.php?id=587996' target='_blank'> გთხოვთ შეავსოთ კითხვარი</a></td><td >M</td></tr>
<tr><td ><a href='https://ies.iliauni.edu.ge/?page_id=183&lang=en&id=587522&'>2026-08-19 09:50:16</a></td><td >3</td><td ></td><td >19</td><td >42.994/41.152</td><td > Town Gulripshi - North-East - 5km. Village Merkheuli.</td><td >M</td></tr>
<tr><td >2026-08-14 09:08:34</td><td >не число</td><td ></td><td >19</td><td >41.0868/47.4478</td><td >Azerbaijan.</td><td >M</td></tr>
</tbody></table>
</div>
</body>
</html>
```

- [ ] **Step 2: Написать падающие тесты `src/scraper/parseTable.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScrapeError, parseEarthquakesTable } from "./parseTable";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/sample-page.html", import.meta.url)),
  "utf8",
);

describe("parseEarthquakesTable", () => {
  it("парсит валидные строки и пропускает битые", () => {
    const rows = parseEarthquakesTable(fixture);
    expect(rows).toHaveLength(3);
  });

  it("извлекает поля первой строки", () => {
    const [first] = parseEarthquakesTable(fixture);
    expect(first).toMatchObject({
      sourceTimeRaw: "2026-08-28 05:45:32",
      sourceTime: "2026-08-28T05:45:32.000Z",
      magnitude: 3.2,
      depthKm: 23,
      latitude: 41.1403,
      longitude: 46.6916,
      coordinatesRaw: "41.1403/46.6916",
      region: "Azerbaijan. From Georgia border - 2km.",
    });
  });

  it("использует id события из ссылки как ключ дедупликации", () => {
    const [first] = parseEarthquakesTable(fixture);
    expect(first!.dedupeKey).toBe("id:588000");
  });

  it("вырезает постороннюю ссылку на опрос из региона", () => {
    const rows = parseEarthquakesTable(fixture);
    expect(rows[1]!.region).toBe("City Dmanisi - West - 23km. Village Saghamo - 11km.");
  });

  it("принимает целочисленную магнитуду", () => {
    const rows = parseEarthquakesTable(fixture);
    expect(rows[2]!.magnitude).toBe(3);
  });

  it("сопоставляет колонки по заголовкам, а не по позиции", () => {
    const swapped = fixture
      .replace("<th >" + " Region</th><th > M/A</th>", "<th > M/A</th><th > Region</th>")
      .replace(
        ">Azerbaijan. From Georgia border - 2km.</td><td class=\"selected-eq-row\">M<",
        ">M</td><td class=\"selected-eq-row\">Azerbaijan. From Georgia border - 2km.<",
      );
    const [first] = parseEarthquakesTable(swapped);
    expect(first!.region).toBe("Azerbaijan. From Georgia border - 2km.");
  });

  it("бросает ScrapeError, если таблицы нет", () => {
    expect(() => parseEarthquakesTable("<html><body>no table</body></html>")).toThrow(ScrapeError);
  });

  it("бросает ScrapeError, если пропала обязательная колонка", () => {
    const broken = fixture.replace("<th > Magnitude(ml)</th>", "<th > Foo</th>");
    expect(() => parseEarthquakesTable(broken)).toThrow(ScrapeError);
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npx vitest run src/scraper/parseTable.test.ts`
Expected: FAIL — модуль `./parseTable` не найден.

- [ ] **Step 4: Создать `src/scraper/types.ts`**

```ts
export interface ParsedEarthquake {
  dedupeKey: string;
  sourceTimeRaw: string;
  sourceTime: string;
  magnitude: number;
  depthKm: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinatesRaw: string;
  region: string;
}

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeError";
  }
}
```

- [ ] **Step 5: Реализовать `src/scraper/parseTable.ts`**

Магнитуда валидируется диапазоном 0–10; строки вне диапазона или с непарсящимся временем пропускаются, а не роняют разбор.

```ts
import * as cheerio from "cheerio";
import { parseCoordinates } from "../domain/geo";
import { parseSourceTime } from "../domain/time";
import { ScrapeError, type ParsedEarthquake } from "./types";

export { ScrapeError } from "./types";
export type { ParsedEarthquake } from "./types";

const TABLE_SELECTOR = "table.eartquakes-table";
const EVENT_ID_PATTERN = /[?&]id=(\d+)/;

const COLUMNS = {
  time: "time(utc)",
  magnitude: "magnitude(ml)",
  depth: "depth(km)",
  coordinates: "lat/long(degree)",
  region: "region",
} as const;

function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

export function parseEarthquakesTable(html: string): ParsedEarthquake[] {
  const $ = cheerio.load(html);
  const table = $(TABLE_SELECTOR).first();
  if (table.length === 0) {
    throw new ScrapeError(`Таблица ${TABLE_SELECTOR} не найдена на странице`);
  }

  const headerIndex = new Map<string, number>();
  table
    .find("thead th")
    .each((index, element) => headerIndex.set(normalizeHeader($(element).text()), index));

  const columnIndex: Record<keyof typeof COLUMNS, number> = {} as never;
  for (const [key, header] of Object.entries(COLUMNS)) {
    const index = headerIndex.get(header);
    if (index === undefined) {
      throw new ScrapeError(`В таблице нет обязательной колонки "${header}"`);
    }
    columnIndex[key as keyof typeof COLUMNS] = index;
  }

  const events: ParsedEarthquake[] = [];

  table.find("tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    const cellText = (index: number): string => cells.eq(index).text().trim();

    const sourceTimeRaw = cellText(columnIndex.time);
    const sourceTime = parseSourceTime(sourceTimeRaw);
    if (sourceTime === null) return;

    const magnitude = Number.parseFloat(cellText(columnIndex.magnitude));
    if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 10) return;

    const depthValue = Number.parseFloat(cellText(columnIndex.depth));
    const depthKm = Number.isFinite(depthValue) ? depthValue : null;

    const coordinatesRaw = cellText(columnIndex.coordinates);
    const coordinates = parseCoordinates(coordinatesRaw);

    // Ячейка региона содержит постороннюю ссылку на опрос — её текст в регион не входит.
    const regionCell = cells.eq(columnIndex.region).clone();
    regionCell.find("a").remove();
    const region = regionCell.text().replace(/\s+/g, " ").trim();

    const eventHref = cells.eq(columnIndex.time).find("a").attr("href") ?? "";
    const eventId = EVENT_ID_PATTERN.exec(eventHref)?.[1];
    const dedupeKey = eventId
      ? `id:${eventId}`
      : `t:${sourceTimeRaw}|${coordinatesRaw}|${magnitude}`;

    events.push({
      dedupeKey,
      sourceTimeRaw,
      sourceTime,
      magnitude,
      depthKm,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      coordinatesRaw,
      region,
    });
  });

  return events;
}
```

- [ ] **Step 6: Проверить тесты парсера**

Run: `npx vitest run src/scraper/parseTable.test.ts`
Expected: PASS (8/8).

- [ ] **Step 7: Реализовать `src/scraper/fetchPage.ts`**

Юнит-тестами не покрывается (сетевой ввод-вывод); проверяется на этапе интеграции в Task 8.

```ts
import { ScrapeError } from "./types";

const RETRY_BASE_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchEarthquakesPage(url: string, attempts = 3): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "EarthquakeGeorgiaAlertBot/2.0 (+https://github.com/RomanBaukin/EarthquakeGeorgiaAlertBot)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        throw new ScrapeError(`Источник ответил статусом ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw new ScrapeError(
    `Не удалось загрузить ${url} за ${attempts} попыток: ${String(lastError)}`,
  );
}
```

- [ ] **Step 8: Проверить типы и все тесты**

Run: `npx tsc --noEmit && npx vitest run`
Expected: обе команды успешны.

- [ ] **Step 9: Commit**

```bash
git add src/scraper
git commit -m "feat: add resilient earthquakes table scraper"
```

---

### Task 4: Доменная логика фильтрации подписок и статистики

**Files:**
- Create: `src/domain/filters.ts`
- Create: `src/domain/filters.test.ts`
- Create: `src/domain/stats.ts`
- Create: `src/domain/stats.test.ts`

**Interfaces:**
- Consumes: ничего (работает со структурными типами).
- Produces:
  - `interface SubscriptionFilter { minMagnitude: number; regionKeyword: string | null }`
  - `matchesSubscription(event: { magnitude: number; region: string }, filter: SubscriptionFilter): boolean`
  - `interface EarthquakeStats { count: number; averageMagnitude: number | null; maxMagnitude: number | null }`
  - `computeStats(events: { magnitude: number }[]): EarthquakeStats`

- [ ] **Step 1: Написать падающие тесты `src/domain/filters.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { matchesSubscription } from "./filters";

const event = { magnitude: 3.5, region: "Azerbaijan. From Georgia border - 2km." };

describe("matchesSubscription", () => {
  it("пропускает событие при нулевом пороге и отсутствии ключевого слова", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: null })).toBe(true);
  });

  it("пропускает событие ровно на пороге", () => {
    expect(matchesSubscription(event, { minMagnitude: 3.5, regionKeyword: null })).toBe(true);
  });

  it("отсекает событие ниже порога", () => {
    expect(matchesSubscription(event, { minMagnitude: 4, regionKeyword: null })).toBe(false);
  });

  it("сопоставляет ключевое слово региона без учёта регистра", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: "azerbaijan" })).toBe(true);
  });

  it("отсекает событие, если ключевое слово не встречается", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: "tbilisi" })).toBe(false);
  });

  it("игнорирует пустое ключевое слово", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: "   " })).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/domain/filters.test.ts`
Expected: FAIL — модуль `./filters` не найден.

- [ ] **Step 3: Реализовать `src/domain/filters.ts`**

```ts
export interface SubscriptionFilter {
  minMagnitude: number;
  regionKeyword: string | null;
}

export function matchesSubscription(
  event: { magnitude: number; region: string },
  filter: SubscriptionFilter,
): boolean {
  if (event.magnitude < filter.minMagnitude) return false;

  const keyword = filter.regionKeyword?.trim().toLowerCase();
  if (!keyword) return true;

  return event.region.toLowerCase().includes(keyword);
}
```

- [ ] **Step 4: Проверить тесты фильтров**

Run: `npx vitest run src/domain/filters.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Написать падающие тесты `src/domain/stats.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";

describe("computeStats", () => {
  it("возвращает нули на пустом списке без деления на ноль", () => {
    expect(computeStats([])).toEqual({
      count: 0,
      averageMagnitude: null,
      maxMagnitude: null,
    });
  });

  it("считает количество, среднюю и максимальную магнитуду", () => {
    expect(computeStats([{ magnitude: 3 }, { magnitude: 4 }, { magnitude: 5 }])).toEqual({
      count: 3,
      averageMagnitude: 4,
      maxMagnitude: 5,
    });
  });

  it("округляет среднюю магнитуду до одного знака", () => {
    expect(computeStats([{ magnitude: 3.1 }, { magnitude: 3.2 }]).averageMagnitude).toBe(3.2);
  });
});
```

- [ ] **Step 6: Убедиться, что тесты падают**

Run: `npx vitest run src/domain/stats.test.ts`
Expected: FAIL — модуль `./stats` не найден.

- [ ] **Step 7: Реализовать `src/domain/stats.ts`**

```ts
export interface EarthquakeStats {
  count: number;
  averageMagnitude: number | null;
  maxMagnitude: number | null;
}

export function computeStats(events: { magnitude: number }[]): EarthquakeStats {
  if (events.length === 0) {
    return { count: 0, averageMagnitude: null, maxMagnitude: null };
  }

  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    sum += event.magnitude;
    if (event.magnitude > max) max = event.magnitude;
  }

  return {
    count: events.length,
    averageMagnitude: Math.round((sum / events.length) * 10) / 10,
    maxMagnitude: max,
  };
}
```

- [ ] **Step 8: Проверить все тесты**

Run: `npx vitest run`
Expected: PASS (все файлы).

- [ ] **Step 9: Commit**

```bash
git add src/domain/filters.ts src/domain/filters.test.ts src/domain/stats.ts src/domain/stats.test.ts
git commit -m "feat: add subscription filtering and stats domain logic"
```

---

### Task 5: Слой данных — миграция D1, схема Kysely, репозитории

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/db/repositories/chatRepository.ts`
- Create: `src/db/repositories/subscriptionRepository.ts`
- Create: `src/db/repositories/earthquakeRepository.ts`

**Interfaces:**
- Consumes: `ParsedEarthquake` из `src/scraper/types.ts` (Task 3).
- Produces:
  - `type Db = Kysely<Database>`; `createDb(binding: D1Database): Db`
  - `upsertChat(db: Db, chat: { id: number; type: string; title: string | null }): Promise<void>`
  - `getOrCreateSubscription(db: Db, chatId: number): Promise<SubscriptionRow>`
  - `setSubscriptionActive(db: Db, chatId: number, active: boolean): Promise<void>`
  - `setMinMagnitude(db: Db, chatId: number, minMagnitude: number): Promise<void>`
  - `listActiveSubscriptions(db: Db): Promise<SubscriptionRow[]>`
  - `insertIfNew(db: Db, event: ParsedEarthquake): Promise<boolean>` — `true`, если строка была вставлена впервые
  - `listRecent(db: Db, limit: number): Promise<EarthquakeRow[]>`
  - `listSince(db: Db, sinceIso: string): Promise<EarthquakeRow[]>`
  - `listPendingAlerts(db: Db, limit: number): Promise<EarthquakeRow[]>`
  - `markNotified(db: Db, id: number): Promise<void>`
  - `countEvents(db: Db): Promise<number>`

- [ ] **Step 1: Создать миграцию `migrations/0001_init.sql`**

```sql
CREATE TABLE chat (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  title      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscription (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id        INTEGER NOT NULL UNIQUE REFERENCES chat(id),
  active         INTEGER NOT NULL DEFAULT 1,
  min_magnitude  REAL NOT NULL DEFAULT 0,
  region_keyword TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE earthquake_event (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key      TEXT NOT NULL UNIQUE,
  source_time_raw TEXT NOT NULL,
  source_time     TEXT NOT NULL,
  magnitude       REAL NOT NULL,
  depth_km        REAL,
  latitude        REAL,
  longitude       REAL,
  coordinates_raw TEXT NOT NULL,
  region          TEXT NOT NULL,
  notified_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_earthquake_event_source_time ON earthquake_event(source_time DESC);
CREATE INDEX idx_earthquake_event_pending ON earthquake_event(notified_at);
```

- [ ] **Step 2: Создать `src/db/schema.ts`**

```ts
import type { Generated } from "kysely";

export interface ChatTable {
  id: number;
  type: string;
  title: string | null;
  created_at: Generated<string>;
}

export interface SubscriptionTable {
  id: Generated<number>;
  chat_id: number;
  active: Generated<number>;
  min_magnitude: Generated<number>;
  region_keyword: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface EarthquakeEventTable {
  id: Generated<number>;
  dedupe_key: string;
  source_time_raw: string;
  source_time: string;
  magnitude: number;
  depth_km: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinates_raw: string;
  region: string;
  notified_at: string | null;
  created_at: Generated<string>;
}

export interface Database {
  chat: ChatTable;
  subscription: SubscriptionTable;
  earthquake_event: EarthquakeEventTable;
}
```

- [ ] **Step 3: Создать `src/db/client.ts`**

```ts
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "./schema";

export type Db = Kysely<Database>;

export function createDb(binding: D1Database): Db {
  return new Kysely<Database>({ dialect: new D1Dialect({ database: binding }) });
}
```

- [ ] **Step 4: Создать `src/db/repositories/chatRepository.ts`**

```ts
import type { Db } from "../client";

export async function upsertChat(
  db: Db,
  chat: { id: number; type: string; title: string | null },
): Promise<void> {
  await db
    .insertInto("chat")
    .values({ id: chat.id, type: chat.type, title: chat.title })
    .onConflict((oc) => oc.column("id").doUpdateSet({ type: chat.type, title: chat.title }))
    .execute();
}
```

- [ ] **Step 5: Создать `src/db/repositories/subscriptionRepository.ts`**

```ts
import type { Selectable } from "kysely";
import type { Db } from "../client";
import type { SubscriptionTable } from "../schema";

export type SubscriptionRow = Selectable<SubscriptionTable>;

export async function getOrCreateSubscription(db: Db, chatId: number): Promise<SubscriptionRow> {
  await db
    .insertInto("subscription")
    .values({ chat_id: chatId })
    .onConflict((oc) => oc.column("chat_id").doNothing())
    .execute();

  const row = await db
    .selectFrom("subscription")
    .selectAll()
    .where("chat_id", "=", chatId)
    .executeTakeFirstOrThrow();

  return row;
}

export async function setSubscriptionActive(
  db: Db,
  chatId: number,
  active: boolean,
): Promise<void> {
  await db
    .updateTable("subscription")
    .set({ active: active ? 1 : 0, updated_at: new Date().toISOString() })
    .where("chat_id", "=", chatId)
    .execute();
}

export async function setMinMagnitude(
  db: Db,
  chatId: number,
  minMagnitude: number,
): Promise<void> {
  await db
    .updateTable("subscription")
    .set({ min_magnitude: minMagnitude, updated_at: new Date().toISOString() })
    .where("chat_id", "=", chatId)
    .execute();
}

export async function listActiveSubscriptions(db: Db): Promise<SubscriptionRow[]> {
  return db.selectFrom("subscription").selectAll().where("active", "=", 1).execute();
}
```

- [ ] **Step 6: Создать `src/db/repositories/earthquakeRepository.ts`**

```ts
import type { Selectable } from "kysely";
import type { ParsedEarthquake } from "../../scraper/types";
import type { Db } from "../client";
import type { EarthquakeEventTable } from "../schema";

export type EarthquakeRow = Selectable<EarthquakeEventTable>;

export async function insertIfNew(db: Db, event: ParsedEarthquake): Promise<boolean> {
  const inserted = await db
    .insertInto("earthquake_event")
    .values({
      dedupe_key: event.dedupeKey,
      source_time_raw: event.sourceTimeRaw,
      source_time: event.sourceTime,
      magnitude: event.magnitude,
      depth_km: event.depthKm,
      latitude: event.latitude,
      longitude: event.longitude,
      coordinates_raw: event.coordinatesRaw,
      region: event.region,
      notified_at: null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();

  return inserted !== undefined;
}

export async function listRecent(db: Db, limit: number): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .orderBy("source_time", "desc")
    .limit(limit)
    .execute();
}

export async function listSince(db: Db, sinceIso: string): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("source_time", ">=", sinceIso)
    .orderBy("source_time", "desc")
    .execute();
}

export async function listPendingAlerts(db: Db, limit: number): Promise<EarthquakeRow[]> {
  return db
    .selectFrom("earthquake_event")
    .selectAll()
    .where("notified_at", "is", null)
    .orderBy("source_time", "asc")
    .limit(limit)
    .execute();
}

export async function markNotified(db: Db, id: number): Promise<void> {
  await db
    .updateTable("earthquake_event")
    .set({ notified_at: new Date().toISOString() })
    .where("id", "=", id)
    .execute();
}

export async function countEvents(db: Db): Promise<number> {
  const row = await db
    .selectFrom("earthquake_event")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .executeTakeFirstOrThrow();

  return Number(row.total);
}
```

- [ ] **Step 7: Проверить типы**

Run: `npx tsc --noEmit && npx vitest run`
Expected: обе команды успешны (новых тестов нет — репозитории проверяются вживую в Task 8).

- [ ] **Step 8: Commit**

```bash
git add migrations src/db
git commit -m "feat: add D1 schema, Kysely client and repositories"
```

---

### Task 6: Шаблоны сообщений и тексты на русском

**Files:**
- Create: `src/templates/texts.ts`
- Create: `src/templates/messages.ts`
- Create: `src/templates/messages.test.ts`
- Read for reference: `const.js` (тексты переносятся оттуда дословно)

**Interfaces:**
- Consumes: `formatTbilisi` (Task 2), `buildMapLinks` (Task 2), `EarthquakeStats` (Task 4), `EarthquakeRow` (Task 5).
- Produces:
  - `escapeHtml(value: string): string`
  - `formatEarthquake(event: EarthquakeLike): string` — один блок описания события
  - `alertMessage(event: EarthquakeLike): string`
  - `recentListMessage(events: EarthquakeLike[], requested: number): string`
  - `statsMessage(weekly: EarthquakeStats, monthly: EarthquakeStats): string`
  - `settingsMessage(subscription: { active: number; min_magnitude: number }): string`
  - `texts.commands`, `texts.behaviorDuringEarthquakes`, `texts.greeting(name: string)`
  - `interface EarthquakeLike { source_time: string; magnitude: number; depth_km: number | null; latitude: number | null; longitude: number | null; region: string }`

- [ ] **Step 1: Создать `src/templates/texts.ts`**

Текст `behaviorDuringEarthquakes` переносится из `const.js` дословно, без правок содержания. Список команд обновлён под новый набор:

```ts
export const texts = {
  greeting: (name: string): string =>
    `Привет, ${name}!\n\nЯ слежу за землетрясениями в Грузии и пришлю уведомление, когда произойдёт новое.\n\nОткрой меню кнопками ниже или используй /help.`,

  commands: `Возможности бота:

/menu - главное меню с кнопками
/recent - последние землетрясения
/stats - статистика за неделю и месяц
/settings - настройки уведомлений
/behavior - правила поведения во время землетрясений
/help - это сообщение`,

  behaviorDuringEarthquakes: `Правила поведения во время землетрясений:

- Выключите газ, воду и электричество.

- Если землетрясение малой силы, лучше переждать его там, где вы находитесь. При более сильном землетрясении (сила толчков составляет пять и выше баллов), если вы находитесь в помещении на втором этаже и выше, не покидайте помещение. Встаньте в безопасном месте у внутренней стены, в углу, в дверном проеме, у опорной колонны, лягте в ванну. Залезьте под кровать или стол — они защитят вас от падающих предметов и обломков. Держитесь подальше от окон и тяжелой мебели. Не пользуйтесь лифтом.

- Если вы находитесь на улице, отойдите на открытое место подальше от зданий и линий электропередач, не подходите к оборванным электрическим проводам. Не бегайте вдоль зданий и не входите в них.

- Если вы находитесь в автомобиле, оставайтесь на открытом месте, не покидая автомобиль, пока толчки не прекратятся.

- Помните: во время землетрясения очень редко причиной человеческих жертв бывает движение почвы.

Главными причинами несчастных случаев при землетрясении являются:

  • обрушение отдельных частей зданий;
  • падение битых стекол;
  • оборванные электропровода;
  • падение тяжелых предметов в квартире;
  • пожары;
  • неконтролируемое поведение людей при панике.`,
} as const;
```

- [ ] **Step 2: Написать падающие тесты `src/templates/messages.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { alertMessage, escapeHtml, recentListMessage, statsMessage } from "./messages";

const event = {
  source_time: "2026-08-28T05:45:32.000Z",
  magnitude: 3.2,
  depth_km: 23,
  latitude: 41.1403,
  longitude: 46.6916,
  region: "Azerbaijan. From Georgia border - 2km.",
};

describe("escapeHtml", () => {
  it("экранирует спецсимволы Telegram HTML", () => {
    expect(escapeHtml('<b>"x" & y</b>')).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
  });
});

describe("alertMessage", () => {
  it("содержит заголовок, магнитуду и местное время", () => {
    const text = alertMessage(event);
    expect(text).toContain("Новое землетрясение");
    expect(text).toContain("3.2");
    expect(text).toContain("28.08.2026, 09:45");
  });

  it("экранирует регион из источника", () => {
    const text = alertMessage({ ...event, region: "Region <script>" });
    expect(text).toContain("Region &lt;script&gt;");
    expect(text).not.toContain("<script>");
  });
});

describe("recentListMessage", () => {
  it("сообщает об отсутствии данных на пустом списке", () => {
    expect(recentListMessage([], 5)).toContain("пока нет данных");
  });

  it("нумерует события", () => {
    const text = recentListMessage([event, event], 2);
    expect(text).toContain("1.");
    expect(text).toContain("2.");
  });
});

describe("statsMessage", () => {
  it("показывает прочерк вместо средней магнитуды при отсутствии событий", () => {
    const empty = { count: 0, averageMagnitude: null, maxMagnitude: null };
    const text = statsMessage(empty, empty);
    expect(text).toContain("0");
    expect(text).not.toContain("null");
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npx vitest run src/templates/messages.test.ts`
Expected: FAIL — модуль `./messages` не найден.

- [ ] **Step 4: Реализовать `src/templates/messages.ts`**

```ts
import { buildMapLinks } from "../domain/geo";
import type { EarthquakeStats } from "../domain/stats";
import { formatTbilisi } from "../domain/time";

export interface EarthquakeLike {
  source_time: string;
  magnitude: number;
  depth_km: number | null;
  latitude: number | null;
  longitude: number | null;
  region: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatEarthquake(event: EarthquakeLike): string {
  const lines = [
    `<b>Магнитуда ${event.magnitude}</b> — ${escapeHtml(event.region)}`,
    `🕒 ${formatTbilisi(event.source_time)} (Тбилиси)`,
  ];

  if (event.depth_km !== null) lines.push(`📉 Глубина: ${event.depth_km} км`);

  if (event.latitude !== null && event.longitude !== null) {
    const { google } = buildMapLinks(event.latitude, event.longitude);
    lines.push(`📍 <a href="${google}">${event.latitude}, ${event.longitude}</a>`);
  }

  return lines.join("\n");
}

export function alertMessage(event: EarthquakeLike): string {
  return `❗️ <b>Новое землетрясение</b>\n\n${formatEarthquake(event)}`;
}

export function recentListMessage(events: EarthquakeLike[], requested: number): string {
  if (events.length === 0) {
    return "Пока нет данных о землетрясениях — как только появятся, покажу их здесь.";
  }

  const body = events
    .map((event, index) => `${index + 1}. ${formatEarthquake(event)}`)
    .join("\n\n");

  return `<b>Последние землетрясения (${events.length} из ${requested})</b>\n\n${body}`;
}

function formatMagnitude(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function statsMessage(weekly: EarthquakeStats, monthly: EarthquakeStats): string {
  return [
    "<b>Статистика землетрясений</b>",
    "",
    "<b>За 7 дней</b>",
    `Событий: ${weekly.count}`,
    `Средняя магнитуда: ${formatMagnitude(weekly.averageMagnitude)}`,
    `Максимальная: ${formatMagnitude(weekly.maxMagnitude)}`,
    "",
    "<b>За 30 дней</b>",
    `Событий: ${monthly.count}`,
    `Средняя магнитуда: ${formatMagnitude(monthly.averageMagnitude)}`,
    `Максимальная: ${formatMagnitude(monthly.maxMagnitude)}`,
  ].join("\n");
}

export function settingsMessage(subscription: {
  active: number;
  min_magnitude: number;
}): string {
  const status = subscription.active === 1 ? "включены" : "выключены";
  const threshold =
    subscription.min_magnitude === 0
      ? "любая магнитуда"
      : `от ${subscription.min_magnitude}`;

  return [
    "<b>Настройки уведомлений</b>",
    "",
    `Уведомления: <b>${status}</b>`,
    `Порог магнитуды: <b>${threshold}</b>`,
    "",
    "Меняй настройки кнопками ниже.",
  ].join("\n");
}
```

- [ ] **Step 5: Проверить тесты и типы**

Run: `npx vitest run && npx tsc --noEmit`
Expected: обе команды успешны.

- [ ] **Step 6: Commit**

```bash
git add src/templates
git commit -m "feat: add HTML message templates and Russian texts"
```

---

### Task 7: Бот grammY — контекст, команды, меню, регистрация чата

**Files:**
- Create: `src/config/env.ts`
- Create: `src/bot/context.ts`
- Create: `src/bot/menus.ts`
- Create: `src/bot/bot.ts`

**Interfaces:**
- Consumes: репозитории (Task 5), шаблоны (Task 6), `computeStats` (Task 4).
- Produces:
  - `interface Env { DB: D1Database; BOT_TOKEN: string; SOURCE_URL: string; TELEGRAM_WEBHOOK_SECRET?: string; ADMIN_CHAT_ID?: string }`
  - `parseEnv(env: unknown): Env` — бросает при отсутствии обязательных переменных
  - `type BotContext = Context & { db: Db }`
  - `createBot(env: Env): Bot<BotContext>`

- [ ] **Step 1: Создать `src/config/env.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN обязателен"),
  SOURCE_URL: z.string().url().default("https://ies.iliauni.edu.ge/?page_id=183&lang=en"),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_CHAT_ID: z.string().optional(),
});

export interface Env extends z.infer<typeof envSchema> {
  DB: D1Database;
}

export function parseEnv(env: Record<string, unknown>): Env {
  const parsed = envSchema.parse(env);
  const db = env.DB as D1Database | undefined;
  if (!db) throw new Error("D1-биндинг DB не подключён");

  return { ...parsed, DB: db };
}
```

- [ ] **Step 2: Создать `src/bot/context.ts`**

```ts
import type { Context } from "grammy";
import type { Db } from "../db/client";

export interface BotContext extends Context {
  db: Db;
}
```

- [ ] **Step 3: Создать `src/bot/menus.ts`**

Два меню: главное и настройки. `settingsMenu` регистрируется как подменю главного, чтобы работала кнопка «Назад».

```ts
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
```

- [ ] **Step 4: Создать `src/bot/bot.ts`**

```ts
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
        title: "title" in ctx.chat ? ctx.chat.title : null,
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
```

- [ ] **Step 5: Проверить типы**

Run: `npx tsc --noEmit && npx vitest run`
Expected: обе команды успешны.

Если `mainMenu.at("settings")` не проходит по типам в установленной версии `@grammyjs/menu`, использовать вместо этого `settingsMenu` напрямую (импортировав его в `bot.ts`) — поведение эквивалентно, кнопка «Назад» продолжает работать благодаря `register`.

- [ ] **Step 6: Commit**

```bash
git add src/config src/bot
git commit -m "feat: add grammY bot with commands and inline menus"
```

---

### Task 8: Поллер, рассылка алертов и точка входа Worker'а

**Files:**
- Create: `src/poller/alertDispatcher.ts`
- Create: `src/poller/checkForNewEarthquakes.ts`
- Create: `src/worker.ts`

**Interfaces:**
- Consumes: скрапер (Task 3), репозитории (Task 5), фильтры (Task 4), шаблоны (Task 6), `createBot`/`parseEnv` (Task 7).
- Produces:
  - `dispatchAlerts(bot: Bot<BotContext>, db: Db, event: EarthquakeRow): Promise<number>` — число успешных отправок
  - `checkForNewEarthquakes(env: Env): Promise<{ inserted: number; alerted: number }>`
  - `export default { fetch, scheduled }` в `src/worker.ts`

- [ ] **Step 1: Создать `src/poller/alertDispatcher.ts`**

Ошибка отправки в один чат не должна ломать рассылку в остальные; на `403` подписка деактивируется.

```ts
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
```

- [ ] **Step 2: Создать `src/poller/checkForNewEarthquakes.ts`**

Первая синхронизация на пустой БД («холодный старт») наполняет историю и помечает всё как уже уведомлённое — иначе бот разошлёт десяток старых событий.

```ts
import { createBot } from "../bot/bot";
import type { Env } from "../config/env";
import { createDb } from "../db/client";
import {
  countEvents,
  insertIfNew,
  listPendingAlerts,
  markNotified,
} from "../db/repositories/earthquakeRepository";
import { fetchEarthquakesPage } from "../scraper/fetchPage";
import { parseEarthquakesTable } from "../scraper/parseTable";
import { dispatchAlerts } from "./alertDispatcher";

const MAX_ALERTS_PER_RUN = 5;

export async function checkForNewEarthquakes(
  env: Env,
): Promise<{ inserted: number; alerted: number }> {
  const db = createDb(env.DB);
  const isColdStart = (await countEvents(db)) === 0;

  const html = await fetchEarthquakesPage(env.SOURCE_URL);
  const events = parseEarthquakesTable(html);

  let inserted = 0;
  for (const event of events) {
    if (await insertIfNew(db, event)) inserted += 1;
  }

  const pending = await listPendingAlerts(db, MAX_ALERTS_PER_RUN);

  if (isColdStart) {
    for (const event of pending) await markNotified(db, event.id);
    return { inserted, alerted: 0 };
  }

  const bot = createBot(env);
  await bot.init();

  let alerted = 0;
  for (const event of pending) {
    alerted += await dispatchAlerts(bot, db, event);
    await markNotified(db, event.id);
  }

  return { inserted, alerted };
}
```

- [ ] **Step 3: Создать `src/worker.ts`**

```ts
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
```

- [ ] **Step 4: Проверить типы и тесты**

Run: `npx tsc --noEmit && npx vitest run`
Expected: обе команды успешны.

- [ ] **Step 5: Проверить локальную сборку Worker'а**

Run: `npx wrangler deploy --dry-run --outdir=.wrangler/dry-run`
Expected: сборка проходит; в выводе размер бандла (`Total Upload`) меньше 1 MiB gzip. Если больше — сообщить это как concern, не пытаясь самостоятельно менять зависимости.

- [ ] **Step 6: Commit**

```bash
git add src/poller src/worker.ts
git commit -m "feat: add cron poller, alert dispatcher and worker entrypoint"
```

---

### Task 9: Удаление legacy-кода и документация деплоя

**Files:**
- Delete: `index.js`
- Delete: `const.js`
- Delete: `Procfile`
- Create: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: репозиторий без legacy-файлов, инструкция по развёртыванию.

- [ ] **Step 1: Удалить legacy-файлы**

```bash
git rm index.js const.js Procfile
```

- [ ] **Step 2: Создать `README.md`**

````markdown
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
npx wrangler d1 create earthquake-bot          # database_id вписать в wrangler.toml
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

Первый запуск cron-триггера на пустой базе наполняет историю без рассылки — оповещения начинаются со следующего нового землетрясения.
````

- [ ] **Step 3: Переписать `CLAUDE.md` под новую архитектуру**

Заменить содержимое целиком:

```markdown
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
```

- [ ] **Step 4: Финальная проверка**

Run: `npx tsc --noEmit && npx vitest run && npx wrangler deploy --dry-run --outdir=.wrangler/dry-run`
Expected: все три команды успешны.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove legacy Node bot, document Workers deployment"
```

---

## Проверка результата (выполняется владельцем после мержа)

1. `npm install && npm test && npm run typecheck` — зелено.
2. `npx wrangler d1 create earthquake-bot`, вписать `database_id` в `wrangler.toml`, `npm run db:migrate:remote`.
3. `npx wrangler secret put BOT_TOKEN`, `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`, `npm run deploy`.
4. `setWebhook` на боевой URL, затем `getWebhookInfo` — поле `url` заполнено, `last_error_message` пусто.
5. В тестовом чате: `/start` → меню → «Последние 5/10» → «Настройки» (переключить порог) → «Статистика» → кнопка карты открывает верную точку.
6. Через несколько минут проверить в Cloudflare dashboard логи cron-триггера: срабатывает раз в минуту, без `Exceeded CPU Time Limit`.
