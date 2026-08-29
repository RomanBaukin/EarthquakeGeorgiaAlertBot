import { ScrapeError } from "./types";

const RETRY_BASE_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchEarthquakesPage(url: string, attempts = 3): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "EarthquakeGeorgiaAlertBot/2.0 (+https://github.com/RomanBaukin/EarthquakeGeorgiaAlertBot)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        throw new ScrapeError(`Источник ответил статусом ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw new ScrapeError(
    `Не удалось загрузить ${url} за ${attempts} попыток: ${String(lastError)}`,
  );
}
