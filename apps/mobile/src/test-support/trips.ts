import {
  addMinutes,
  buildItinerary,
  DEFAULT_PREFERENCES,
  type Itinerary,
  type Leg,
  type Parking,
  type Place,
  type PlanRequest,
  type PlanResponse,
  STANDARD_PARK_AND_RIDE_RULES,
  type TransitMode,
} from '@hopready/core';

// Small, valid trip data for tests. Real trips come from the planner and its providers.

export function place(
  name: string,
  lat: number,
  lon: number,
  kind: Place['kind'] = 'address',
  ids: { stopId?: string; carParkId?: string } = {},
): Place {
  return { name, coordinate: { lat, lon }, kind, ...ids };
}

export const PLACES = {
  rouseHillHome: place('12 Example St, Rouse Hill', -33.6789, 150.9152),
  tallawongCarPark: place('Tallawong P1', -33.69305, 150.90526, 'car-park', { carParkId: '26' }),
  tallawongStation: place('Tallawong Station', -33.69163, 150.906022, 'stop', {
    stopId: '2155384',
  }),
  chatswoodStation: place('Chatswood Station', -33.7969, 151.1803, 'stop', { stopId: '206710' }),
  chatswoodOffice: place('1 Help St, Chatswood', -33.7975, 151.1832),
  melbourne: place('Flinders Street, Melbourne', -37.8183, 144.9671),
} as const;

export function planRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    origin: PLACES.rouseHillHome,
    destination: PLACES.chatswoodOffice,
    time: { type: 'depart', at: '2026-10-26T21:00:00.000Z' },
    access: { transit: true, drive: true, dropOff: false },
    preferences: { ...DEFAULT_PREFERENCES, excludedTransitModes: [] },
    trip: { kind: 'outbound' },
    ...overrides,
  };
}

function walkLeg(id: string, from: Place, to: Place, start: string, minutes: number): Leg {
  return {
    id,
    kind: 'walk',
    from,
    to,
    start,
    end: addMinutes(start, minutes),
    source: 'tfnsw-trip-planner',
    timing: 'estimated',
    distanceMetres: minutes * 80,
  };
}

function transitLeg(
  from: Place,
  to: Place,
  start: string,
  minutes: number,
  service: { name: string; mode: TransitMode; realtime: boolean },
): Leg {
  const end = addMinutes(start, minutes);
  return {
    id: `transit-${service.name}-${start}`,
    kind: 'transit',
    from,
    to,
    start,
    end,
    source: 'tfnsw-trip-planner',
    timing: service.realtime ? 'realtime' : 'scheduled',
    mode: service.mode,
    service: { name: service.name, description: null, headsign: null, operator: null },
    scheduledStart: start,
    scheduledEnd: end,
    departurePlatform: null,
    arrivalPlatform: null,
    stopCount: null,
    cancelled: false,
    alerts: [],
    realtimeTripId: null,
  };
}

export interface ItineraryOptions {
  // When the traveller leaves the origin.
  departAt: string;
  service?: string;
  mode?: TransitMode;
  realtime?: boolean;
}

// Walk 10 min, ride 40 min, walk 5 min.
export function transitItinerary({
  departAt,
  service = 'M1',
  mode = 'metro',
  realtime = false,
}: ItineraryOptions): Itinerary {
  const boardAt = addMinutes(departAt, 10);
  const alightAt = addMinutes(boardAt, 40);
  return buildItinerary({
    strategy: 'transit-only',
    legs: [
      walkLeg('walk-to-station', PLACES.rouseHillHome, PLACES.tallawongStation, departAt, 10),
      transitLeg(PLACES.tallawongStation, PLACES.chatswoodStation, boardAt, 40, {
        name: service,
        mode,
        realtime,
      }),
      walkLeg('walk-to-office', PLACES.chatswoodStation, PLACES.chatswoodOffice, alightAt, 5),
    ],
  });
}

export const TALLAWONG_PARKING: Parking = {
  carPark: {
    id: '26',
    name: 'Tallawong P1',
    coordinate: PLACES.tallawongCarPark.coordinate,
    kind: 'transport-park-and-ride',
    stationName: 'Tallawong Station',
    totalSpaces: 121,
  },
  occupancy: { status: 'unknown', reason: 'Occupancy figures are unavailable right now.' },
  rules: STANDARD_PARK_AND_RIDE_RULES,
};

