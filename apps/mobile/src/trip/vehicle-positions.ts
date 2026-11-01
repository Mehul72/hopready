import {
  type Itinerary,
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

export interface TrackedLeg {
  leg: TransitLeg;
  legIndex: number;
  service: TrackedService;
  // False while the service starts more than VEHICLE_LOOKAHEAD_MS from now.
  due: boolean;
}

// The services of a trip whose vehicles can be looked for: public transport legs with TfNSW's trip
// id that have not been cancelled or finished. A leg TfNSW does not mark as live still has a trip
// id, and is asked about anyway: buses are often in the feed before the trip planner says so.
export function trackedLegsOf(itinerary: Itinerary, nowMs: number): TrackedLeg[] {
  return itinerary.legs
    .flatMap((leg, legIndex): TrackedLeg[] => {
      if (leg.kind !== 'transit' || leg.realtimeTripId === null || leg.cancelled) return [];
      if (Date.parse(leg.end) <= nowMs) return [];
      return [
        {
          leg,
          legIndex,
          service: { mode: leg.mode, realtimeTripId: leg.realtimeTripId },
          due: Date.parse(leg.start) - nowMs <= VEHICLE_LOOKAHEAD_MS,
        },
      ];
    })
    .slice(0, MAX_TRACKED_SERVICES);
}

export interface VehiclePositions {
  // The latest answer, by trackedServiceKey. Kept while the next one is on its way.
  lookups: ReadonlyMap<string, VehicleLookup>;
  checkedAt: string | null;
  mode: VehiclesResponse['mode'] | null;
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
  const services = trackedLegs.filter((tracked) => tracked.due).map((tracked) => tracked.service);
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
    mode: response?.mode ?? null,
    checking: services.length > 0 && active && query.isPending,
    failed: query.isError,
  };
}
