import { describe, expect, it } from "vitest";
import {
  adminPanelMessage,
  alertMessage,
  escapeHtml,
  recentListMessage,
  statsMessage,
} from "./messages";

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
    expect(recentListMessage([], 5)).toContain("нет данных о землетрясениях");
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

describe("adminPanelMessage", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const stats = {
    chats: { total: 12, active: 10, private: 9, groups: 3 },
    newChats: { day: 1, week: 3, month: 7 },
    thresholds: [
      { minMagnitude: 0, chats: 6 },
      { minMagnitude: 4, chats: 4 },
    ],
    lastEventTime: "2026-10-06T10:00:00.000Z",
    lastRecordedAt: "2026-10-06T11:55:00.000Z",
    pendingAlerts: 0,
  };

  it("выносит число пользователей в заголовок блока и даёт разбивку", () => {
    const text = adminPanelMessage(stats, now);
    expect(text).toContain("Пользователей: 12");
    expect(text).toContain("Получают алерты: 10, отключены: 2");
    expect(text).toContain("Лички: 9, группы и каналы: 3");
    expect(text).toContain("за сутки 1, за неделю 3, за месяц 7");
  });

  it("подписывает пороги так же, как в настройках", () => {
    const text = adminPanelMessage(stats, now);
    expect(text).toContain("любая — 6");
    expect(text).toContain("от 4 — 4");
  });

  it("показывает время событий по Тбилиси и сколько прошло", () => {
    const text = adminPanelMessage(stats, now);
    expect(text).toContain("06.10.2026, 14:00 (2 ч назад)");
    expect(text).toContain("06.10.2026, 15:55 (5 мин назад)");
  });

  it("считает давность в днях, когда прошло больше двух суток", () => {
    const text = adminPanelMessage({ ...stats, lastEventTime: "2026-10-03T12:00:00.000Z" }, now);
    expect(text).toContain("(3 дн назад)");
  });

  it("предупреждает о застрявшей рассылке только при непустой очереди", () => {
    expect(adminPanelMessage(stats, now)).not.toContain("⚠️");
    expect(adminPanelMessage({ ...stats, pendingAlerts: 3 }, now)).toContain("⚠️ Ждут рассылки: 3");
  });

  it("на пустой базе не выводит null", () => {
    const text = adminPanelMessage(
      {
        chats: { total: 0, active: 0, private: 0, groups: 0 },
        newChats: { day: 0, week: 0, month: 0 },
        thresholds: [],
        lastEventTime: null,
        lastRecordedAt: null,
        pendingAlerts: 0,
      },
      now,
    );
    expect(text).not.toContain("null");
    expect(text).toContain("Пользователей: 0");
    expect(text).toContain("никто не получает алерты");
  });
});
