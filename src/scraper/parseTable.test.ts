import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScrapeError, parseEarthquakesTable } from "./parseTable";

const here = dirname(fileURLToPath(import.meta.url));

const fixture = readFileSync(join(here, "fixtures", "sample-page.html"), "utf8");

describe("parseEarthquakesTable", () => {
  // Cron тикает раз в минуту на free-плане с лимитом ~10мс CPU. Инициализация cheerio
  // на холодном изоляте сама по себе съедала весь бюджет (outcome: exceededCpu на
  // каждом тике), независимо от размера входа — поэтому разбор обязан оставаться
  // на ручном сканере без DOM-библиотеки.
  it("не тянет DOM-библиотеку: разбор укладывается в CPU-бюджет free-плана", () => {
    const source = readFileSync(join(here, "parseTable.ts"), "utf8");
    expect(source).not.toMatch(/from ["']cheerio["']/);
  });

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

  it("игнорирует закомментированную таблицу-приманку с тем же классом перед настоящей", () => {
    const withDecoy = fixture.replace(
      "<body>",
      `<body>\r\n<!-- <table class="eartquakes-table"><tbody><tr><td>предпросмотр</td></tr></tbody></table> -->\r\n`,
    );
    expect(withDecoy).not.toBe(fixture);
    expect(parseEarthquakesTable(withDecoy)).toEqual(parseEarthquakesTable(fixture));
  });

  it("игнорирует шаблон таблицы внутри строкового литерала в script", () => {
    const withScript = fixture.replace(
      "<body>",
      `<body>\r\n<script>var preview = '<table class="eartquakes-table"><tbody><tr><td>Loading...</td></tr></tbody></table>';</script>\r\n`,
    );
    expect(withScript).not.toBe(fixture);
    expect(parseEarthquakesTable(withScript)).toEqual(parseEarthquakesTable(fixture));
  });

  it("не теряет строки после вложенной <table> внутри tbody настоящей таблицы", () => {
    // Вложенная таблица-виджет лежит в <td> отдельной строки-обёртки — валидный HTML
    // (в отличие от <table> напрямую внутри <tbody>, которая браузер/htmlparser2 сам
    // переносит за пределы таблицы независимо от нашей нарезки). Наивная нарезка по
    // первому "</table>" после начала настоящей таблицы всё равно обрежется на закрывающем
    // теге вложенной таблицы, до того как встретится настоящий конец таблицы.
    const withNestedTable = fixture.replace(
      "</tr>\r\n<tr><td ><a href='https://ies.iliauni.edu.ge/?page_id=183&lang=en&id=587522&'>",
      "</tr>\r\n<tr><td colspan=\"7\"><table><tbody><tr><td>виджет</td></tr></tbody></table></td></tr>\r\n<tr><td ><a href='https://ies.iliauni.edu.ge/?page_id=183&lang=en&id=587522&'>",
    );
    expect(withNestedTable).not.toBe(fixture);
    expect(parseEarthquakesTable(withNestedTable)).toEqual(parseEarthquakesTable(fixture));
  });
});
