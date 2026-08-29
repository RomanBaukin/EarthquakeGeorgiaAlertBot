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
  table.find("thead th").each((index, element) => {
    headerIndex.set(normalizeHeader($(element).text()), index);
  });

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
