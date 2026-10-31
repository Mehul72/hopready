import {
  carParkSchema,
  findCataloguedCarPark,
  fromSydneyWallClock,
  isWithinGreaterSydney,
  mapSettled,
  parkingRulesSchema,
  placeSchema,
  STANDARD_PARK_AND_RIDE_RULES,
  type CarParkFacility,
  type CarParkProvider,
  type CataloguedCarPark,
  type Clock,
  type Coordinate,
  type Occupancy,
  type Place,
  type ProviderError,
} from '@hopready/core';

import { asProviderError, type TfnswClient } from './client';
import type { DiagnosticSink } from './diagnostics';
import { nonEmptyText } from './fields';
import {
  carParkFacilitySchema,
  carParkFullListSchema,
  carParkListSchema,
  type CarParkFacilityFeed,
} from './schemas';

const PROVIDER = 'tfnsw-car-park';
const FULL_LIST_PATH = '/v1/carpark/full-list';
const HOUR_MS = 60 * 60 * 1_000;
const FACILITY_LIST_TTL_MS = 24 * HOUR_MS;
const OCCUPANCY_TTL_MS = 60 * 1_000;
// One answer carries every car park, so a plan's several car parks cost one request. A single car
// park is no cheaper that way, so it is asked for on its own.
const MIN_IDS_FOR_FULL_LIST = 2;
// Car park detail calls share the TfNSW rate limit with trip planning, so only a few run at once.
const FACILITY_CONCURRENCY = 3;
// IDs 1 to 5 are the Metro North West car parks the documentation marks "Historical Only".
const HISTORICAL_ONLY_FACILITY_IDS: ReadonlySet<string> = new Set(['1', '2', '3', '4', '5']);
const FACILITY_ID = /^\d{1,6}$/;
const WHOLE_NUMBER = /^\d+$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const facilityOutputSchema = carParkSchema.extend({
  rules: parkingRulesSchema,
  station: placeSchema.nullable(),
});

interface Stored<T> {
  value: T;
  storedAtMs: number;
}

// One facility's static details. `feed` is null when TfNSW answered but gave nothing usable, which is
// remembered so a broken entry does not keep the facility list from being cached.
interface FacilityDetails {
  feed: CarParkFacilityFeed | null;
}

export class TfnswCarParkProvider implements CarParkProvider {
  readonly name = PROVIDER;
  private facilityNames: Stored<Map<string, string>> | null = null;
  private readonly detailsById = new Map<string, Stored<FacilityDetails>>();
  // A null value records that the latest answer had no usable occupancy, so it is not asked again
  // within the minute.
  private readonly occupancyById = new Map<string, Stored<Occupancy | null>>();
  // The ids the latest full list carried, so a car park it left out is asked for on its own.
  private fullList: Stored<Set<string>> | null = null;

  constructor(
    private readonly client: TfnswClient,
    private readonly clock: Clock,
    private readonly report: DiagnosticSink,
  ) {}

  async listFacilities(signal: AbortSignal): Promise<CarParkFacility[]> {
    const namesById = await this.currentFacilityNames(signal);
    const ids = [...namesById.keys()].filter(isLiveFacilityId);
    // The full list gives every car park's entrance and capacity in one request, so a plan drives
    // to the car park itself rather than its station. The catalogue places the rest, so only a car
    // park neither knows costs a details call.
    if (ids.length > 0 && !this.hasFullListNewerThan(FACILITY_LIST_TTL_MS)) {
      await this.refreshFromFullList(signal);
    }
    const toFetch = ids.filter((id) => !findCataloguedCarPark(id) && !this.hasFreshDetails(id));
    const outcomes = await mapSettled(toFetch, FACILITY_CONCURRENCY, (id) =>
      this.fetchFacility(id, signal),
    );

    const unavailable: string[] = [];
    let firstFailure: ProviderError | undefined;
    outcomes.forEach((outcome, index) => {
      const id = toFetch[index]!;
      if (outcome.status === 'fulfilled') {
        this.rememberDetails(id, outcome.value);
        return;
      }
      const failure = asProviderError(outcome.reason, PROVIDER);
      if (failure.isRetryable) {
        firstFailure ??= failure;
        unavailable.push(id);
      } else {
        // TfNSW answered and the answer is unusable; asking again today would get the same answer.
        this.detailsById.set(id, { value: { feed: null }, storedAtMs: this.nowMs() });
      }
    });
    if (signal.aborted && firstFailure) throw firstFailure;
    if (unavailable.length > 0) {
      this.report({ kind: 'facility-details-unavailable', facilityIds: unavailable });
    }
    return this.assemble(ids, namesById);
  }

