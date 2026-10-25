import { describe, expect, it } from 'vitest';

import { findContinuityIssues, legSeconds, transitLegsOf } from '../itinerary';
import {
  DEFAULT_PREFERENCES,
  planResponseSchema,
  type Itinerary,
  type Leg,
  type ParkedCar,
  type PlanRequest,
  type PlanResponse,
  type Preferences,
  type Strategy,
  type TransitLeg,
} from '../model';
import { planTrip, type PlannerLimits } from '../planner';
import { ProviderError } from '../providers';
import {
  addMinutes,
  floorToMinute,
  formatSydneyTime,
  secondsBetween,
  sydneyDateKey,
  sydneyOffsetMinutes,
  sydneyWallClock,
} from '../time';
import { PARK_AND_RIDE_CATALOGUE } from '../data/park-and-ride';
import { createDemoProviders, DEMO_PLACES, type DemoScenario } from './index';

// The real planner against the demo world, for every case the brief asks for. Times are fixed, so
// every run plans against the same generated timetable.

const TUESDAY_0630 = '2026-10-26T19:30:00Z';
const TUESDAY_0700 = '2026-10-26T20:00:00Z';
const TUESDAY_0730 = '2026-10-26T20:30:00Z';
const TUESDAY_0740 = '2026-10-26T20:40:00Z';
const TUESDAY_0745 = '2026-10-26T20:45:00Z';
const TUESDAY_0900 = '2026-10-26T22:00:00Z';
const TUESDAY_1730 = '2026-10-27T06:30:00Z';
const FRIDAY_2350 = '2026-10-30T12:50:00Z';
const DST_START_SUNDAY_0800 = '2026-10-03T21:00:00Z';
const DST_START_SUNDAY_0130 = '2026-10-03T15:30:00Z';
const DST_END_SUNDAY_0800 = '2027-04-03T22:00:00Z';
const DST_END_SUNDAY_0230_FIRST = '2027-04-03T15:30:00Z';
// Every ten minutes from 6.30 to 8.30 am, while the car parks fill.
const TUESDAY_MORNING = Array.from({ length: 13 }, (_, step) =>
  addMinutes(TUESDAY_0630, step * 10),
);

const TRANSIT_ONLY = { transit: true, drive: false, dropOff: false };
const METRO_NORTH_WEST_CAR_PARKS = ['26', '27', '28', '29', '30', '31', '32', '33'];
const B_LINE_CAR_PARKS = ['10', '12', '13', '489', '490'];
const OCCUPANCY_FRESH_MINUTES = 15;
// A count with no more than this share of the spaces free is nearly full.
const NEARLY_FULL_FREE_SHARE = 0.1;

interface PlanOptions {
  now: string;
  scenario?: DemoScenario;
  limits?: Partial<PlannerLimits>;
}

function request(overrides: Partial<PlanRequest> & { at?: string } = {}): PlanRequest {
  const { at, ...rest } = overrides;
  return {
    origin: DEMO_PLACES.boxHillHome,
    destination: DEMO_PLACES.chatswoodOffice,
    time: { type: 'depart', at: at ?? TUESDAY_0730 },
    access: { transit: true, drive: true, dropOff: false },
    preferences: DEFAULT_PREFERENCES,
    trip: { kind: 'outbound' },
    ...rest,
  };
}

async function plan(planRequest: PlanRequest, options: PlanOptions): Promise<PlanResponse> {
  const clock = { now: () => new Date(options.now) };
  const providers = createDemoProviders({ clock, scenario: options.scenario ?? 'normal' });
  return planTrip(planRequest, {
    mode: 'demo',
    transit: providers.transit,
    driving: providers.driving,
    carParks: providers.carParks,
    clock,
    limits: options.limits,
  });
}

const kinds = (legs: readonly Leg[]) => legs.map((leg) => leg.kind);
const byStrategy = (response: PlanResponse, strategy: Strategy) =>
  response.itineraries.filter((itinerary) => itinerary.strategy === strategy);

function walkSecondsBetween(legs: readonly Leg[], from: number, to: number): number {
  return legs
    .slice(from + 1, to)
    .filter((leg) => leg.kind === 'walk')
    .reduce((total, leg) => total + legSeconds(leg), 0);
}

