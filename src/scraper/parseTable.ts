import { parseCoordinates } from "../domain/geo";
import { parseSourceTime } from "../domain/time";
import { ScrapeError, type ParsedEarthquake } from "./types";

export { ScrapeError } from "./types";
export type { ParsedEarthquake } from "./types";

const TABLE_CLASS_MARKER = "eartquakes-table";
const EVENT_ID_PATTERN = /[?&]id=(\d+)/;
const HREF_PATTERN = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

// Cron тикает раз в минуту, а CPU-бюджет free-плана — ~10мс на вызов. Инициализация
// cheerio на холодном изоляте съедала его целиком (outcome: exceededCpu на каждом тике)
// независимо от размера входа, поэтому таблица разбирается сканированием строки.
// DOM здесь не нужен: структура источника плоская — thead/tbody, tr, td без вложенности.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;

  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

// Комментарии и содержимое script/style вырезаются до поиска таблицы: маркер класса
// встречается на живой странице внутри <style>, а таблица-приманка с тем же классом
// в комментарии или в строковом литерале скрипта иначе увела бы разбор не туда.
function stripInertMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");
}

// Возвращает внутренний HTML первого элемента `tag`, считая вложенность: во вложенной
// таблице-виджете есть свои tbody/tr/td, и обрыв по первому закрывающему тегу молча
// потерял бы все настоящие строки после неё.
function sliceInner(html: string, tag: string, from = 0): string | null {
  const openPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  openPattern.lastIndex = from;
  const open = openPattern.exec(html);
  if (open === null) return null;

  const contentStart = openPattern.lastIndex;
  const tagPattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = contentStart;

  let depth = 1;
  let tag_: RegExpExecArray | null;
  while ((tag_ = tagPattern.exec(html)) !== null) {
    depth += tag_[1] ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, tag_.index);
  }

  return null;
}

function findTableInner(html: string): string | null {
  const openPattern = /<table\b[^>]*>/gi;
  let open: RegExpExecArray | null;

  while ((open = openPattern.exec(html)) !== null) {
    if (!open[0].includes(TABLE_CLASS_MARKER)) continue;
    return sliceInner(html, "table", open.index);
  }

  return null;
}

function sliceAll(html: string, tag: string): string[] {
  const openPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const items: string[] = [];
  let open: RegExpExecArray | null;

  while ((open = openPattern.exec(html)) !== null) {
    const inner = sliceInner(html, tag, open.index);
    if (inner === null) break;
    items.push(inner);
    openPattern.lastIndex = open.index + open[0].length + inner.length;
  }

  return items;
}

function textOf(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]*>/g, "")).trim();
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

function resolveColumnIndex(headers: string[]): ColumnIndex | null {
  const headerIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    headerIndex.set(normalizeHeader(header), index);
  });

  const columnIndex: ColumnIndex = {} as never;
  for (const [key, header] of Object.entries(COLUMNS)) {
    const index = headerIndex.get(header);
    if (index === undefined) return null;
    columnIndex[key as keyof typeof COLUMNS] = index;
  }
  return columnIndex;
}

export function parseEarthquakesTable(html: string): ParsedEarthquake[] {
  const tableInner = findTableInner(stripInertMarkup(html));
  if (tableInner === null) {
    throw new ScrapeError(`Таблица .${TABLE_CLASS_MARKER} не найдена`);
  }

  const headRow = sliceInner(tableInner, "thead");
  const columnIndex = headRow === null ? null : resolveColumnIndex(sliceAll(headRow, "th").map(textOf));
  if (columnIndex === null) {
    throw new ScrapeError(`В таблице .${TABLE_CLASS_MARKER} нет обязательных колонок`);
  }

  const body = sliceInner(tableInner, "tbody") ?? "";
  const events: ParsedEarthquake[] = [];

  for (const row of sliceAll(body, "tr")) {
    const cells = sliceAll(row, "td");
    const cellHtml = (index: number): string => cells[index] ?? "";
    const cellText = (index: number): string => textOf(cellHtml(index));

    const sourceTimeRaw = cellText(columnIndex.time);
    const sourceTime = parseSourceTime(sourceTimeRaw);
    if (sourceTime === null) continue;

    const magnitude = Number.parseFloat(cellText(columnIndex.magnitude));
    if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 10) continue;

    const depthValue = Number.parseFloat(cellText(columnIndex.depth));
    const depthKm = Number.isFinite(depthValue) ? depthValue : null;

    const coordinatesRaw = cellText(columnIndex.coordinates);
    const coordinates = parseCoordinates(coordinatesRaw);

    // Ячейка региона содержит постороннюю ссылку на опрос — её текст в регион не входит.
    const regionHtml = cellHtml(columnIndex.region).replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, "");
    const region = textOf(regionHtml).replace(/\s+/g, " ").trim();

    const eventHref = HREF_PATTERN.exec(cellHtml(columnIndex.time));
    const eventId = EVENT_ID_PATTERN.exec(eventHref?.[1] ?? eventHref?.[2] ?? "")?.[1];
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
  }

  return events;
}
