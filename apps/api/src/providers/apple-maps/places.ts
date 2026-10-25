import {
  GREATER_SYDNEY_BOUNDS,
  isWithinGreaterSydney,
  mapSettled,
  ProviderError,
  type Coordinate,
  type PlaceSearchProvider,
  type PlaceSuggestion,
} from '@hopready/core';

import {
  APPLE_MAPS_ORIGIN,
  appleCoordinate,
  encodeQuery,
  toCoordinate,
  type AppleMapsClient,
} from './client';
import {
  autocompleteResponseSchema,
  searchResponseSchema,
  type AppleAutocompleteResult,
  type AppleLocation,
  type AppleStructuredAddress,
} from './schemas';

const MIN_QUERY_CHARACTERS = 3;
const MAX_QUERY_CHARACTERS = 200;
// The shared Place model caps names at 200 characters.
const MAX_NAME_CHARACTERS = 200;
// Each lookup is another call against Apple's 25,000 a day, so only the first few are made.
const MAX_LOOKUPS = 5;
const LOOKUP_CONCURRENCY = 3;
const LANGUAGE = 'en-AU';
const COMPLETION_URL_PREFIX = '/v1/search?';

const { north, east, south, west } = GREATER_SYDNEY_BOUNDS;
// Apple reads a search region as north latitude, east longitude, south latitude, west longitude.
const GREATER_SYDNEY_SEARCH_REGION = [north, east, south, west].join(',');

const REGION_PARAMS = {
  limitToCountries: 'AU',
  searchRegion: GREATER_SYDNEY_SEARCH_REGION,
  // MapKit documents its matching "required" priority as allowing no results outside the
  // region. Results are still checked against Greater Sydney below.
  searchRegionPriority: 'required',
  lang: LANGUAGE,
};

// A leading street number such as 10, 10A, 5/10 or 12-14, followed by the street.
const STREET_NUMBER = /^\d+[a-z]?(?:[/-]\d+[a-z]?)*\s/i;

type AppleKind = 'address' | 'poi';

interface Candidate {
  name: string;
  detail: string | null;
  location: AppleLocation | undefined;
  structuredAddress: AppleStructuredAddress | undefined;
  completionUrl: string | undefined;
}

interface Located {
  coordinate: Coordinate;
  kind: AppleKind;
}

// Results are never cached: Apple's licence (DPLA Attachment 6 section 2.5) allows Map Data to be
// kept only as long as the request needs it.
export function createApplePlaceSearch(client: AppleMapsClient): PlaceSearchProvider {
  return {
    name: 'apple-maps',

    async search(query, near, signal) {
      const text = query.trim();
      const characters = Array.from(text).length;
      if (characters < MIN_QUERY_CHARACTERS) return [];
      if (characters > MAX_QUERY_CHARACTERS) {
        throw new ProviderError(
          'apple-maps',
          'rejected-request',
          `Search text is longer than ${MAX_QUERY_CHARACTERS} characters`,
        );
      }

      const response = await client.get(
        '/v1/searchAutocomplete',
        encodeQuery({
          q: text,
          // Leaves out bare query completions such as "Cafes, Search Nearby", which are not places.
          resultTypeFilter: 'Address,Poi',
          ...REGION_PARAMS,
          userLocation: near ? appleCoordinate(near) : undefined,
        }),
        (body) => autocompleteResponseSchema.parse(body),
        signal,
      );
      const candidates = (response.results ?? []).flatMap(toCandidate);

      const needingLookup = candidates
        .filter((candidate) => candidate.location === undefined)
        .slice(0, MAX_LOOKUPS);
      const lookups = await mapSettled(needingLookup, LOOKUP_CONCURRENCY, (candidate) =>
        lookUpPlace(client, candidate, signal),
      );
      const lookupByCandidate = new Map(
        needingLookup.map((candidate, index) => [candidate, lookups[index]]),
      );

      const suggestions = candidates.flatMap((candidate): PlaceSuggestion[] => {
        const located = candidate.location
          ? {
              coordinate: toCoordinate(candidate.location),
              kind: placeKind(candidate.name, candidate.structuredAddress, undefined),
            }
          : fulfilledValue(lookupByCandidate.get(candidate));
        if (!located || !isWithinGreaterSydney(located.coordinate)) return [];
        return [
          {
            place: { name: candidate.name, coordinate: located.coordinate, kind: located.kind },
            detail: candidate.detail,
          },
        ];
      });

      // A failed lookup hides only its own suggestion, unless that leaves nothing to show.
      const failedLookup = lookups.find((outcome) => outcome.status === 'rejected');
      if (suggestions.length === 0 && failedLookup) throw failedLookup.reason;
      return suggestions;
    },
  };
}

function toCandidate(result: AppleAutocompleteResult): Candidate[] {
  const [firstLine, secondLine] = result.displayLines ?? [];
  const name = firstLine?.trim() ?? '';
  if (name.length === 0 || name.length > MAX_NAME_CHARACTERS) return [];
  return [
    {
      name,
      detail: secondLine?.trim() || null,
      location: result.location,
      structuredAddress: result.structuredAddress,
      completionUrl: result.completionUrl,
    },
  ];
}

function fulfilledValue(outcome: PromiseSettledResult<Located | null> | undefined): Located | null {
  return outcome?.status === 'fulfilled' ? outcome.value : null;
}

async function lookUpPlace(
  client: AppleMapsClient,
  candidate: Candidate,
  signal: AbortSignal,
): Promise<Located | null> {
  const response = await client.get(
    '/v1/search',
    completionQuery(candidate.completionUrl) ??
      encodeQuery({
        q: [candidate.name, candidate.detail].filter((line) => line !== null).join(' '),
        ...REGION_PARAMS,
      }),
    (body) => searchResponseSchema.parse(body),
    signal,
  );
  // The first result is the place the suggestion stands for.
  const best = response.results?.[0];
  if (!best?.coordinate) return null;
  return {
    coordinate: toCoordinate(best.coordinate),
    kind: placeKind(candidate.name, best.structuredAddress, best.poiCategory),
  };
}

// The link is followed with HopReady's access token, so only its query is used, sent to Apple's
// own host. It stays exactly as Apple encoded it, because its opaque metadata must not change.
function completionQuery(completionUrl: string | undefined): string | null {
  if (!completionUrl?.startsWith(COMPLETION_URL_PREFIX)) return null;
  const url = new URL(completionUrl, APPLE_MAPS_ORIGIN);
  const query = url.search.slice(1);
  if (query.length === 0) return null;
  // Apple leaves the language of the resolved result to the caller.
  return url.searchParams.has('lang') ? query : `${query}&${encodeQuery({ lang: LANGUAGE })}`;
}

// Autocomplete results carry no result type. A title that is a street address or names an
// administrative area is an address; any other named result is a place of interest.
function placeKind(
  title: string,
  address: AppleStructuredAddress | undefined,
  poiCategory: string | undefined,
): AppleKind {
  if (poiCategory !== undefined) return 'poi';
  if (STREET_NUMBER.test(title)) return 'address';
  const areaNames = address
    ? [
        address.fullThoroughfare,
        address.subLocality,
        address.locality,
        address.subAdministrativeArea,
        address.administrativeArea,
        address.postCode,
      ]
    : [];
  const normalisedTitle = normaliseName(title);
  return areaNames.some((area) => area !== undefined && normaliseName(area) === normalisedTitle)
    ? 'address'
    : 'poi';
}

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-AU');
}
