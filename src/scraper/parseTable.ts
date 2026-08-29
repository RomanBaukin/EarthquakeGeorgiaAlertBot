import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { parseCoordinates } from "../domain/geo";
import { parseSourceTime } from "../domain/time";
import { ScrapeError, type ParsedEarthquake } from "./types";

export { ScrapeError } from "./types";
export type { ParsedEarthquake } from "./types";

const TABLE_SELECTOR = "table.eartquakes-table";
const TABLE_CLASS_MARKER = "eartquakes-table";
const EVENT_ID_PATTERN = /[?&]id=(\d+)/;

// Живая страница — 65 КБ, а нужная таблица — ~10 КБ; cheerio.load всей страницы
// на холодном изоляте съедает CPU-лимит free-плана Cloudflare (~10 мс). Вырезаем
// фрагмент до парсинга; если разметка не совпала с ожиданиями — отдаём html как есть,
// и парсинг просто деградирует до прежнего (более дорогого) поведения, а не падает.
//
// Нельзя просто искать первое вхождение TABLE_CLASS_MARKER в html: на живой странице
// оно сперва встречается в <style>-блоке (CSS-селекторы вида "table.eartquakes-table
// td:nth-child(1)"), который стоит перед самой таблицей и не содержит закрывающего
// </table> рядом — так фрагмент вырезался бы неверно. Поэтому проверяем именно
// открывающий тег <table ...>, а не первое вхождение маркера где угодно в документе.
function extractTableFragment(html: string): string {
  let searchFrom = 0;

  while (true) {
    const tableStart = html.indexOf("<table", searchFrom);
    if (tableStart === -1) return html;

    const tagEnd = html.indexOf(">", tableStart);
    if (tagEnd === -1) return html;

    const openTag = html.slice(tableStart, tagEnd + 1);
    if (openTag.includes(TABLE_CLASS_MARKER)) {
      const closeTag = "</table>";
      const closeIndex = html.indexOf(closeTag, tagEnd);
      if (closeIndex === -1) return html;
      return html.slice(tableStart, closeIndex + closeTag.length);
    }

    searchFrom = tagEnd + 1;
  }
}

const COLUMNS = {
  time: "time(utc)",
  magnitude: "magnitude(ml)",
  depth: "depth(km)",
  coordinates: "lat/long(degree)",
  region: "region",
} as const;

type ColumnIndex = Record<keyof typeof COLUMNS, number>;

function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

function resolveColumnIndex(headerIndex: Map<string, number>): ColumnIndex | null {
  const columnIndex: ColumnIndex = {} as never;
  for (const [key, header] of Object.entries(COLUMNS)) {
    const index = headerIndex.get(header);
    if (index === undefined) return null;
    columnIndex[key as keyof typeof COLUMNS] = index;
  }
  return columnIndex;
}

// Общая точка для основного разбора и для самопроверки вырезанного фрагмента —
// логика сопоставления колонок по заголовкам не должна дублироваться между ними.
function locateTable($: CheerioAPI) {
  const table = $(TABLE_SELECTOR).first();
  if (table.length === 0) return null;

  const headerIndex = new Map<string, number>();
  table.find("thead th").each((index, element) => {
    headerIndex.set(normalizeHeader($(element).text()), index);
  });

  const columnIndex = resolveColumnIndex(headerIndex);
  if (columnIndex === null) return null;

  // Строки собираем один раз здесь: их же переиспользуют и самопроверка фрагмента,
  // и основной цикл разбора — так DOM не обходится по "tbody tr" дважды.
  const rows = table.find("tbody tr");

  return { table, columnIndex, rows };
}

type LocatedTable = NonNullable<ReturnType<typeof locateTable>>;

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    from = index + needle.length;
  }
}

// Заголовки и хотя бы одна строка ловят подставные/пустые фрагменты (закомментированная
// таблица-приманка с тем же классом, шаблон таблицы внутри <script>), но не ловят частичную
// потерю данных: если внутри среза оказалась чужая вложенная <table>, наша нарезка обрывается
// на ЕЁ закрывающем теге, и настоящая таблица остаётся незакрытой — часть настоящих строк
// после вложенной таблицы молча теряется, хотя строки перед ней выглядят валидными.
// Проверка баланса <table>/</table> ловит именно это, не пытаясь распознавать сами вложенные
// таблицы: если разметка вложенной таблицы полностью попала в срез, теги останутся
// сбалансированы; если срез оборвался на её закрывающем теге — не сойдётся.
function isFragmentTrustworthy(fragment: string, located: LocatedTable | null): boolean {
  if (countOccurrences(fragment, "<table") !== countOccurrences(fragment, "</table>")) {
    return false;
  }

  return located !== null && located.rows.length > 0;
}

export function parseEarthquakesTable(html: string): ParsedEarthquake[] {
  const fragment = extractTableFragment(html);

  let $ = cheerio.load(fragment);
  let located = locateTable($);

  const useFragment = fragment !== html && isFragmentTrustworthy(fragment, located);
  if (!useFragment && fragment !== html) {
    $ = cheerio.load(html);
    located = locateTable($);
  }

  if (located === null) {
    throw new ScrapeError(`Таблица ${TABLE_SELECTOR} не найдена или в ней нет обязательных колонок`);
  }

  const { columnIndex, rows } = located;
  const events: ParsedEarthquake[] = [];

  rows.each((_, row) => {
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
