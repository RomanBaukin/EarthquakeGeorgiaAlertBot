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
    return "пока нет данных о землетрясениях — как только появятся, покажу их здесь.";
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