// The properties every itinerary in every scenario must keep.
function expectSoundItinerary(
  itinerary: Itinerary,
  response: PlanResponse,
  preferences: Preferences,
): void {
  expect(findContinuityIssues(itinerary.legs)).toEqual([]);
  expect(itinerary.fare).toEqual({ status: 'unknown' });

  const legKinds = kinds(itinerary.legs);
  const count = (kind: Leg['kind']) => legKinds.filter((legKind) => legKind === kind).length;
  expect(count('park')).toBe(itinerary.strategy === 'park-and-ride' ? 1 : 0);
  expect(count('drop-off')).toBe(itinerary.strategy === 'drop-off' ? 1 : 0);
  expect(count('car-retrieval')).toBe(itinerary.strategy === 'return-via-car' ? 1 : 0);

  itinerary.legs.forEach((leg, index) => {
    const next = itinerary.legs[index + 1];
    switch (leg.kind) {
      case 'park':
        expect(legSeconds(leg)).toBe(preferences.parkingBufferMinutes * 60);
        expect(next?.start).toBe(leg.end);
        expect(leg.source).toBe('hopready');
        expect(leg.timing).toBe('buffer');
        return;
      case 'drop-off':
        expect(legSeconds(leg)).toBe(preferences.dropOffBufferMinutes * 60);
        expect(next?.start).toBe(leg.end);
        return;
      case 'car-retrieval':
        expect(legSeconds(leg)).toBeGreaterThanOrEqual(preferences.carRetrievalBufferMinutes * 60);
        expect(next?.kind).toBe('drive');
        return;
      case 'drive':
      case 'ride':
        expect(leg.source).toBe('demo-fixture');
        expect(leg.timing).toBe('estimated');
        expect(leg.trafficAware).toBe(true);
        // The drive home from a parked car cannot be avoided, so a long one is noted, not rejected.
        if (itinerary.strategy === 'return-via-car') {
          expect(itinerary.notes.includes(longDriveHomeNote(preferences))).toBe(
            legSeconds(leg) > preferences.maxDriveMinutes * 60,
          );
          return;
        }
        expect(legSeconds(leg)).toBeLessThanOrEqual(preferences.maxDriveMinutes * 60);
        return;
      case 'walk':
        expect(leg.source).toBe('demo-fixture');
        expect(leg.timing).toBe('estimated');
        expect(legSeconds(leg)).toBeLessThanOrEqual(preferences.maxWalkMinutes * 60);
        return;
      case 'transit':
        expectHonestTransitLeg(leg);
        return;
      case 'wait':
        return;
    }
  });

  // The transfer buffer is checked against the gap between services, walks included, and is
  // never stacked on top of the walk.
  const transitIndexes = itinerary.legs.flatMap((leg, index) =>
    leg.kind === 'transit' ? [index] : [],
  );
  transitIndexes.slice(1).forEach((index, position) => {
    const previousIndex = transitIndexes[position]!;
    const windowSeconds = secondsBetween(
      itinerary.legs[previousIndex]!.end,
      itinerary.legs[index]!.start,
    );
    const walkSeconds = walkSecondsBetween(itinerary.legs, previousIndex, index);
    expect(windowSeconds).toBeGreaterThanOrEqual(
      Math.max(preferences.transferBufferMinutes * 60, walkSeconds),
    );
  });

  expect(itinerary.realtime).toBe(liveCoverage(transitLegsOf(itinerary.legs)));

  if (itinerary.parking) {
    const { occupancy } = itinerary.parking;
    if (occupancy.status !== 'unknown') {
      const ageMinutes = secondsBetween(occupancy.observedAt, response.generatedAt) / 60;
      expect(occupancy.status).toBe(ageMinutes > OCCUPANCY_FRESH_MINUTES ? 'stale' : 'known');
      expect(occupancy.spacesAvailable).toBeLessThanOrEqual(occupancy.totalSpaces);
    }
  }
}

function longDriveHomeNote(preferences: Preferences): string {
  return `The drive home is longer than your ${preferences.maxDriveMinutes} min driving limit.`;
}

// The itinerary's live-times label must match its transit legs.
function liveCoverage(transit: readonly TransitLeg[]): Itinerary['realtime'] {
  const live = transit.filter((leg) => leg.timing === 'realtime').length;
  if (live === 0) return 'none';
  return live === transit.length ? 'full' : 'partial';
}

function expectHonestTransitLeg(leg: TransitLeg): void {
  expect(leg.source).toBe('demo-fixture');
  expect(leg.cancelled).toBe(false);
  expect(leg.timing === 'realtime').toBe(leg.realtimeTripId !== null);
  expect(leg.scheduledStart).toBe(leg.start);
  expect(leg.scheduledEnd).toBe(leg.end);
  expect(leg.path).toHaveLength((leg.stopCount ?? 0) + 1);
  for (const platform of [leg.departurePlatform, leg.arrivalPlatform]) {
    if (platform !== null) expect(platform).toMatch(/^\d{1,2}$/);
  }
}