  private async currentFacilityNames(signal: AbortSignal): Promise<Map<string, string>> {
    if (this.facilityNames && this.ageMs(this.facilityNames) < FACILITY_LIST_TTL_MS) {
      return this.facilityNames.value;
    }
    let namesById: Map<string, string>;
    try {
      namesById = await this.fetchFacilityNames(signal);
    } catch (error) {
      // Names rarely change, so yesterday's list beats no car parks at all.
      if (!this.facilityNames || signal.aborted) throw error;
      return this.staleNames();
    }
    // An empty list is a glitch, not news: keeping it for a day would hide every car park.
    if (namesById.size === 0) {
      this.report({ kind: 'empty-facility-list' });
      return this.facilityNames ? this.staleNames() : namesById;
    }
    this.facilityNames = { value: namesById, storedAtMs: this.nowMs() };
    return namesById;
  }

  private hasFreshDetails(id: string): boolean {
    const details = this.detailsById.get(id);
    return details !== undefined && this.ageMs(details) < FACILITY_LIST_TTL_MS;
  }

  async occupancy(
    facilityIds: readonly string[],
    signal: AbortSignal,
  ): Promise<Map<string, Occupancy>> {
    const ids = [...new Set(facilityIds)].filter(isLiveFacilityId);
    if (
      this.withoutFreshOccupancy(ids).length >= MIN_IDS_FOR_FULL_LIST &&
      !this.hasFullListNewerThan(OCCUPANCY_TTL_MS)
    ) {
      await this.refreshFromFullList(signal);
    }
    const known = new Map<string, Occupancy>();
    const unreadable: string[] = [];
    const toFetch: string[] = [];
    for (const id of ids) {
      const stored = this.occupancyById.get(id);
      if (!stored || this.ageMs(stored) >= OCCUPANCY_TTL_MS) {
        toFetch.push(id);
      } else if (stored.value) {
        known.set(id, stored.value);
      } else {
        unreadable.push(id);
      }
    }

    const outcomes = await mapSettled(toFetch, FACILITY_CONCURRENCY, (id) =>
      this.fetchFacility(id, signal),
    );
    const failed: string[] = [];
    let firstFailure: ProviderError | undefined;
    outcomes.forEach((outcome, index) => {
      const id = toFetch[index]!;
      if (outcome.status === 'rejected') {
        firstFailure ??= asProviderError(outcome.reason, PROVIDER);
        failed.push(id);
        return;
      }
      // The same answer carries the entrance and capacity, which improves the facility list too.
      const occupancy = this.rememberDetails(id, outcome.value);
      if (occupancy) known.set(id, occupancy);
      else unreadable.push(id);
    });

    if (firstFailure && (signal.aborted || failed.length === ids.length)) throw firstFailure;
    // Ids left out here are shown as "occupancy unknown" by the planner.
    if (unreadable.length > 0) {
      this.report({ kind: 'occupancy-left-out', reason: 'unreadable', facilityIds: unreadable });
    }
    if (failed.length > 0) {
      this.report({ kind: 'occupancy-left-out', reason: 'request-failed', facilityIds: failed });
    }
    return known;
  }

  private withoutFreshOccupancy(ids: readonly string[]): string[] {
    return ids.filter((id) => {
      const stored = this.occupancyById.get(id);
      return !stored || this.ageMs(stored) >= OCCUPANCY_TTL_MS;
    });
  }

  // A failed attempt counts too, so an endpoint that is down is not asked again by every plan.
  private hasFullListNewerThan(maxAgeMs: number): boolean {
    return this.fullList !== null && this.ageMs(this.fullList) < maxAgeMs;
  }

