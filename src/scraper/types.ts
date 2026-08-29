export interface ParsedEarthquake {
  dedupeKey: string;
  sourceTimeRaw: string;
  sourceTime: string;
  magnitude: number;
  depthKm: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinatesRaw: string;
  region: string;
}

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeError";
  }
}
