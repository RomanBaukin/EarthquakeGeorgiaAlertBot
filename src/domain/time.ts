const SOURCE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const TBILISI_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Tbilisi",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function parseSourceTime(raw: string): string | null {
  const match = SOURCE_TIME_PATTERN.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match as unknown as string[];
  const isoCandidate = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) return null;
  // Отсекает переполнение вроде 2026-02-31, которое Date молча нормализует в март.
  if (parsed.toISOString() !== isoCandidate) return null;

  return isoCandidate;
}

export function formatTbilisi(isoUtc: string): string {
  return TBILISI_FORMATTER.format(new Date(isoUtc));
}
