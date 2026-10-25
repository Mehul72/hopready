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
import { carParkFacilitySchema, carParkListSchema, type CarParkFacilityFeed } from './schemas';

const PROVIDER = 'tfnsw-car-park';
const HOUR_MS = 60 * 60 * 1_000;
const FACILITY_LIST_TTL_MS = 24 * HOUR_MS;
const OCCUPANCY_TTL_MS = 60 * 1_000;
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
  private facilityList: Stored<CarParkFacility[]> | null = null;
  private readonly detailsById = new Map<string, Stored<FacilityDetails>>();
  // A null value records that the latest answer had no usable occupancy, so it is not asked again
  // within the minute.
  private readonly occupancyById = new Map<string, Stored<Occupancy | null>>();

  constructor(
    private readonly client: TfnswClient,
    private readonly clock: Clock,
    private readonly report: DiagnosticSink,
  ) {}

  async listFacilities(signal: AbortSignal): Promise<CarParkFacility[]> {
    if (this.facilityList && this.ageMs(this.facilityList) < FACILITY_LIST_TTL_MS) {
      return this.facilityList.value;
    }

    let namesById: Map<string, string>;
    try {
      namesById = await this.fetchFacilityNames(signal);
    } catch (error) {
      // Names, places and capacity rarely change, so yesterday's list beats no car parks at all.
      if (!this.facilityList || signal.aborted) throw error;
      return this.staleList();
    }
    // An empty list is a glitch, not news: keeping it for a day would hide every car park.
    if (namesById.size === 0) {
      this.report({ kind: 'empty-facility-list' });
      return this.facilityList ? this.staleList() : [];
    }

    const ids = [...namesById.keys()].filter(
      (id) => FACILITY_ID.test(id) && !HISTORICAL_ONLY_FACILITY_IDS.has(id),
    );
    const stale = ids.filter((id) => {
      const details = this.detailsById.get(id);
      return !details || this.ageMs(details) >= FACILITY_LIST_TTL_MS;
    });
    const outcomes = await mapSettled(stale, FACILITY_CONCURRENCY, (id) =>
      this.fetchFacility(id, signal),
    );

    const unavailable: string[] = [];
    let firstFailure: ProviderError | undefined;
    outcomes.forEach((outcome, index) => {
      const id = stale[index]!;
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

    const facilities = this.assemble(ids, namesById);
    // A list missing details because of a passing failure is served once and fetched again next time.
    if (unavailable.length === 0) {
      this.facilityList = { value: facilities, storedAtMs: this.nowMs() };
    }
    return facilities;
  }

  async occupancy(
    facilityIds: readonly string[],
    signal: AbortSignal,
  ): Promise<Map<string, Occupancy>> {
    const ids = [...new Set(facilityIds)].filter(
      (id) => FACILITY_ID.test(id) && !HISTORICAL_ONLY_FACILITY_IDS.has(id),
    );
    const known = new Map<string, Occupancy>();
    const toFetch: string[] = [];
    for (const id of ids) {
      const stored = this.occupancyById.get(id);
      if (!stored || this.ageMs(stored) >= OCCUPANCY_TTL_MS) {
        toFetch.push(id);
      } else if (stored.value) {
        known.set(id, stored.value);
      }
    }

    const outcomes = await mapSettled(toFetch, FACILITY_CONCURRENCY, (id) =>
      this.fetchFacility(id, signal),
    );
    const unreadable: string[] = [];
    const failed: string[] = [];
    let firstFailure: ProviderError | undefined;
    outcomes.forEach((outcome, index) => {
      const id = toFetch[index]!;
      if (outcome.status === 'rejected') {
        firstFailure ??= asProviderError(outcome.reason, PROVIDER);
        failed.push(id);
        return;
      }
      const occupancy = this.rememberOccupancy(id, outcome.value);
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

  private rememberDetails(id: string, feed: CarParkFacilityFeed): void {
    this.detailsById.set(id, { value: { feed }, storedAtMs: this.nowMs() });
    // Each detail response also carries live occupancy, which saves a call if it is asked for soon.
    this.rememberOccupancy(id, feed);
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
    if (invalid.length > 0) {
      this.report({
        kind: 'facilities-left-out',
        reason: 'invalid-facility',
        facilityIds: invalid,
      });
    }
    return facilities;
  }

  private staleList(): CarParkFacility[] {
    const list = this.facilityList;
    if (!list) return [];
    this.report({ kind: 'stale-facility-list', ageHours: Math.floor(this.ageMs(list) / HOUR_MS) });
    return list.value;
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }

  private ageMs(stored: Stored<unknown>): number {
    return this.nowMs() - stored.storedAtMs;
  }
}

function facilityFrom(
  id: string,
  listedName: string | null,
  feed: CarParkFacilityFeed | null,
  catalogued: CataloguedCarPark | undefined,
): CarParkFacility | 'no-location' | null {
  // The feed's location is the car park entrance. Outside Greater Sydney it is either a typo (the
  // documentation prints one latitude without its minus sign) or a car park HopReady does not cover.
  const feedEntrance = feedCoordinate(feed);
  const coordinate =
    (feedEntrance && isWithinGreaterSydney(feedEntrance) ? feedEntrance : null) ??
    catalogued?.entrance ??
    catalogued?.station.coordinate ??
    null;
  if (!coordinate) return 'no-location';

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
