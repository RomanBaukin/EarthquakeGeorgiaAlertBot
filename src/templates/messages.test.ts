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
