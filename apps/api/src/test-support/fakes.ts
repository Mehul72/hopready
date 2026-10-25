// Deterministic stand-ins for providers, clock, logger and config, used only by tests.
import {
  DEFAULT_PREFERENCES,
  type CarParkFacility,
  type CarParkProvider,
  type Clock,
  type Coordinate,
  type DriveRoute,
  type DrivingProvider,
  type Leg,
  type Occupancy,
  type Place,
  type PlaceSearchProvider,
  type PlaceSuggestion,
  type PlanRequest,
  type ProviderName,
  type TransitJourney,
  type TransitLeg,
  type TransitProvider,
  type TransitQuery,
} from '@hopready/core';

import { createApp, type ClientAddressResolver } from '../app';
import type { ApiConfig } from '../config';
import { createLogger, type LogEntry, type Logger, type LogLevel } from '../logger';
import type { ProviderSet } from '../provider-set';
import { SlidingWindowRateLimiter, type RateLimiter } from '../rate-limit';

// 07:30 on a Tuesday in Sydney (AEDT).
export const NOW = '2026-10-26T20:30:00.000Z';

export interface TestClock extends Clock {
  set(iso: string): void;
  advanceMs(ms: number): void;
}

export function testClock(iso = NOW): TestClock {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next).getTime();
    },
    advanceMs: (ms) => {
      current += ms;
    },
  };
}

export interface CapturedLogs {
  logger: Logger;
  entries: LogEntry[];
  lines(): string[];
}

export function capturingLogger(level: LogLevel = 'debug'): CapturedLogs {
  const entries: LogEntry[] = [];
  return {
    logger: createLogger({ level, sink: (entry) => entries.push(entry) }),
    entries,
    lines: () => entries.map((entry) => JSON.stringify(entry)),
  };
}

export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    mode: 'live',
    logLevel: 'debug',
    tfnsw: { apiKey: 'tfnsw-test-key-not-real' },
    appleMaps: null,
    missingSettings: [],
    dailyCallBudgets: { tfnsw: 50_000, appleMaps: 20_000 },
    planDeadlineMs: 20_000,
    ...overrides,
  };
}

export function place(
  name: string,
  lat: number,
  lon: number,
  kind: Place['kind'] = 'address',
): Place {
  return { name, coordinate: { lat, lon }, kind };
}

export const PLACES = {
  parramattaHome: place('1 Example St, Parramatta', -33.815, 151.0011),
  parramattaStation: {
    ...place('Parramatta Station', -33.8172, 151.005, 'stop'),
    stopId: '215020',
  },
  wynyardStation: { ...place('Wynyard Station', -33.8659, 151.2058, 'stop'), stopId: '200060' },
  wynyardOffice: place('1 Example Pl, Sydney', -33.866, 151.205),
  melbourne: place('Flinders Street, Melbourne', -37.8183, 144.9671),
} as const;

export function walkLeg(from: Place, to: Place, start: string, end: string): Leg {
  return {
    id: `walk-${from.name}-${start}`,
    kind: 'walk',
    from,
    to,
    start,
    end,
    source: 'tfnsw-trip-planner',
    timing: 'estimated',
    distanceMetres: 450,
  };
}

export function trainLeg(from: Place, to: Place, start: string, end: string): TransitLeg {
  return {
    id: `train-${start}`,
    kind: 'transit',
    from,
    to,
    start,
    end,
    source: 'tfnsw-trip-planner',
    timing: 'scheduled',
    mode: 'train',
    service: { name: 'T1', description: null, headsign: null, operator: null },
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

// Walk to Parramatta, train to Wynyard, walk to the office: 07:32 to 08:20 Sydney time.
export function parramattaToWynyard(): TransitJourney {
  const { parramattaHome, parramattaStation, wynyardStation, wynyardOffice } = PLACES;
  return {
    legs: [
      walkLeg(
        parramattaHome,
        parramattaStation,
        '2026-10-26T20:32:00.000Z',
        '2026-10-26T20:38:00.000Z',
      ),
      trainLeg(
        parramattaStation,
        wynyardStation,
        '2026-10-26T20:40:00.000Z',
        '2026-10-26T21:15:00.000Z',
      ),
      walkLeg(
        wynyardStation,
        wynyardOffice,
        '2026-10-26T21:15:00.000Z',
        '2026-10-26T21:20:00.000Z',
      ),
    ],
    fare: { status: 'unknown' },
    alerts: [],
  };
}

export function planRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    origin: PLACES.parramattaHome,
    destination: PLACES.wynyardOffice,
    time: { type: 'depart', at: NOW },
    access: { transit: true, drive: false, dropOff: false },
    preferences: DEFAULT_PREFERENCES,
    trip: { kind: 'outbound' },
    ...overrides,
  };
}

