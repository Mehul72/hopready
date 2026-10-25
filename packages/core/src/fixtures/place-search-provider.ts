import { z } from 'zod';

import { haversineMetres, type Coordinate } from '../geo';
import { coordinateSchema, type Place } from '../model';
import { ProviderError, type PlaceSearchProvider, type PlaceSuggestion } from '../providers';
import { DEMO_PROVIDER_NAME, throwIfAborted } from './abort';
import { DEMO_PLACE_ENTRIES, type DemoPlaceEntry } from './places';
import { NETWORK_ROUTES } from './routes';
import { NETWORK_STOPS, type NetworkStop } from './stops';

// Search over the demo places and stops, matching each word typed against the start of a word in
// the name or suburb, case-insensitively.

const MAX_SUGGESTIONS = 8;
const MAX_QUERY_LENGTH = 200;

const searchInputSchema = z.object({
  query: z.string().max(MAX_QUERY_LENGTH),
  near: coordinateSchema.nullable(),
});

interface Candidate {
  place: Place;
  detail: string;
  nameWords: readonly string[];
  localityWords: readonly string[];
  normalisedName: string;
}

// Built once: the demo places and stops never change while the app runs.
const CANDIDATES: readonly Candidate[] = buildCandidates();

export function createDemoPlaceSearchProvider(): PlaceSearchProvider {
  return {
    name: DEMO_PROVIDER_NAME,
    async search(query, near, signal) {
      throwIfAborted(signal);
      const parsed = searchInputSchema.safeParse({ query, near });
      if (!parsed.success) {
        throw new ProviderError(
          DEMO_PROVIDER_NAME,
          'rejected-request',
          'The demo place search is not valid',
          {
            cause: parsed.error,
          },
        );
      }
      return searchDemoPlaces(parsed.data.query, parsed.data.near);
    },
  };
}

function searchDemoPlaces(query: string, near: Coordinate | null): PlaceSuggestion[] {
  const normalisedQuery = normalise(query);
  const queryWords = words(normalisedQuery);
  if (queryWords.length === 0) return [];

  const matches = CANDIDATES.filter((candidate) =>
    queryWords.every((word) => matchesWord(candidate, word)),
  ).map((candidate) => ({
    candidate,
    rank: rankOf(candidate, normalisedQuery, queryWords[0]!),
    distanceMetres: near ? haversineMetres(near, candidate.place.coordinate) : 0,
  }));

  matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.distanceMetres - b.distanceMetres ||
      compareText(a.candidate.normalisedName, b.candidate.normalisedName),
  );
  return matches.slice(0, MAX_SUGGESTIONS).map(({ candidate }) => ({
    place: { ...candidate.place, coordinate: { ...candidate.place.coordinate } },
    detail: candidate.detail,
  }));
}

function matchesWord(candidate: Candidate, queryWord: string): boolean {
  const startsWithQuery = (word: string) => word.startsWith(queryWord);
  return candidate.nameWords.some(startsWithQuery) || candidate.localityWords.some(startsWithQuery);
}

// Whole-name prefix first, then a name word, then a suburb-only match.
function rankOf(candidate: Candidate, normalisedQuery: string, firstWord: string): number {
  if (candidate.normalisedName.startsWith(normalisedQuery)) return 0;
  if (candidate.nameWords.some((word) => word.startsWith(firstWord))) return 1;
  return 2;
}

function buildCandidates(): Candidate[] {
  const placeCandidates = Object.values(DEMO_PLACE_ENTRIES).map((entry) =>
    candidate(entry.place, entry.locality, describePlace(entry)),
  );
  const servedBy = routesByStop();
  const stopCandidates = NETWORK_STOPS.map((stop) =>
    candidate(
      { name: stop.name, coordinate: stop.coordinate, kind: 'stop', stopId: stop.id },
      stop.locality,
      `${stop.locality}, served by ${joinWithAnd(servedBy.get(stop) ?? [])}`,
    ),
  );
  return [...placeCandidates, ...stopCandidates];
}

function candidate(place: Place, locality: string, detail: string): Candidate {
  const normalisedName = normalise(place.name);
  return {
    place,
    detail,
    nameWords: words(normalisedName),
    localityWords: words(normalise(locality)),
    normalisedName,
  };
}

function describePlace(entry: DemoPlaceEntry): string {
  switch (entry.role) {
    case 'home':
      return `Demo home in ${entry.locality}`;
    case 'office':
      return `Demo office in ${entry.locality}`;
    case 'landmark':
      return entry.locality;
  }
}

function routesByStop(): Map<NetworkStop, string[]> {
  const routes = new Map<NetworkStop, string[]>();
  for (const route of NETWORK_ROUTES) {
    for (const direction of route.directions) {
      for (const { stop } of direction.calls) {
        const names = routes.get(stop) ?? [];
        if (!names.includes(route.id)) names.push(route.id);
        routes.set(stop, names);
      }
    }
  }
  return routes;
}

function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(normalisedText: string): string[] {
  return normalisedText.length === 0 ? [] : normalisedText.split(' ');
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
