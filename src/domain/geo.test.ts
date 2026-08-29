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