  // Reads every car park's details and occupancy in one request. A failure is not an error here:
  // each car park can still be asked for on its own.
  private async refreshFromFullList(signal: AbortSignal): Promise<void> {
    let entries: unknown[];
    try {
      const body = await this.client.get({
        provider: PROVIDER,
        path: FULL_LIST_PATH,
        params: {},
        parse: (raw) => carParkFullListSchema.parse(raw),
        signal,
      });
      entries = Array.isArray(body) ? body : Object.values(body);
    } catch {
      this.report({ kind: 'full-list-unavailable' });
      this.fullList = { value: new Set(), storedAtMs: this.nowMs() };
      return;
    }

    const carried = new Set<string>();
    let unreadable = 0;
    for (const entry of entries) {
      const parsed = carParkFacilitySchema.safeParse(entry);
      if (!parsed.success) {
        unreadable += 1;
        continue;
      }
      const id = String(parsed.data.facility_id).trim();
      if (!isLiveFacilityId(id)) continue;
      carried.add(id);
      this.rememberDetails(id, parsed.data);
    }
    if (unreadable > 0) this.report({ kind: 'full-list-entries-unreadable', count: unreadable });
    this.fullList = { value: carried, storedAtMs: this.nowMs() };
  }

  private async fetchFacilityNames(signal: AbortSignal): Promise<Map<string, string>> {
    const list = await this.client.get({
      provider: PROVIDER,
      path: '/v1/carpark',
      params: {},
      parse: (body) => carParkListSchema.parse(body),
      signal,
    });
    const entries = Array.isArray(list)
      ? list.map((entry) => [String(entry.facility_id), entry.facility_name] as const)
      : Object.entries(list);
    return new Map(entries.map(([id, name]) => [id.trim(), name.trim()]));
  }

  private fetchFacility(id: string, signal: AbortSignal): Promise<CarParkFacilityFeed> {
    return this.client.get({
      provider: PROVIDER,
      path: '/v1/carpark',
      params: { facility: id },
      parse: (body) => {
        const feed = carParkFacilitySchema.parse(body);
        if (String(feed.facility_id).trim() !== id) {
          throw new Error('TfNSW answered with a different facility than the one asked for');
        }
        return feed;
      },
      signal,
    });
  }

  private rememberDetails(id: string, feed: CarParkFacilityFeed): Occupancy | null {
    this.detailsById.set(id, { value: { feed }, storedAtMs: this.nowMs() });
    // Each detail response also carries live occupancy, which saves a call if it is asked for soon.
    return this.rememberOccupancy(id, feed);
  }

  private rememberOccupancy(id: string, feed: CarParkFacilityFeed): Occupancy | null {
    const occupancy = occupancyFromFeed(feed);
    this.occupancyById.set(id, { value: occupancy, storedAtMs: this.nowMs() });
    return occupancy;
  }

  private assemble(
    ids: readonly string[],
    namesById: ReadonlyMap<string, string>,
  ): CarParkFacility[] {
    const facilities: CarParkFacility[] = [];
    const withoutLocation: string[] = [];
    const outsideCoverage: string[] = [];
    const invalid: string[] = [];
    for (const id of ids) {
      const facility = facilityFrom(
        id,
        namesById.get(id) ?? null,
        this.detailsById.get(id)?.value.feed ?? null,
        findCataloguedCarPark(id),
      );
      if (facility === 'no-location') {
        withoutLocation.push(id);
        continue;
      }
      if (facility === 'outside-coverage') {
        outsideCoverage.push(id);
        continue;
      }
      const parsed = facility ? facilityOutputSchema.safeParse(facility) : null;
      if (parsed?.success) facilities.push(parsed.data);
      else invalid.push(id);
    }
    if (withoutLocation.length > 0) {
      this.report({
        kind: 'facilities-left-out',
        reason: 'no-usable-location',
        facilityIds: withoutLocation,
      });
    }
    if (outsideCoverage.length > 0) {
      this.report({
        kind: 'facilities-left-out',
        reason: 'outside-coverage',
        facilityIds: outsideCoverage,
      });
    }
    if (invalid.length > 0) {
      this.report({
        kind: 'facilities-left-out',
        reason: 'invalid-facility',
        facilityIds: invalid,
      });
    }
    return facilities;
  }

  private staleNames(): Map<string, string> {
    const names = this.facilityNames;
    if (!names) return new Map();
    this.report({ kind: 'stale-facility-list', ageHours: Math.floor(this.ageMs(names) / HOUR_MS) });
    return names.value;
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }

  private ageMs(stored: Stored<unknown>): number {
    return this.nowMs() - stored.storedAtMs;
  }
}

