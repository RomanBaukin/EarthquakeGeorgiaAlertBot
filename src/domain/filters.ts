export interface SubscriptionFilter {
  minMagnitude: number;
  regionKeyword: string | null;
}

export function matchesSubscription(
  event: { magnitude: number; region: string },
  filter: SubscriptionFilter,
): boolean {
  if (event.magnitude < filter.minMagnitude) return false;

  const keyword = filter.regionKeyword?.trim().toLowerCase();
  if (!keyword) return true;

  return event.region.toLowerCase().includes(keyword);
}
