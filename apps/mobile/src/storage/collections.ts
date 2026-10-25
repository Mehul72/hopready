import { type Coordinate, haversineMetres, type Place } from '@hopready/core';

// Two saved entries closer than this are the same spot: geocoders and stop datasets disagree by a
// few metres, and nobody saves two favourites across the street from each other on purpose.
export const SAME_PLACE_METRES = 25;

export type AddResult<T> =
  | { status: 'added'; item: T }
  | { status: 'already-saved'; item: T }
  | { status: 'limit-reached'; limit: number };

export function isSameSpot(a: Coordinate, b: Coordinate): boolean {
  return haversineMetres(a, b) <= SAME_PLACE_METRES;
}

export function isSamePlace(a: Place, b: Place): boolean {
  if (a.stopId !== undefined && b.stopId !== undefined) return a.stopId === b.stopId;
  return isSameSpot(a.coordinate, b.coordinate);
}

// Returns null when nothing matched, so callers can report "not found" instead of writing.
export function replaceById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  change: (item: T) => T,
): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  return items.map((item, position) => (position === index ? change(item) : item));
}
