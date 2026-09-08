import { describe, expect, it } from "vitest";
import type { ParsedEarthquake } from "../scraper/types";
import { reconcile, type StoredEvent } from "./reconcile";

function page(overrides: Partial<ParsedEarthquake> = {}): ParsedEarthquake {
  return {
    dedupeKey: "id:588683",
    sourceTimeRaw: "2026-09-08 04:52:15",
    sourceTime: "2026-09-08T04:52:15.000Z",
    magnitude: 4.2,
    depthKm: 10,
    latitude: 41.6103,
    longitude: 43.5756,
    coordinatesRaw: "41.6103/43.5756",
    region: "City Tsalka - South - 8km.",
    ...overrides,
  };
}

function stored(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 1,
    dedupe_key: "id:588681",
    source_time: "2026-09-08T04:52:16.000Z",
    source_time_raw: "2026-09-08 04:52:16",
    magnitude: 4.1,
    depth_km: 10,
    latitude: 41.613,
    longitude: 43.552,
    coordinates_raw: "41.613/43.552",
    region: "City Tsalka - South - 8km.",
    ...overrides,
  };
}

describe("reconcile", () => {
  // Ровно тот случай, ради которого всё затевалось: 08.09.2026 источник заменил
  // id:588681 (04:52:16, M4.1) на id:588683 (04:52:15, M4.2). Прежний дедуп по
  // ключу видел здесь новое событие и слал второй алерт о том же толчке.
  it("узнаёт ревизию по близким времени и координатам и не заводит новое событие", () => {
    const plan = reconcile([page()], [stored()]);

    expect(plan.inserts).toEqual([]);
    expect(plan.retractions).toEqual([]);
    expect(plan.revisions).toEqual([{ id: 1, event: page() }]);
  });

  // Афтершок в тех же координатах через три минуты — самостоятельное событие,
  // и алерт по нему обязан уйти. Из-за него окно матчинга узкое.
  it("не считает ревизией событие, отстоящее по времени дальше окна", () => {
    const aftershock = page({
      dedupeKey: "id:588687",
      sourceTimeRaw: "2026-09-08 04:55:35",
      sourceTime: "2026-09-08T04:55:35.000Z",
      magnitude: 3,
      latitude: 41.6098,
      longitude: 43.5585,
      coordinatesRaw: "41.6098/43.5585",
    });

    // Якорь держит нижнюю границу окна: без него исчезнувшая строка оказалась бы
    // старше самого старого события страницы и в сверку бы не попала.
    const anchor = page({
      dedupeKey: "id:588600",
      sourceTimeRaw: "2026-09-08 04:00:00",
      sourceTime: "2026-09-08T04:00:00.000Z",
    });
    const anchorRow = stored({
      id: 5,
      dedupe_key: "id:588600",
      source_time: "2026-09-08T04:00:00.000Z",
      source_time_raw: "2026-09-08 04:00:00",
      magnitude: anchor.magnitude,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      coordinates_raw: anchor.coordinatesRaw,
    });

    const plan = reconcile([anchor, aftershock], [anchorRow, stored()]);

    expect(plan.revisions).toEqual([]);
    expect(plan.inserts).toEqual([aftershock]);
    expect(plan.retractions).toEqual([1]);
  });

  it("не считает ревизией событие, отстоящее по координатам дальше окна", () => {
    const elsewhere = page({ latitude: 43.6, longitude: 45.7, coordinatesRaw: "43.638/45.6976" });

    const plan = reconcile([elsewhere], [stored()]);

    expect(plan.revisions).toEqual([]);
    expect(plan.inserts).toEqual([elsewhere]);
    expect(plan.retractions).toEqual([1]);
  });

  it("помечает отозванным событие, исчезнувшее со страницы без замены", () => {
    const plan = reconcile(
      [page({ dedupeKey: "id:588683" })],
      [stored({ id: 7, dedupe_key: "id:588683" }), stored({ id: 8, dedupe_key: "id:588600" })],
    );

    expect(plan.retractions).toEqual([8]);
    expect(plan.inserts).toEqual([]);
  });

  it("вставляет событие, которого в базе нет и заменить нечего", () => {
    const plan = reconcile([page()], []);

    expect(plan.inserts).toEqual([page()]);
    expect(plan.revisions).toEqual([]);
    expect(plan.retractions).toEqual([]);
  });

  // Строки старше окна страницы просто выпали из выдачи источника — трогать их
  // нельзя, иначе весь архив уедет в отозванные на первом же тике.
  it("не трогает события старше самого старого события страницы", () => {
    const archived = stored({ id: 9, dedupe_key: "id:581554", source_time: "2026-06-01T00:00:00.000Z" });

    const plan = reconcile([page()], [archived]);

    expect(plan.retractions).toEqual([]);
    expect(plan.revisions).toEqual([]);
    expect(plan.inserts).toEqual([page()]);
  });

  it("обновляет событие с прежним ключом, если источник поправил его поля", () => {
    const corrected = page({ dedupeKey: "id:588681", magnitude: 4.4, region: "Другой регион" });

    const plan = reconcile([corrected], [stored()]);

    expect(plan.refreshes).toEqual([{ id: 1, event: corrected }]);
    expect(plan.revisions).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  // Иначе каждый тик переписывал бы всю тридцатку строк — впустую, но с оплатой
  // записей D1.
  it("не обновляет событие, которое не изменилось", () => {
    const unchanged = page({
      dedupeKey: "id:588681",
      sourceTimeRaw: "2026-09-08 04:52:16",
      sourceTime: "2026-09-08T04:52:16.000Z",
      magnitude: 4.1,
      latitude: 41.613,
      longitude: 43.552,
      coordinatesRaw: "41.613/43.552",
    });

    expect(reconcile([unchanged], [stored()]).refreshes).toEqual([]);
  });

  // Пустая выдача означает сломанный или подменённый источник, а не то, что все
  // события отозваны разом.
  it("ничего не меняет, если страница не дала ни одного события", () => {
    expect(reconcile([], [stored()])).toEqual({
      refreshes: [],
      revisions: [],
      inserts: [],
      retractions: [],
    });
  });

  // Пара событий в одном рое: каждая ревизия обязана лечь на своего предшественника,
  // а не на ближайшего по списку.
  it("разводит несколько ревизий по ближайшим предшественникам", () => {
    const first = page();
    const second = page({
      dedupeKey: "id:588685",
      sourceTimeRaw: "2026-09-08 05:09:09",
      sourceTime: "2026-09-08T05:09:09.000Z",
      magnitude: 3.1,
      latitude: 41.6123,
      longitude: 43.5681,
      coordinatesRaw: "41.6123/43.5681",
    });

    const plan = reconcile(
      [first, second],
      [
        stored(),
        stored({
          id: 2,
          dedupe_key: "id:588684",
          source_time: "2026-09-08T05:09:10.000Z",
          source_time_raw: "2026-09-08 05:09:10",
          magnitude: 3,
          latitude: 41.5958,
          longitude: 43.5414,
          coordinates_raw: "41.5958/43.5414",
        }),
      ],
    );

    expect(plan.revisions).toEqual([
      { id: 1, event: first },
      { id: 2, event: second },
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.retractions).toEqual([]);
  });

  it("не считает ревизией событие без распознанных координат", () => {
    const noCoordinates = page({ latitude: null, longitude: null, coordinatesRaw: "—" });

    const plan = reconcile([noCoordinates], [stored()]);

    expect(plan.revisions).toEqual([]);
    expect(plan.inserts).toEqual([noCoordinates]);
    expect(plan.retractions).toEqual([1]);
  });
});
