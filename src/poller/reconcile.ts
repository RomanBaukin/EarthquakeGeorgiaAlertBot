import type { ParsedEarthquake } from "../scraper/types";

// Источник не правит пересмотренное событие, а заменяет его строкой с новым id;
// прежняя со страницы исчезает. Дедуп по ключу видит в этом новое событие: в чаты
// уходит второй алерт о том же толчке, а старая версия остаётся в базе навсегда и
// список бота расходится с сайтом. Поэтому страница трактуется не как поток новых
// строк, а как авторитетное состояние окна: что в нём разошлось — приводится к нему.
//
// Замена не обязана уложиться в один тик: между исчезновением прежней строки и
// появлением переизданной проходит и три минуты (12.09.2026, id:588971 → id:588972).
// Всё это время прежняя строка лежит отозванной — и обязана оставаться кандидатом на
// ревизию, иначе переиздание снова выглядит новым событием и алерт уходит второй раз.
//
// Функция чистая: никакой базы и Telegram, только решение. Матчинг ревизий — то
// единственное место, где ошибка тихо съедает настоящий алерт, и его надо держать
// под обычным unit-тестом.

export interface StoredEvent {
  id: number;
  dedupe_key: string;
  source_time: string;
  source_time_raw: string;
  magnitude: number;
  depth_km: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinates_raw: string;
  region: string;
  retracted_at: string | null;
}

export interface EventUpdate {
  id: number;
  event: ParsedEarthquake;
}

export interface ReconcilePlan {
  /** Ключ прежний, значения источник поправил. */
  refreshes: EventUpdate[];
  /** Событие переиздано под новым id: строка обновляется вместе с ключом. */
  revisions: EventUpdate[];
  inserts: ParsedEarthquake[];
  /** id строк, исчезнувших со страницы без замены; уже отозванные сюда не попадают. */
  retractions: number[];
}

// Наблюдавшиеся ревизии сдвигают время на 1–2 секунды и координаты на сотые доли
// градуса. Окно шире наблюдаемого, но у́же интервала до соседнего афтершока: на
// живых данных 08.09.2026 следующий толчок в тех же координатах отстоял на 3 минуты.
const REVISION_TIME_WINDOW_MS = 120_000;
const REVISION_COORD_WINDOW_DEG = 0.5;

// Расхождением считается и отзыв: если строка помечена отозванной, а источник её
// показывает, её надо вернуть в списки — даже когда прочие поля совпали до буквы.
function hasChanged(row: StoredEvent, event: ParsedEarthquake): boolean {
  return (
    row.retracted_at !== null ||
    row.source_time !== event.sourceTime ||
    row.source_time_raw !== event.sourceTimeRaw ||
    row.magnitude !== event.magnitude ||
    row.depth_km !== event.depthKm ||
    row.latitude !== event.latitude ||
    row.longitude !== event.longitude ||
    row.coordinates_raw !== event.coordinatesRaw ||
    row.region !== event.region
  );
}

// Чем меньше, тем ближе кандидат; null — за пределами окна. Гаверсинус здесь не
// нужен: расхождения ревизий на два порядка меньше окна, а CPU-бюджет тика мал.
function revisionScore(row: StoredEvent, event: ParsedEarthquake): number | null {
  if (row.latitude === null || row.longitude === null) return null;
  if (event.latitude === null || event.longitude === null) return null;

  const timeGapMs = Math.abs(new Date(row.source_time).getTime() - new Date(event.sourceTime).getTime());
  if (!(timeGapMs <= REVISION_TIME_WINDOW_MS)) return null;

  const coordGapDeg = Math.max(
    Math.abs(row.latitude - event.latitude),
    Math.abs(row.longitude - event.longitude),
  );
  if (coordGapDeg > REVISION_COORD_WINDOW_DEG) return null;

  return timeGapMs / REVISION_TIME_WINDOW_MS + coordGapDeg / REVISION_COORD_WINDOW_DEG;
}

export function reconcile(pageEvents: ParsedEarthquake[], stored: StoredEvent[]): ReconcilePlan {
  const plan: ReconcilePlan = { refreshes: [], revisions: [], inserts: [], retractions: [] };
  // Пустая выдача — это сломанный источник, а не отзыв всех событий разом.
  if (pageEvents.length === 0) return plan;

  // Ниже самого старого события страницы данных у источника просто нет: там лежит
  // архив, вытесненный из выдачи. Его нельзя ни считать отозванным, ни сверять.
  const pageOldest = pageEvents.reduce(
    (oldest, event) => (event.sourceTime < oldest ? event.sourceTime : oldest),
    pageEvents[0]!.sourceTime,
  );
  const window = stored.filter((row) => row.source_time >= pageOldest);

  const byKey = new Map(window.map((row) => [row.dedupe_key, row]));
  const fresh: ParsedEarthquake[] = [];
  const matchedKeys = new Set<string>();

  for (const event of pageEvents) {
    const row = byKey.get(event.dedupeKey);
    if (row === undefined) {
      fresh.push(event);
      continue;
    }

    matchedKeys.add(event.dedupeKey);
    if (hasChanged(row, event)) plan.refreshes.push({ id: row.id, event });
  }

  const missing = window.filter((row) => !matchedKeys.has(row.dedupe_key));

  // Кандидатами служат только строки, которых на странице нет, — исчезнувшие сейчас
  // и отозванные на прошлых тиках: настоящий афтершок из выдачи не пропадает, поэтому
  // подменить им ревизию нельзя. Пары разбираются от самой близкой, каждая строка
  // участвует один раз.
  const pairs: { event: ParsedEarthquake; row: StoredEvent; score: number }[] = [];
  for (const event of fresh) {
    for (const row of missing) {
      const score = revisionScore(row, event);
      if (score !== null) pairs.push({ event, row, score });
    }
  }
  pairs.sort((left, right) => left.score - right.score);

  const revisionByEvent = new Map<ParsedEarthquake, StoredEvent>();
  const takenRows = new Set<number>();
  for (const pair of pairs) {
    if (revisionByEvent.has(pair.event) || takenRows.has(pair.row.id)) continue;
    revisionByEvent.set(pair.event, pair.row);
    takenRows.add(pair.row.id);
  }

  for (const event of fresh) {
    const row = revisionByEvent.get(event);
    if (row === undefined) plan.inserts.push(event);
    else plan.revisions.push({ id: row.id, event });
  }

  // Отозванная строка остаётся в окне и после отзыва — как кандидат на ревизию.
  // Отзывать её повторно нечего: это лишняя запись в D1 каждую минуту.
  for (const row of missing) {
    if (!takenRows.has(row.id) && row.retracted_at === null) plan.retractions.push(row.id);
  }

  return plan;
}