function expectSoundResponse(
  response: PlanResponse,
  preferences: Preferences = DEFAULT_PREFERENCES,
) {
  expect(response.mode).toBe('demo');
  expect(() => planResponseSchema.parse(response)).not.toThrow();
  for (const itinerary of response.itineraries) {
    expectSoundItinerary(itinerary, response, preferences);
  }
}

describe('drive, park, then metro', () => {
  it('drives from Box Hill to a Metro North West car park and takes the M1 to Chatswood', async () => {
    const response = await plan(request(), { now: TUESDAY_0730 });
    expectSoundResponse(response);
    const parkAndRide = byStrategy(response, 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(kinds(itinerary.legs).slice(0, 2)).toEqual(['drive', 'park']);
      const carPark = itinerary.parking!.carPark;
      expect(METRO_NORTH_WEST_CAR_PARKS).toContain(carPark.id);
      const transit = transitLegsOf(itinerary.legs);
      expect(transit.map((leg) => leg.service.name)).toEqual(['M1']);
      const station = PARK_AND_RIDE_CATALOGUE.find(
        (entry) => entry.facilityId === carPark.id,
      )!.station;
      expect(transit[0]!.from.stopId).toBe(station.stopId);
      expect(transit[0]!.to.name).toBe('Chatswood Station');
      expect(response.checkedCarParks).toContainEqual({
        id: carPark.id,
        name: carPark.name,
        outcome: 'used',
      });
    }
  });

  it('never offers public transport alone from Box Hill, where no demo stop is in walking range', async () => {
    const response = await plan(request(), { now: TUESDAY_0730 });

    expect(byStrategy(response, 'transit-only')).toEqual([]);
    expect(response.unavailable).toContainEqual({
      strategy: 'transit-only',
      reason: 'No public transport journeys were found for this time.',
    });
  });
});

describe('drive, park near a bus connection, then bus and metro', () => {
  it('parks at a B-Line car park, rides the B1 into the city and changes to the metro', async () => {
    const response = await plan(
      request({ origin: DEMO_PLACES.collaroyPlateauHome, destination: DEMO_PLACES.waterlooOffice }),
      { now: TUESDAY_0730 },
    );
    expectSoundResponse(response);
    const parkAndRide = byStrategy(response, 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(B_LINE_CAR_PARKS).toContain(itinerary.parking!.carPark.id);
      const services = transitLegsOf(itinerary.legs).map(
        (leg) => `${leg.mode}:${leg.service.name}`,
      );
      expect(services[0]).toBe('bus:B1');
      expect(services.at(-1)).toBe('metro:M1');
    }
  });

  it('walks between linked stops in the city instead of inventing a same-stop change', async () => {
    const response = await plan(
      request({ origin: DEMO_PLACES.collaroyPlateauHome, destination: DEMO_PLACES.waterlooOffice }),
      { now: TUESDAY_0730 },
    );
    const itinerary = byStrategy(response, 'park-and-ride')[0]!;
    const busIndex = itinerary.legs.findIndex(
      (leg) => leg.kind === 'transit' && leg.service.name === 'B1',
    );
    const walk = itinerary.legs.slice(busIndex + 1).find((leg) => leg.kind === 'walk')!;

    expect(walk.from.name).toBe('Wynyard Station');
    expect(walk.to.kind).toBe('stop');
    expect(walk.to.name).not.toBe('Wynyard Station');
  });
});

