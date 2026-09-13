import { createBot } from "../bot/bot";
import type { Env } from "../config/env";
import { createDb } from "../db/client";
import {
  applyEventUpdate,
  countEvents,
  insertIfNew,
  listPendingAlerts,
  listWindow,
  markAllPendingNotified,
  markNotified,
  markRetracted,
} from "../db/repositories/earthquakeRepository";
import { isEventStale } from "../domain/time";
import { fetchEarthquakesPage } from "../scraper/fetchPage";
import { parseEarthquakesTable } from "../scraper/parseTable";
import { dispatchAlerts } from "./alertDispatcher";
import { reconcile, reconcileWindowStart } from "./reconcile";

const MAX_ALERTS_PER_RUN = 5;
// Второй рубеж обороны после проверки countEvents === 0: если часть back-catalog
// уже вставлена, но тик убит до markAllPendingNotified (нет транзакций в D1),
// следующий тик не увидит холодный старт — но всё равно не разошлёт события старше порога.
const MAX_ALERT_AGE_MS = 6 * 60 * 60 * 1000;

export interface PollResult {
  inserted: number;
  updated: number;
  revised: number;
  retracted: number;
  alerted: number;
}

const EMPTY_RESULT: PollResult = {
  inserted: 0,
  updated: 0,
  revised: 0,
  retracted: 0,
  alerted: 0,
};

export async function checkForNewEarthquakes(env: Env): Promise<PollResult> {
  const db = createDb(env.DB);
  const isColdStart = (await countEvents(db)) === 0;

  const html = await fetchEarthquakesPage(env.SOURCE_URL);
  const events = parseEarthquakesTable(html);

  if (isColdStart) {
    let inserted = 0;
    for (const event of events) {
      if (await insertIfNew(db, event)) inserted += 1;
    }
    await markAllPendingNotified(db);
    return { ...EMPTY_RESULT, inserted };
  }

  // Пустая выдача — сломанный источник, а не отзыв всей тридцатки разом.
  if (events.length === 0) return EMPTY_RESULT;

  // Сверка считается от текущего состояния страницы, поэтому убитый на середине тик
  // не оставляет полудела: следующий пересчитает план заново и доделает. Транзакций
  // в D1 нет, и опереться здесь больше не на что.
  const plan = reconcile(events, await listWindow(db, reconcileWindowStart(events)));

  for (const update of [...plan.refreshes, ...plan.revisions]) {
    await applyEventUpdate(db, update.id, update.event);
  }
  let inserted = 0;
  for (const event of plan.inserts) {
    if (await insertIfNew(db, event)) inserted += 1;
  }
  for (const id of plan.retractions) {
    await markRetracted(db, id);
  }

  const pending = await listPendingAlerts(db, MAX_ALERTS_PER_RUN);
  const bot = createBot(env);

  let alerted = 0;
  for (const event of pending) {
    if (isEventStale(event.source_time, MAX_ALERT_AGE_MS, Date.now())) {
      await markNotified(db, event.id);
      continue;
    }

    alerted += await dispatchAlerts(bot, db, event);
    await markNotified(db, event.id);
  }

  return {
    inserted,
    updated: plan.refreshes.length,
    revised: plan.revisions.length,
    retracted: plan.retractions.length,
    alerted,
  };
}
