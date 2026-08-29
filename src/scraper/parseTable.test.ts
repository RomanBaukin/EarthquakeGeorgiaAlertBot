import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScrapeError, parseEarthquakesTable } from "./parseTable";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sample-page.html"),
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