describe('public transport only', () => {
  it('walks to Rouse Hill station and rides the M1 to Barangaroo', async () => {
    const response = await plan(
      request({
        origin: DEMO_PLACES.rouseHillHome,
        destination: DEMO_PLACES.barangarooOffice,
        access: TRANSIT_ONLY,
        at: TUESDAY_0740,
      }),
      { now: TUESDAY_0740 },
    );
    expectSoundResponse(response);

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.strategy).toBe('transit-only');
      expect(kinds(itinerary.legs)).toEqual(['walk', 'transit', 'walk']);
      const metro = transitLegsOf(itinerary.legs)[0]!;
      expect(metro.from.name).toBe('Rouse Hill Station');
      expect(metro.to.name).toBe('Barangaroo Station');
      expect(itinerary.legs[0]!.from).toEqual(DEMO_PLACES.rouseHillHome);
      expect(itinerary.legs.at(-1)!.to).toEqual(DEMO_PLACES.barangarooOffice);
      expect(secondsBetween(TUESDAY_0740, itinerary.departAt)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('getting home', () => {
  const parkedCar: ParkedCar = {
    location: {
      name: 'Kellyville (north) car park',
      coordinate: { lat: -33.713514, lon: 150.935304 },
      kind: 'parked-car',
    },
    carParkId: '29',
    confirmedAt: '2026-10-26T21:05:00Z',
  };

  it('returns through the confirmed parked car, then drives home', async () => {
    const response = await plan(
      request({
        origin: DEMO_PLACES.chatswoodOffice,
        destination: DEMO_PLACES.boxHillHome,
        at: TUESDAY_1730,
        trip: { kind: 'return-via-car', parkedCar },
      }),
      { now: TUESDAY_1730 },
    );
    expectSoundResponse(response);

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.strategy).toBe('return-via-car');
      const retrieval = itinerary.legs.findIndex((leg) => leg.kind === 'car-retrieval');
      const drive = itinerary.legs[retrieval + 1]!;
      expect(drive.kind).toBe('drive');
      expect(drive.from.coordinate).toEqual(parkedCar.location.coordinate);
      expect(drive.to).toEqual(DEMO_PLACES.boxHillHome);
      const metro = transitLegsOf(itinerary.legs).at(-1)!;
      expect(metro.to.name).toBe('Kellyville Station');
      expect(legSeconds(itinerary.legs[retrieval]!)).toBe(
        DEFAULT_PREFERENCES.carRetrievalBufferMinutes * 60,
      );
    }
  });

  it('still goes home through the car when the evening drive is over the driving limit', async () => {
    const preferences = { ...DEFAULT_PREFERENCES, maxDriveMinutes: 10 };
    const response = await plan(
      request({
        origin: DEMO_PLACES.chatswoodOffice,
        destination: DEMO_PLACES.boxHillHome,
        at: TUESDAY_1730,
        preferences,
        trip: { kind: 'return-via-car', parkedCar },
      }),
      { now: TUESDAY_1730 },
    );
    expectSoundResponse(response, preferences);

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.notes).toEqual([longDriveHomeNote(preferences)]);
    }
  });

  it('goes home from beside the car, or a short walk away, without public transport', async () => {
    const car = parkedCar.location.coordinate;
    const currentLocation = (lat: number) => ({
      name: 'Current location',
      coordinate: { lat, lon: car.lon },
      kind: 'current-location' as const,
    });
    // Beside the car, then about 600 m north of it: a 10 minute walk that no demo service beats.
    const origins = [currentLocation(car.lat), currentLocation(car.lat + 0.0054)];
    const legsFrom = await Promise.all(
      origins.map(async (origin) => {
        const response = await plan(
          request({
            origin,
            destination: DEMO_PLACES.boxHillHome,
            at: TUESDAY_1730,
            trip: { kind: 'return-via-car', parkedCar },
          }),
          { now: TUESDAY_1730 },
        );
        expectSoundResponse(response);
        expect(response.unavailable).toEqual([]);
        return response.itineraries.map((itinerary) => kinds(itinerary.legs));
      }),
    );

    expect(legsFrom).toEqual([[['car-retrieval', 'drive']], [['walk', 'car-retrieval', 'drive']]]);
  });

  it('is dropped off on the way in and never sent back for a car on the way home', async () => {
    const outbound = await plan(
      request({
        origin: DEMO_PLACES.rouseHillHome,
        access: { transit: true, drive: false, dropOff: true },
      }),
      { now: TUESDAY_0730 },
    );
    expectSoundResponse(outbound);
    const dropOff = byStrategy(outbound, 'drop-off');
    expect(dropOff.length).toBeGreaterThan(0);
    for (const itinerary of dropOff) {
      expect(kinds(itinerary.legs).slice(0, 2)).toEqual(['ride', 'drop-off']);
      expect(itinerary.parking).toBeNull();
    }

    const home = await plan(
      request({
        origin: DEMO_PLACES.chatswoodOffice,
        destination: DEMO_PLACES.rouseHillHome,
        at: TUESDAY_1730,
        trip: { kind: 'return-without-car' },
      }),
      { now: TUESDAY_1730 },
    );
    expectSoundResponse(home);
    expect(home.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of home.itineraries) {
      expect(itinerary.strategy).toBe('transit-home');
      expect(
        kinds(itinerary.legs).some((kind) =>
          ['drive', 'ride', 'park', 'car-retrieval'].includes(kind),
        ),
      ).toBe(false);
    }
  });
});

