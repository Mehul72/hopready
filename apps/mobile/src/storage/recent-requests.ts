import type { Place, PlanRequest } from '@hopready/core';

import type { KeyValueBackend } from './backend';
import { MAX_RECENT_REQUESTS, recentRequestsSchema } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export interface RecentRequestsStore extends ManagedStoredValue<PlanRequest[]> {
  // Newest first. A request for the same trip replaces the older one.
  record: (request: PlanRequest) => void;
  clear: () => void;
}

// About 11 m: GPS noise and geocoder differences should not create separate entries.
const KEY_DECIMALS = 4;

function placeKey(place: Place): string {
  // "Current location" means wherever the person is when they reuse it, so its coordinates are
  // not part of the identity.
  if (place.kind === 'current-location') return 'current-location';
  if (place.stopId) return `stop:${place.stopId}`;
  return `${place.coordinate.lat.toFixed(KEY_DECIMALS)},${place.coordinate.lon.toFixed(KEY_DECIMALS)}`;
}

// Two requests are the same recent trip when they go between the same places for the same kind of
// trip. The time and options are not compared: reusing a recent trip takes its latest settings.
export function recentRequestKey(request: PlanRequest): string {
  return [request.trip.kind, placeKey(request.origin), placeKey(request.destination)].join('|');
}

export function createRecentRequestsStore(backend: KeyValueBackend): RecentRequestsStore {
  const stored = createStoredValue(backend, {
    name: 'recent-requests',
    version: 1,
    schema: recentRequestsSchema,
    defaultValue: (): PlanRequest[] => [],
  });

  return {
    ...stored,
    record: (request) => {
      const key = recentRequestKey(request);
      stored.update((current) =>
        [request, ...current.filter((recent) => recentRequestKey(recent) !== key)].slice(
          0,
          MAX_RECENT_REQUESTS,
        ),
      );
    },
    clear: () => {
      stored.set([]);
    },
  };
}
