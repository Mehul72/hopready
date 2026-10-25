import type { Coordinate } from '@hopready/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  type ApiError,
  type CarParkListing,
  PLACE_QUERY_MIN_LENGTH,
  type PlaceSearchResults,
  toApiError,
} from '@/api';
import { useSettings } from '@/storage';

import { type DataMode, tripService } from './trip-service';

// Waits for a pause in typing, so search sends one request per pause rather than per keystroke.
// Apple's search quota is shared by every HopReady user.
export const PLACE_SEARCH_DEBOUNCE_MS = 300;
// Apple Maps results may only be kept for temporary use, so cached searches expire quickly.
const PLACE_SEARCH_CACHE_MS = 5 * 60_000;
// The facility list changes rarely; the API itself caches it for a minute.
const CAR_PARKS_STALE_MS = 10 * 60_000;
// Two decimal places is about 1 km: enough to rank nearby results first, coarse enough that the
// search key and the request never carry a precise location.
const NEAR_DECIMALS = 2;

export const tripQueryKeys = {
  placeSearch: (mode: DataMode, query: string, near: Coordinate | null) =>
    ['place-search', mode, query, near] as const,
  carParks: (mode: DataMode) => ['car-parks', mode] as const,
};

export function useDataMode(): DataMode {
  return useSettings().demoMode ? 'demo' : 'live';
}

function coarsen(coordinate: Coordinate | null): Coordinate | null {
  if (!coordinate) return null;
  const factor = 10 ** NEAR_DECIMALS;
  return {
    lat: Math.round(coordinate.lat * factor) / factor,
    lon: Math.round(coordinate.lon * factor) / factor,
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// Every failure reaches the screen as an ApiError, so it can switch on `kind`.
async function asApiResult<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw toApiError(error);
  }
}

// Pass the text as typed. Searching starts after a short pause and needs at least
// PLACE_QUERY_MIN_LENGTH characters; until then the query is disabled (status 'pending',
// fetchStatus 'idle'), which screens should show as a prompt to keep typing, not as loading.
export function usePlaceSearch(text: string, near: Coordinate | null) {
  const mode = useDataMode();
  const query = useDebouncedValue(text.trim(), PLACE_SEARCH_DEBOUNCE_MS);
  const nearHint = coarsen(near);
  return useQuery<PlaceSearchResults, ApiError>({
    queryKey: tripQueryKeys.placeSearch(mode, query, nearHint),
    queryFn: ({ signal }) => asApiResult(tripService.searchPlaces(query, nearHint, { signal })),
    enabled: query.length >= PLACE_QUERY_MIN_LENGTH,
    staleTime: PLACE_SEARCH_CACHE_MS,
    gcTime: PLACE_SEARCH_CACHE_MS,
  });
}

// Documented Park&Ride car parks, for "which car park did you use?" and the Car tab. Space counts
// are unknown here in both modes; plans carry counts for the car parks they use.
export function useCarParks() {
  const mode = useDataMode();
  return useQuery<CarParkListing, ApiError>({
    queryKey: tripQueryKeys.carParks(mode),
    queryFn: ({ signal }) => asApiResult(tripService.listCarParks({ signal })),
    staleTime: CAR_PARKS_STALE_MS,
  });
}
