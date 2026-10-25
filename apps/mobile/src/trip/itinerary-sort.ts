import type { Itinerary } from '@hopready/core';

export const ITINERARY_SORTS = ['best', 'shortest', 'least-walking', 'fewest-changes'] as const;
export type ItinerarySort = (typeof ITINERARY_SORTS)[number];

export const ITINERARY_SORT_LABELS: Readonly<Record<ItinerarySort, string>> = {
  best: 'Best',
  shortest: 'Shortest',
  'least-walking': 'Least walking',
  'fewest-changes': 'Fewest changes',
};

const SORT_KEYS: Readonly<
  Record<Exclude<ItinerarySort, 'best'>, (itinerary: Itinerary) => number>
> = {
  shortest: (itinerary) => itinerary.durationSeconds,
  'least-walking': (itinerary) => itinerary.walkSeconds,
  'fewest-changes': (itinerary) => itinerary.transfers,
};

// 'best' keeps the planner's order: earliest arrival for "leave at", latest departure for
// "arrive by". The other sorts are stable, so ties keep that order too.
export function sortItineraries(
  itineraries: readonly Itinerary[],
  sort: ItinerarySort,
): Itinerary[] {
  if (sort === 'best') return [...itineraries];
  const key = SORT_KEYS[sort];
  return [...itineraries].sort((a, b) => key(a) - key(b));
}