function isLiveFacilityId(id: string): boolean {
  return FACILITY_ID.test(id) && !HISTORICAL_ONLY_FACILITY_IDS.has(id);
}

function facilityFrom(
  id: string,
  listedName: string | null,
  feed: CarParkFacilityFeed | null,
  catalogued: CataloguedCarPark | undefined,
): CarParkFacility | 'no-location' | 'outside-coverage' | null {
  // The feed's location is the car park entrance. Outside Greater Sydney it is either a typo (the
  // documentation prints one latitude without its minus sign) or a car park HopReady does not cover.
  const feedEntrance = feedCoordinate(feed);
  const coordinate =
    (feedEntrance && isWithinGreaterSydney(feedEntrance) ? feedEntrance : null) ??
    catalogued?.entrance ??
    catalogued?.station.coordinate ??
    null;
  if (!coordinate) return 'no-location';
  // Car parks such as Kiama are real but outside the area HopReady plans trips in.
  if (!isWithinGreaterSydney(coordinate)) return 'outside-coverage';

  const name = nonEmptyText(feed?.facility_name, listedName);
  if (!name) return null;
  const station = stationFor(name, coordinate, feed, catalogued);
  const spots = wholeNumber(feed?.spots);
  return {
    id,
    name,
    coordinate,
    kind: 'transport-park-and-ride',
    stationName: station?.name ?? null,
    totalSpaces: spots !== null && spots > 0 ? spots : null,
    // Every facility in this API is a Transport Park&Ride car park, so the standard rules apply
    // unless the catalogue documents different ones.
    rules: catalogued?.rules ?? STANDARD_PARK_AND_RIDE_RULES,
    station,
  };
}

function stationFor(
  facilityName: string,
  carParkCoordinate: Coordinate,
  feed: CarParkFacilityFeed | null,
  catalogued: CataloguedCarPark | undefined,
): Place | null {
  if (catalogued) {
    const { name, stopId, coordinate } = catalogued.station;
    return { name, coordinate, kind: 'stop', stopId };
  }
  const tsn = feed?.tsn;
  const stopId = nonEmptyText(typeof tsn === 'number' ? String(tsn) : tsn);
  if (!stopId) return null;
  // Park&Ride car parks sit beside the stop they serve, and trip planning starts from the stop ID, so
  // the car park's own position is close enough for a drop-off.
  return { name: facilityName, stopId, coordinate: carParkCoordinate, kind: 'stop' };
}

function feedCoordinate(feed: CarParkFacilityFeed | null): Coordinate | null {
  const lat = decimal(feed?.location?.latitude);
  const lon = decimal(feed?.location?.longitude);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function occupancyFromFeed(feed: CarParkFacilityFeed): Occupancy | null {
  const totalSpaces = wholeNumber(feed.spots);
  const parked = wholeNumber(feed.occupancy?.total);
  const observedAt = observedAtFromMessageDate(feed.MessageDate);
  if (totalSpaces === null || totalSpaces === 0 || parked === null || observedAt === null) {
    return null;
  }
  return {
    status: 'known',
    // TfNSW's recommended formula; counts can run past capacity, which still means no spaces.
    spacesAvailable: Math.max(0, totalSpaces - parked),
    totalSpaces,
    observedAt,
  };
}

// MessageDate has no offset ("2024-11-25T11:08:35"). The documented sample matches its `time` field
// (seconds since 2000 UTC) only as Sydney local time, so that is how it is read.
export function observedAtFromMessageDate(messageDate: string | null | undefined): string | null {
  const text = messageDate?.trim();
  if (!text) return null;
  if (DATE_TIME_WITH_OFFSET.test(text)) {
    const instant = new Date(text);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  }

  const match = LOCAL_DATE_TIME.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (!isRealWallClock(year, month, day, hour, minute, second)) return null;
  // In the hour that repeats when clocks go back, the earlier reading is taken, so an observation
  // never looks fresher than it is.
  return fromSydneyWallClock({ year, month, day, hour, minute, second }, 'earlier').toISOString();
}

function isRealWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day;
  return isRealDate && hour <= 23 && minute <= 59 && second <= 59;
}

function wholeNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const text = value?.trim();
  if (!text || !WHOLE_NUMBER.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function decimal(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = value?.trim();
  return text && DECIMAL.test(text) ? Number(text) : null;
}