// Drive 6 min with a provider path, park 8 min, walk 3 min, metro 40 min, walk 5 min.
export function parkAndRideItinerary({
  departAt,
  service = 'M1',
  realtime = false,
}: ItineraryOptions): Itinerary {
  const parkedAt = addMinutes(departAt, 6);
  const readyAt = addMinutes(parkedAt, 8);
  const boardAt = addMinutes(readyAt, 3);
  const alightAt = addMinutes(boardAt, 40);
  return buildItinerary({
    strategy: 'park-and-ride',
    parking: TALLAWONG_PARKING,
    legs: [
      {
        id: 'drive-to-car-park',
        kind: 'drive',
        from: PLACES.rouseHillHome,
        to: PLACES.tallawongCarPark,
        start: departAt,
        end: parkedAt,
        source: 'apple-maps',
        timing: 'estimated',
        distanceMetres: 2_400,
        trafficAware: true,
        path: [
          PLACES.rouseHillHome.coordinate,
          { lat: -33.685, lon: 150.91 },
          PLACES.tallawongCarPark.coordinate,
        ],
      },
      {
        id: 'park-26',
        kind: 'park',
        from: PLACES.tallawongCarPark,
        to: PLACES.tallawongCarPark,
        start: parkedAt,
        end: readyAt,
        source: 'hopready',
        timing: 'buffer',
        parking: TALLAWONG_PARKING,
      },
      walkLeg('walk-to-platform', PLACES.tallawongCarPark, PLACES.tallawongStation, readyAt, 3),
      transitLeg(PLACES.tallawongStation, PLACES.chatswoodStation, boardAt, 40, {
        name: service,
        mode: 'metro',
        realtime,
      }),
      walkLeg('walk-to-office', PLACES.chatswoodStation, PLACES.chatswoodOffice, alightAt, 5),
    ],
  });
}

// Drive 35 min, all the way to the destination.
export function driveOnlyItinerary({ departAt }: Pick<ItineraryOptions, 'departAt'>): Itinerary {
  return buildItinerary({
    strategy: 'drive-only',
    legs: [
      {
        id: 'drive-to-office',
        kind: 'drive',
        from: PLACES.rouseHillHome,
        to: PLACES.chatswoodOffice,
        start: departAt,
        end: addMinutes(departAt, 35),
        source: 'apple-maps',
        timing: 'estimated',
        distanceMetres: 31_000,
        trafficAware: true,
      },
    ],
  });
}

// Ride 6 min to Tallawong Station, drop-off 2 min, metro 40 min, walk 5 min.
export function dropOffItinerary({ departAt }: Pick<ItineraryOptions, 'departAt'>): Itinerary {
  const droppedAt = addMinutes(departAt, 6);
  const readyAt = addMinutes(droppedAt, 2);
  const alightAt = addMinutes(readyAt, 40);
  return buildItinerary({
    strategy: 'drop-off',
    legs: [
      {
        id: 'ride-to-station',
        kind: 'ride',
        from: PLACES.rouseHillHome,
        to: PLACES.tallawongStation,
        start: departAt,
        end: droppedAt,
        source: 'apple-maps',
        timing: 'estimated',
        distanceMetres: 2_600,
        trafficAware: true,
      },
      {
        id: 'drop-off-tallawong',
        kind: 'drop-off',
        from: PLACES.tallawongStation,
        to: PLACES.tallawongStation,
        start: droppedAt,
        end: readyAt,
        source: 'hopready',
        timing: 'buffer',
      },
      transitLeg(PLACES.tallawongStation, PLACES.chatswoodStation, readyAt, 40, {
        name: 'M1',
        mode: 'metro',
        realtime: false,
      }),
      walkLeg('walk-to-office', PLACES.chatswoodStation, PLACES.chatswoodOffice, alightAt, 5),
    ],
  });
}

export function planResponse(
  itineraries: Itinerary[],
  options: { mode?: 'live' | 'demo'; generatedAt?: string } = {},
): PlanResponse {
  return {
    mode: options.mode ?? 'live',
    generatedAt: options.generatedAt ?? '2026-10-26T20:55:00.000Z',
    itineraries,
    rejected: [],
    checkedCarParks: [],
    unavailable: [],
    notices: [],
  };
}
