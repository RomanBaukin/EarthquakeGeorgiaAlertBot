import { describe, expect, it } from "vitest";
import { formatTbilisi, isEventStale, parseSourceTime } from "./time";

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

describe("isEventStale", () => {
  const maxAgeMs = 6 * 60 * 60 * 1000;
  const nowMs = new Date("2026-08-29T12:00:00.000Z").getTime();

  it("считает событие свежим в пределах порога", () => {
    expect(isEventStale("2026-08-29T08:00:00.000Z", maxAgeMs, nowMs)).toBe(false);
  });

  it("считает событие устаревшим за пределами порога", () => {
    expect(isEventStale("2026-08-29T05:00:00.000Z", maxAgeMs, nowMs)).toBe(true);
  });

  it("граница ровно на пороге не считается устаревшей", () => {
    expect(isEventStale("2026-08-29T06:00:00.000Z", maxAgeMs, nowMs)).toBe(false);
  });
});