// Never settles and ignores its abort signal, like a provider stuck on a dead connection.
export function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

// Settles only when the caller's signal aborts, like a slow provider behind a well-behaved client.
export function untilAborted<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export interface FakeTransit extends TransitProvider {
  queries: TransitQuery[];
}

export function fakeTransit(
  respond: (query: TransitQuery, signal: AbortSignal) => Promise<TransitJourney[]> = async () => [
    parramattaToWynyard(),
  ],
): FakeTransit {
  const queries: TransitQuery[] = [];
  return {
    name: 'tfnsw-trip-planner',
    queries,
    planJourneys: (query, signal) => {
      queries.push(query);
      return respond(query, signal);
    },
  };
}

export function fakeDriving(
  routeDrive: (from: Coordinate, to: Coordinate, signal: AbortSignal) => Promise<DriveRoute>,
): DrivingProvider {
  return {
    name: 'apple-maps',
    estimateDrives: async (_origin, destinations) =>
      destinations.map(() => ({ durationSeconds: 600, distanceMetres: 5_000, trafficAware: true })),
    routeDrive: (from, to, _time, signal) => routeDrive(from, to, signal),
  };
}

export interface FakePlaces extends PlaceSearchProvider {
  searches: { query: string; near: Coordinate | null }[];
}

export function fakePlaces(
  name: ProviderName,
  respond: (signal: AbortSignal) => Promise<PlaceSuggestion[]>,
): FakePlaces {
  const searches: FakePlaces['searches'] = [];
  return {
    name,
    searches,
    search: (query, near, signal) => {
      searches.push({ query, near });
      return respond(signal);
    },
  };
}

export function suggestion(
  name: string,
  lat: number,
  lon: number,
  kind: Place['kind'],
): PlaceSuggestion {
  return { place: place(name, lat, lon, kind), detail: null };
}

export function facility(id: string, name: string, lat: number, lon: number): CarParkFacility {
  return {
    id,
    name,
    coordinate: { lat, lon },
    kind: 'transport-park-and-ride',
    stationName: `${name} Station`,
    totalSpaces: 400,
    rules: {
      status: 'documented',
      summary: 'Free for up to 18 hours with an Opal tap on and off.',
      sourceUrl:
        'https://transportnsw.info/travel-info/ways-to-get-around/drive/parking/transport-parkride-car-parks',
      checkedOn: '2026-10-25',
    },
    station: place(`${name} Station`, lat, lon + 0.001, 'stop'),
  };
}

export interface FakeCarParks extends CarParkProvider {
  calls: { listFacilities: number; occupancy: number };
}

export function fakeCarParks(options: {
  facilities: CarParkFacility[];
  occupancy: (ids: readonly string[]) => Promise<Map<string, Occupancy>>;
  listFacilities?: () => Promise<CarParkFacility[]>;
}): FakeCarParks {
  const calls = { listFacilities: 0, occupancy: 0 };
  return {
    name: 'tfnsw-car-park',
    calls,
    listFacilities: () => {
      calls.listFacilities += 1;
      return options.listFacilities
        ? options.listFacilities()
        : Promise.resolve(options.facilities);
    },
    occupancy: (ids) => {
      calls.occupancy += 1;
      return options.occupancy(ids);
    },
  };
}

export const NO_PROVIDERS: ProviderSet = {
  transit: null,
  driving: null,
  carParks: null,
  places: [],
};

export interface TestAppOptions {
  config?: Partial<ApiConfig>;
  providers?: Partial<ProviderSet>;
  clock?: TestClock;
  logs?: CapturedLogs;
  rateLimiter?: RateLimiter;
  planTrip?: Parameters<typeof createApp>[0]['planTrip'];
  clientAddress?: ClientAddressResolver;
}

export function testApp(options: TestAppOptions = {}) {
  const clock = options.clock ?? testClock();
  const logs = options.logs ?? capturingLogger();
  const app = createApp({
    config: testConfig(options.config),
    providers: { ...NO_PROVIDERS, ...options.providers },
    rateLimiter: options.rateLimiter ?? new SlidingWindowRateLimiter({ clock }),
    logger: logs.logger,
    clock,
    planTrip: options.planTrip,
    clientAddress: options.clientAddress,
  });
  return { app, clock, logs };
}

export const INSTALL_ID = '3f0c8a52-6b1e-4d3a-9c7e-2b5d8f1a4e60';

export function postJson(
  app: { request: (path: string, init: RequestInit) => Response | Promise<Response> },
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-HopReady-Install': INSTALL_ID, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}
