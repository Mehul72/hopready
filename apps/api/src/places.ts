import {
  coordinateSchema,
  haversineMetres,
  isWithinGreaterSydney,
  placeSchema,
  type Coordinate,
  type PlaceSearchProvider,
  type PlaceSuggestion,
  type ProviderError,
} from '@hopready/core';
import { z } from 'zod';

import { callProvider, toProviderError, type LateOutcomeHandler } from './deadline';

export const placeSearchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine((query) => !/\p{Cc}/u.test(query), 'Control characters are not allowed'),
  near: coordinateSchema.nullish(),
});

const placeSuggestionSchema = z.object({
  place: placeSchema,
  detail: z.string().max(300).nullable(),
});

export const MAX_PLACE_RESULTS = 10;
export const DUPLICATE_PLACE_RADIUS_METRES = 150;
// Stops are listed first, but a long stop list must not push every address out.
const FIRST_SHARE_PER_SOURCE = 5;

// "St. Leonards Station" and "st leonards station" name the same place.
export function normalisePlaceName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Keeps the first of any two suggestions with the same name within 150 m, so a stop listed by
// both providers appears once, as the stop. Places outside Greater Sydney are left out because
// trips to or from them cannot be planned.
export function mergePlaceSuggestions(
  lists: readonly (readonly PlaceSuggestion[])[],
): PlaceSuggestion[] {
  const sources = lists.filter((list) => list.length > 0);
  const ordered =
    sources.length > 1
      ? [
          ...sources.flatMap((list) => list.slice(0, FIRST_SHARE_PER_SOURCE)),
          ...sources.flatMap((list) => list.slice(FIRST_SHARE_PER_SOURCE)),
        ]
      : sources.flat();
  const merged: { suggestion: PlaceSuggestion; name: string }[] = [];
  for (const suggestion of ordered) {
    if (merged.length === MAX_PLACE_RESULTS) break;
    if (!isWithinGreaterSydney(suggestion.place.coordinate)) continue;
    const name = normalisePlaceName(suggestion.place.name);
    const duplicate = merged.some(
      (kept) =>
        kept.name === name &&
        haversineMetres(kept.suggestion.place.coordinate, suggestion.place.coordinate) <=
          DUPLICATE_PLACE_RADIUS_METRES,
    );
    if (!duplicate) merged.push({ suggestion, name });
  }
  return merged.map(({ suggestion }) => suggestion);
}

export interface PlaceSearchOutcome {
  results: PlaceSuggestion[];
  failures: ProviderError[];
  // Suggestions a provider returned in a shape the app could not use.
  droppedCount: number;
}

// Asks every provider at once. One failing provider leaves the others' results intact.
export async function searchPlaces(
  providers: readonly PlaceSearchProvider[],
  request: { query: string; near: Coordinate | null },
  options: { timeoutMs: number; signal: AbortSignal; onLateOutcome: LateOutcomeHandler },
): Promise<PlaceSearchOutcome> {
  const settled = await Promise.allSettled(
    providers.map((provider) =>
      callProvider(
        provider.name,
        (signal) => provider.search(request.query, request.near, signal),
        options,
      ),
    ),
  );

  const lists: PlaceSuggestion[][] = [];
  const failures: ProviderError[] = [];
  let droppedCount = 0;
  settled.forEach((outcome, index) => {
    const provider = providers[index]!;
    if (outcome.status === 'rejected') {
      const reason: unknown = outcome.reason;
      failures.push(toProviderError(reason, provider.name));
      return;
    }
    const usable = outcome.value.filter(
      (suggestion) => placeSuggestionSchema.safeParse(suggestion).success,
    );
    droppedCount += outcome.value.length - usable.length;
    lists.push(usable);
  });

  return { results: mergePlaceSuggestions(lists), failures, droppedCount };
}
