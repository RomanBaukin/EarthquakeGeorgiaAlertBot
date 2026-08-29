export interface EarthquakeStats {
  count: number;
  averageMagnitude: number | null;
  maxMagnitude: number | null;
}

export function computeStats(events: { magnitude: number }[]): EarthquakeStats {
  if (events.length === 0) {
    return { count: 0, averageMagnitude: null, maxMagnitude: null };
  }

  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    sum += event.magnitude;
    if (event.magnitude > max) max = event.magnitude;
  }

  return {
    count: events.length,
    averageMagnitude: Math.round((sum / events.length) * 10) / 10,
    maxMagnitude: max,
  };
}
