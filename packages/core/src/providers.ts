import type { Coordinate } from './geo';
import type {
  CarPark,
  Fare,
  Leg,
  Occupancy,
  ParkingRules,
  Place,
  ServiceAlert,
  TransitMode,
} from './model';

// Adapters translate one provider into these shapes so the planner never sees provider formats,
// and a provider can be replaced without touching routing rules.

export type ProviderName =
  'tfnsw-trip-planner' | 'tfnsw-car-park' | 'apple-maps' | 'google-routes' | 'demo-fixture';

export type ProviderFailure =
  | 'timeout'
  | 'rate-limited'
  | 'unavailable'
  | 'malformed-response'
  | 'not-configured'
  | 'rejected-request';

const RETRYABLE_FAILURES: readonly ProviderFailure[] = ['timeout', 'rate-limited', 'unavailable'];

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly failure: ProviderFailure;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    provider: ProviderName,
    failure: ProviderFailure,
    message: string,
    options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.failure = failure;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get isRetryable(): boolean {
    return RETRYABLE_FAILURES.includes(this.failure);
  }
}

export interface TransitQuery {
  from: Place;
  to: Place;
  time: { type: 'depart' | 'arrive'; at: string };
  maxJourneys: number;
  maxWalkMinutes: number;
  walkingSpeed: 'slow' | 'normal' | 'fast';
  excludedModes: readonly TransitMode[];
}

// A journey as the transit provider planned it: walk and transit legs only, in order,
// starting at `from` and ending at `to`.
export interface TransitJourney {
  legs: Leg[];
  fare: Fare;
  alerts: ServiceAlert[];
}

export interface TransitProvider {
  readonly name: ProviderName;
  planJourneys(query: TransitQuery, signal: AbortSignal): Promise<TransitJourney[]>;
}

export interface DriveEstimate {
  durationSeconds: number;
  distanceMetres: number;
  trafficAware: boolean;
}

export interface DriveRoute extends DriveEstimate {
  path: Coordinate[];
}

export interface DrivingProvider {
  readonly name: ProviderName;
  // One origin to several destinations leaving at `departAt`. A null entry means no drivable route.
  estimateDrives(
    origin: Coordinate,
    destinations: readonly Coordinate[],
    departAt: string,
    signal: AbortSignal,
  ): Promise<(DriveEstimate | null)[]>;
  routeDrive(
    from: Coordinate,
    to: Coordinate,
    departAt: string,
    signal: AbortSignal,
  ): Promise<DriveRoute>;
}

export interface CarParkFacility extends CarPark {
  rules: ParkingRules;
}

export interface CarParkProvider {
  readonly name: ProviderName;
  listFacilities(signal: AbortSignal): Promise<CarParkFacility[]>;
  occupancy(facilityIds: readonly string[], signal: AbortSignal): Promise<Map<string, Occupancy>>;
}

export interface PlaceSuggestion {
  place: Place;
  detail: string | null;
}

export interface PlaceSearchProvider {
  readonly name: ProviderName;
  search(query: string, near: Coordinate | null, signal: AbortSignal): Promise<PlaceSuggestion[]>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
