import {
  type Itinerary,
  isTrackedVehicleMode,
  MAX_TRACKED_SERVICES,
  type TrackedService,
  trackedServiceKey,
  type TransitLeg,
  type VehicleLookup,
  type VehiclesResponse,
} from '@hopready/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ApiError } from '@/api';

import { asApiResult, useDataMode } from './queries';
import { tripService } from './trip-service';

// How often an open map asks again. TfNSW refreshes its live feeds about every 15 seconds.
export const VEHICLE_REFRESH_MS = 15_000;
// A service starting further ahead is not asked about yet: TfNSW's bus feed lists trips from about
// an hour before they start, and a vehicle that far off says little about this trip.
export const VEHICLE_LOOKAHEAD_MS = 60 * 60_000;
// A service is still looked for this long after its planned end, so one running late stays on the
// map; TfNSW's feed drops a trip once it has finished.
export const PAST_PLANNED_END_MS = 15 * 60_000;

export interface TrackedLeg {
  leg: TransitLeg;
  legIndex: number;
  service: TrackedService;
  // HopReady reads a live feed for the mode (bus, train, metro). Other services are listed but
  // never sent: the live data agreement names only those three.
  hasFeed: boolean;
  // False while the service starts more than VEHICLE_LOOKAHEAD_MS from now.
  due: boolean;
  // Its planned end has passed, but it may be running late.
  pastPlannedEnd: boolean;
}

// The services of a trip whose vehicles can be looked for: public transport legs with TfNSW's trip
// id that have not been cancelled or long finished. A leg TfNSW does not mark as live still has a
// trip id, and is asked about anyway: buses are often in the feed before the trip planner says so.
export function trackedLegsOf(itinerary: Itinerary, nowMs: number): TrackedLeg[] {
  return itinerary.legs
    .flatMap((leg, legIndex): TrackedLeg[] => {
      if (leg.kind !== 'transit' || leg.realtimeTripId === null || leg.cancelled) return [];
      const endMs = Date.parse(leg.end);
      if (endMs + PAST_PLANNED_END_MS <= nowMs) return [];
      return [
        {
          leg,
          legIndex,
          service: { mode: leg.mode, realtimeTripId: leg.realtimeTripId },
          hasFeed: isTrackedVehicleMode(leg.mode),
          due: Date.parse(leg.start) - nowMs <= VEHICLE_LOOKAHEAD_MS,
          pastPlannedEnd: endMs <= nowMs,
        },
      ];
    })
    .slice(0, MAX_TRACKED_SERVICES);
}

export interface VehiclePositions {
  // The latest answer, by trackedServiceKey. Kept while the next one is on its way.
  lookups: ReadonlyMap<string, VehicleLookup>;
  // The server's time when it read the feeds, and the phone's time when that answer arrived. A
  // position's age is the gap the server saw plus the time since, so it keeps growing while checks
  // fail, and a phone clock that disagrees with the server's cannot skew it.
  checkedAt: string | null;
  receivedAtMs: number | null;
  // The mode of the latest answer, or the app's own mode before the first one arrives.
  mode: VehiclesResponse['mode'];
  // The first answer is still coming.
  checking: boolean;
  // The latest request failed; lookups, if any, are from the one before.
  failed: boolean;
}

const NO_LOOKUPS: ReadonlyMap<string, VehicleLookup> = new Map();

// Polls for the due services' vehicles while `active` (the map is on screen). The query client
// pauses intervals while the app is in the background, so nothing is asked then. No retries: the
// next poll is 15 seconds away anyway.
export function useVehiclePositions(
  trackedLegs: readonly TrackedLeg[],
  { active }: { active: boolean },
): VehiclePositions {
  const dataMode = useDataMode();
  const services = trackedLegs
    .filter((tracked) => tracked.due && tracked.hasFeed)
    .map((tracked) => tracked.service);
  const query = useQuery<VehiclesResponse, ApiError>({
    queryKey: ['vehicles', dataMode, ...services.map(trackedServiceKey)],
    queryFn: ({ signal }) => asApiResult(tripService.locateVehicles(services, { signal })),
    enabled: active && services.length > 0,
    refetchInterval: VEHICLE_REFRESH_MS,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const response = query.data;
  return {
    lookups: response
      ? new Map(response.vehicles.map((lookup) => [trackedServiceKey(lookup), lookup]))
      : NO_LOOKUPS,
    checkedAt: response?.checkedAt ?? null,
    receivedAtMs: response ? query.dataUpdatedAt : null,
    mode: response?.mode ?? dataMode,
    checking: services.length > 0 && active && query.isPending,
    failed: query.isError,
  };
}
