import { createBot } from "../bot/bot";
import type { Env } from "../config/env";
import { createDb } from "../db/client";
import {
  countEvents,
  insertIfNew,
  listPendingAlerts,
  markAllPendingNotified,
  markNotified,
} from "../db/repositories/earthquakeRepository";
import { fetchEarthquakesPage } from "../scraper/fetchPage";
import { parseEarthquakesTable } from "../scraper/parseTable";
import { dispatchAlerts } from "./alertDispatcher";

const MAX_ALERTS_PER_RUN = 5;

export async function checkForNewEarthquakes(
  env: Env,
): Promise<{ inserted: number; alerted: number }> {
  const db = createDb(env.DB);
  const isColdStart = (await countEvents(db)) === 0;

  const html = await fetchEarthquakesPage(env.SOURCE_URL);
  const events = parseEarthquakesTable(html);

  let inserted = 0;
  for (const event of events) {
    if (await insertIfNew(db, event)) inserted += 1;
  }

  if (isColdStart) {
    await markAllPendingNotified(db);
    return { inserted, alerted: 0 };
  }

  const pending = await listPendingAlerts(db, MAX_ALERTS_PER_RUN);
  const bot = createBot(env);

  let alerted = 0;
  for (const event of pending) {
    alerted += await dispatchAlerts(bot, db, event);
    await markNotified(db, event.id);
  }

  return { inserted, alerted };
}