describe('arrive by', () => {
  it('works back from 9 am so every option arrives in time and leaves after now', async () => {
    const response = await plan(request({ time: { type: 'arrive', at: TUESDAY_0900 } }), {
      now: TUESDAY_0700,
    });
    expectSoundResponse(response);

    expect(byStrategy(response, 'park-and-ride').length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(secondsBetween(itinerary.arriveAt, TUESDAY_0900)).toBeGreaterThanOrEqual(0);
      expect(secondsBetween(TUESDAY_0700, itinerary.departAt)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('connections people cannot make', () => {
  const warringahMallToMacquariePark = request({
    origin: DEMO_PLACES.warringahMall,
    destination: DEMO_PLACES.macquarieParkOffice,
    access: TRANSIT_ONLY,
  });

  function busToMetroChangeSeconds(itinerary: Itinerary): number | null {
    const legs = transitLegsOf(itinerary.legs);
    const bus = legs.findIndex((leg) => leg.service.name === '280');
    const metro = legs[bus + 1];
    if (bus < 0 || metro?.service.name !== 'M1') return null;
    return secondsBetween(legs[bus]!.end, metro.start);
  }

  it('rejects the 2 minute bus to metro change under the default 3 minute transfer buffer', async () => {
    const response = await plan(warringahMallToMacquariePark, {
      now: TUESDAY_0730,
      scenario: 'tight-transfer',
    });
    expectSoundResponse(response);

    expect(response.rejected).toContainEqual({ reason: 'transfer-too-short', count: 1 });
    expect(response.itineraries.map(busToMetroChangeSeconds)).not.toContain(120);
  });

  it('offers the same 2 minute change to someone who allows 2 minutes', async () => {
    const preferences = { ...DEFAULT_PREFERENCES, transferBufferMinutes: 2 };
    const response = await plan(
      { ...warringahMallToMacquariePark, preferences },
      { now: TUESDAY_0730, scenario: 'tight-transfer' },
    );
    expectSoundResponse(response, preferences);

    expect(response.itineraries.map(busToMetroChangeSeconds)).toContain(120);
  });

  it('gives the same bus a comfortable 5 minute change in the normal timetable', async () => {
    const response = await plan(warringahMallToMacquariePark, { now: TUESDAY_0730 });
    expectSoundResponse(response);

    expect(response.rejected).toEqual([]);
    expect(response.itineraries.map(busToMetroChangeSeconds)).toContain(300);
  });

  it('drops journeys on cancelled morning metro services and says why', async () => {
    const response = await plan(
      request({
        origin: DEMO_PLACES.rouseHillHome,
        destination: DEMO_PLACES.barangarooOffice,
        access: TRANSIT_ONLY,
        at: TUESDAY_0740,
      }),
      { now: TUESDAY_0740, scenario: 'cancelled-service' },
    );
    expectSoundResponse(response);

    const cancelled = response.rejected.find((entry) => entry.reason === 'cancelled-service');
    expect(cancelled?.count).toBeGreaterThan(0);
    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.alerts.map((alert) => alert.id)).toContain('demo-m1-morning-cancellations');
    }
  });
});

describe('late at night', () => {
  it('plans across Sydney midnight from 11.50 pm on a Friday', async () => {
    const response = await plan(
      request({
        origin: DEMO_PLACES.barangarooOffice,
        destination: DEMO_PLACES.rouseHillHome,
        access: TRANSIT_ONLY,
        at: FRIDAY_2350,
      }),
      { now: FRIDAY_2350 },
    );
    expectSoundResponse(response);

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(sydneyDateKey(itinerary.arriveAt)).toBe('2026-10-31');
      expect(secondsBetween(FRIDAY_2350, itinerary.departAt)).toBeGreaterThanOrEqual(0);
      expect(itinerary.durationSeconds).toBe(
        secondsBetween(itinerary.departAt, itinerary.arriveAt),
      );
    }
  });
});

describe('daylight saving', () => {
  const rouseHillToBarangaroo = (at: string) =>
    request({
      origin: DEMO_PLACES.rouseHillHome,
      destination: DEMO_PLACES.barangarooOffice,
      access: TRANSIT_ONLY,
      at,
    });

  // Sunday M1 trips leave Tallawong at 4.05 am and every 10 minutes, so Rouse Hill sees :x7.
  function expectSundayMetroInLocalTime(response: PlanResponse, offsetMinutes: number) {
    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      const metro = transitLegsOf(itinerary.legs)[0]!;
      expect(sydneyWallClock(metro.start).minute % 10).toBe(7);
      expect(sydneyOffsetMinutes(metro.start)).toBe(offsetMinutes);
    }
  }

  it('keeps the timetable in local time on the Sunday clocks go forward (4 October 2026)', async () => {
    const response = await plan(rouseHillToBarangaroo(DST_START_SUNDAY_0800), {
      now: DST_START_SUNDAY_0800,
    });
    expectSoundResponse(response);
    expectSundayMetroInLocalTime(response, 660);
  });

  it('counts real elapsed time across the missing hour', async () => {
    const response = await plan(rouseHillToBarangaroo(DST_START_SUNDAY_0130), {
      now: DST_START_SUNDAY_0130,
    });
    expectSoundResponse(response);
    const metro = transitLegsOf(response.itineraries[0]!.legs)[0]!;

    // 1.30 am standard time to the first train at 4.07 am daylight time is 97 minutes, not 157.
    expect(sydneyWallClock(metro.start)).toMatchObject({ day: 4, hour: 4, minute: 7 });
    expect(secondsBetween(DST_START_SUNDAY_0130, metro.start)).toBe(97 * 60);
  });

  it('keeps the timetable in local time on the Sunday clocks go back (4 April 2027)', async () => {
    const response = await plan(rouseHillToBarangaroo(DST_END_SUNDAY_0800), {
      now: DST_END_SUNDAY_0800,
    });
    expectSoundResponse(response);
    expectSundayMetroInLocalTime(response, 600);
  });

  it('counts real elapsed time across the repeated hour', async () => {
    const response = await plan(rouseHillToBarangaroo(DST_END_SUNDAY_0230_FIRST), {
      now: DST_END_SUNDAY_0230_FIRST,
    });
    expectSoundResponse(response);
    const metro = transitLegsOf(response.itineraries[0]!.legs)[0]!;

    // The first 2.30 am (daylight time) to the first train at 4.07 am standard time is 157 minutes.
    expect(sydneyWallClock(metro.start)).toMatchObject({ day: 4, hour: 4, minute: 7 });
    expect(secondsBetween(DST_END_SUNDAY_0230_FIRST, metro.start)).toBe(157 * 60);
  });

  it('plans park and ride on both changeover days', async () => {
    for (const at of [DST_START_SUNDAY_0800, DST_END_SUNDAY_0800]) {
      const response = await plan(request({ at }), { now: at });
      expectSoundResponse(response);
      expect(byStrategy(response, 'park-and-ride').length).toBeGreaterThan(0);
    }
  });
});

describe('car park occupancy', () => {
  it('labels hours-old counts as stale', async () => {
    const response = await plan(request(), { now: TUESDAY_0730, scenario: 'stale-occupancy' });
    expectSoundResponse(response);
    const parked = byStrategy(response, 'park-and-ride');

    expect(parked.length).toBeGreaterThan(0);
    for (const itinerary of parked) {
      const occupancy = itinerary.parking!.occupancy;
      expect(occupancy.status).toBe('stale');
      if (occupancy.status === 'stale') {
        expect(secondsBetween(occupancy.observedAt, TUESDAY_0730)).toBeGreaterThanOrEqual(3 * 3600);
      }
    }
  });

  it('shows unknown occupancy for the car park without a count, and fresh counts elsewhere', async () => {
    const response = await plan(request({ preferredCarParkId: '28' }), { now: TUESDAY_0730 });
    expectSoundResponse(response);
    const byCarPark = new Map(
      byStrategy(response, 'park-and-ride').map((itinerary) => [
        itinerary.parking!.carPark.id,
        itinerary.parking!.occupancy,
      ]),
    );

    expect(byCarPark.get('28')?.status).toBe('unknown');
    const others = [...byCarPark].filter(([id]) => id !== '28');
    expect(others.length).toBeGreaterThan(0);
    for (const [, occupancy] of others) {
      expect(occupancy.status).toBe('known');
      if (occupancy.status === 'known') {
        expect(secondsBetween(occupancy.observedAt, TUESDAY_0730)).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('only real choices', () => {
  // Compared the way the cards read: leave and arrive to the minute, seconds dropped, and the drive
  // in whole minutes.
  const shownMinutesBetween = (from: string, to: string) =>
    secondsBetween(floorToMinute(from), floorToMinute(to)) / 60;
  const shownDriveMinutes = (itinerary: Itinerary) => Math.round(itinerary.driveSeconds / 60);

  const LIVE_TIMES_RANK: Record<Itinerary['realtime'], number> = { none: 0, partial: 1, full: 2 };

  // No worse on anything the results can be sorted by, leaving at most a minute earlier, and as
  // certain: no alert the other avoids and no fewer live times.
  const isNoWorse = (better: Itinerary, other: Itinerary) =>
    shownMinutesBetween(better.arriveAt, other.arriveAt) >= 0 &&
    shownDriveMinutes(better) <= shownDriveMinutes(other) &&
    better.transfers <= other.transfers &&
    shownMinutesBetween(other.departAt, better.departAt) >= -1 &&
    LIVE_TIMES_RANK[better.realtime] >= LIVE_TIMES_RANK[other.realtime] &&
    better.alerts.every((alert) => other.alerts.some((same) => same.id === alert.id));

  // A drop-off needs no space. A car park needs a fresh count with more than a tenth of it free.
  const canCountOnASpace = (itinerary: Itinerary) => {
    if (itinerary.strategy === 'drop-off') return true;
    const occupancy = itinerary.parking?.occupancy;
    return (
      occupancy?.status === 'known' &&
      occupancy.spacesAvailable > occupancy.totalSpaces * NEARLY_FULL_FREE_SHARE
    );
  };

  const placeOf = (itinerary: Itinerary) =>
    itinerary.parking?.carPark.name ??
    itinerary.legs.find((leg) => leg.kind === 'drop-off')?.to.name ??
    itinerary.strategy;

  // Each listed car park or station that a listed one of the same kind, with a space to count on,
  // is no worse than.
  function paddedOptions(response: PlanResponse): string[] {
    const transfers = response.itineraries.filter(
      (itinerary) => itinerary.strategy === 'park-and-ride' || itinerary.strategy === 'drop-off',
    );
    return transfers.flatMap((other) =>
      transfers
        .filter(
          (better) =>
            better !== other &&
            better.strategy === other.strategy &&
            canCountOnASpace(better) &&
            isNoWorse(better, other),
        )
        .map((better) => `${placeOf(other)} is no better than ${placeOf(better)}`),
    );
  }

  const carParksListed = (response: PlanResponse) =>
    byStrategy(response, 'park-and-ride').map((itinerary) => itinerary.parking!.carPark.name);
  const checkedOutcomes = (response: PlanResponse) =>
    Object.fromEntries(response.checkedCarParks.map(({ name, outcome }) => [name, outcome]));

  // Each checked car park whose outcome disagrees with whether it has a card.
  function misreadCarParks(response: PlanResponse): string[] {
    const listed = new Set(
      byStrategy(response, 'park-and-ride').map((itinerary) => itinerary.parking!.carPark.id),
    );
    return response.checkedCarParks.flatMap(({ id, name, outcome }) => {
      if (outcome === 'used' && !listed.has(id)) return [`${name} reads as used with no card`];
      if (outcome === 'matched-by-another' && listed.has(id)) {
        return [`${name} has a card but reads as matched by another`];
      }
      return [];
    });
  }

  // Three commutes by any means, every ten minutes through the morning and for three arrive-by
  // times.
  async function* planSampleCommutes() {
    const trips = [
      { origin: DEMO_PLACES.boxHillHome, destination: DEMO_PLACES.chatswoodOffice },
      { origin: DEMO_PLACES.collaroyPlateauHome, destination: DEMO_PLACES.waterlooOffice },
      { origin: DEMO_PLACES.rouseHillHome, destination: DEMO_PLACES.chatswoodOffice },
    ];
    const times: { time: PlanRequest['time']; now: string }[] = [
      ...TUESDAY_MORNING.map((at) => ({ time: { type: 'depart' as const, at }, now: at })),
      ...[-30, 0, 30].map((minutes) => ({
        time: { type: 'arrive' as const, at: addMinutes(TUESDAY_0900, minutes) },
        now: TUESDAY_0700,
      })),
    ];
    for (const trip of trips) {
      for (const { time, now } of times) {
        const planned = request({
          ...trip,
          time,
          access: { transit: true, drive: true, dropOff: true },
        });
        const when = `${time.type} ${formatSydneyTime(time.at)} from ${trip.origin.name}`;
        yield { when, request: planned, now, response: await plan(planned, { now }) };
      }
    }
  }

  it('lists Tallawong P2 from Box Hill at 7.30 am, without the slower Kellyville car parks behind it', async () => {
    const response = await plan(request(), { now: TUESDAY_0730 });
    expectSoundResponse(response);

    expect(paddedOptions(response)).toEqual([]);
    expect(carParksListed(response)).toEqual(['Tallawong P2']);
    expect(checkedOutcomes(response)).toMatchObject({
      'Tallawong P2': 'used',
      'Kellyville (north)': 'matched-by-another',
      'Kellyville (south)': 'matched-by-another',
    });
  });

  it('never lists a car park or station that a listed one matches or beats on every count', async () => {
    const padded: string[] = [];
    for await (const { when, response } of planSampleCommutes()) {
      padded.push(...paddedOptions(response).map((entry) => `${when}: ${entry}`));
    }

    expect(padded).toEqual([]);
  });

  it('reads a car park as used only with a card, and as matched by another only without', async () => {
    const misread: string[] = [];
    for await (const { when, response } of planSampleCommutes()) {
      misread.push(...misreadCarParks(response).map((entry) => `${when}: ${entry}`));
    }

    expect(misread).toEqual([]);
  });

  it('never hides a car park that no listed one, with a space to count on, matches or beats', async () => {
    const wronglyHidden: string[] = [];
    for await (const { when, request: planned, now, response } of planSampleCommutes()) {
      const listed = byStrategy(response, 'park-and-ride').filter(canCountOnASpace);
      for (const { id, name, outcome } of response.checkedCarParks) {
        if (outcome !== 'matched-by-another') continue;
        // Asked for by name, the car park is listed with the same option it was hidden with.
        const askedFor = await plan({ ...planned, preferredCarParkId: id }, { now });
        const hidden = byStrategy(askedFor, 'park-and-ride').find(
          (itinerary) => itinerary.parking!.carPark.id === id,
        );
        if (!hidden || !listed.some((better) => isNoWorse(better, hidden))) {
          wronglyHidden.push(`${when}: ${name}`);
        }
      }
    }

    expect(wronglyHidden).toEqual([]);
  });

  it('keeps Kellyville (north) as somewhere else to park while Tallawong P2 is nearly full', async () => {
    const response = await plan(request({ at: TUESDAY_0745 }), { now: TUESDAY_0745 });
    expectSoundResponse(response);
    const tallawong = byStrategy(response, 'park-and-ride')[0]!.parking!.occupancy;

    expect(carParksListed(response)).toEqual(['Tallawong P2', 'Kellyville (north)']);
    expect(tallawong.status).toBe('known');
    if (tallawong.status === 'known') {
      expect(tallawong.spacesAvailable).toBeLessThanOrEqual(
        tallawong.totalSpaces * NEARLY_FULL_FREE_SHARE,
      );
    }
  });

  it('drops off at Tallawong only, the quicker of two stations on the same line', async () => {
    const dropOffOnly = request({ access: { transit: true, drive: false, dropOff: true } });
    const response = await plan(dropOffOnly, { now: TUESDAY_0730 });
    expectSoundResponse(response);

    expect(byStrategy(response, 'drop-off').map(placeOf)).toEqual(['Tallawong Station']);
  });

  it('lists the car park the traveller asked for, even behind the quicker Tallawong P2', async () => {
    const response = await plan(request({ preferredCarParkId: '30' }), { now: TUESDAY_0730 });
    expectSoundResponse(response);

    expect(carParksListed(response)).toEqual(['Tallawong P2', 'Kellyville (south)']);
  });
});

describe('no valid route', () => {
  it('returns an explained empty plan when the demo finds no journeys', async () => {
    const response = await plan(
      request({ origin: DEMO_PLACES.rouseHillHome, destination: DEMO_PLACES.barangarooOffice }),
      { now: TUESDAY_0730, scenario: 'no-route' },
    );
    expectSoundResponse(response);

    expect(response.itineraries.filter((itinerary) => itinerary.strategy !== 'drive-only')).toEqual(
      [],
    );
    expect(response.unavailable).toContainEqual({
      strategy: 'transit-only',
      reason: 'No public transport journeys were found for this time.',
    });
    const outcomes = response.checkedCarParks.map((carPark) => carPark.outcome);
    expect(outcomes).toContain('no-workable-connection');
    expect(outcomes).not.toContain('used');
  });
});

describe('when the public transport provider fails', () => {
  it('gives up within the planner timeout when the provider never answers', async () => {
    const started = Date.now();
    const planning = plan(request({ access: TRANSIT_ONLY }), {
      now: TUESDAY_0730,
      scenario: 'provider-timeout',
      limits: { providerTimeoutMs: 50 },
    });

    await expect(planning).rejects.toBeInstanceOf(ProviderError);
    await expect(planning).rejects.toMatchObject({ provider: 'demo-fixture', failure: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('passes rate limiting on, with the retry delay, when nothing else could be planned', async () => {
    const planning = plan(request({ access: TRANSIT_ONLY }), {
      now: TUESDAY_0730,
      scenario: 'rate-limited',
    });

    await expect(planning).rejects.toMatchObject({
      provider: 'demo-fixture',
      failure: 'rate-limited',
      retryAfterSeconds: 30,
    });
  });

  it('still drives when public transport is rate limited, and says what is missing', async () => {
    const response = await plan(
      request({ origin: DEMO_PLACES.collaroyHome, destination: DEMO_PLACES.deeWhyOffice }),
      { now: TUESDAY_0730, scenario: 'rate-limited' },
    );
    expectSoundResponse(response);

    expect(response.itineraries.map((itinerary) => itinerary.strategy)).toEqual(['drive-only']);
    expect(response.unavailable).toContainEqual({
      strategy: 'transit-only',
      reason: 'Public transport times are busy right now. Try again shortly.',
    });
  });
});
