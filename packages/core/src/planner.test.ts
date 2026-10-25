import { describe, expect, it } from 'vitest';

import { haversineMetres } from './geo';
import { findContinuityIssues } from './itinerary';
import {
  DEFAULT_PREFERENCES,
  type Leg,
  type Occupancy,
  type Place,
  type PlanRequest,
} from './model';
import { planTrip, type PlannerDeps } from './planner';
import {
  ProviderError,
  type CarParkFacility,
  type CarParkProvider,
  type DriveTime,
  type DrivingProvider,
  type TransitJourney,
  type TransitProvider,
  type TransitQuery,
} from './providers';
import { addMinutes, addSeconds, secondsBetween } from './time';
import { place, transit, walk } from './test-support/legs';

// ---------- a tiny deterministic world ----------

const BOX_HILL = place('8 Example Rd, Box Hill', -33.6431, 150.8975);
const ROUSE_HILL = place('12 Example St, Rouse Hill', -33.6789, 150.9152);
const CHATSWOOD_OFFICE = place('1 Help St, Chatswood', -33.7975, 151.1832);
const NOW = '2026-10-26T20:30:00Z'; // 07:30 Tuesday in Sydney

function facility(
  id: string,
  name: string,
  lat: number,
  lon: number,
  stationName: string,
  stopId: string,
): CarParkFacility {
  return {
    id,
    name,
    coordinate: { lat, lon },
    kind: 'transport-park-and-ride',
    stationName,
    totalSpaces: 400,
    rules: {
      status: 'documented',
      summary: 'Free with an Opal tap on and off.',
      sourceUrl: 'https://transportnsw.info/travel-info/using-public-transport/parking',
      checkedOn: '2026-10-25',
    },
    station: { name: stationName, coordinate: { lat, lon: lon + 0.001 }, kind: 'stop', stopId },
  };
}

const TALLAWONG = facility('26', 'Tallawong P1', -33.6916, 150.906, 'Tallawong Station', '2155384');
const KELLYVILLE = facility(
  '29',
  'Kellyville (north)',
  -33.7135,
  150.9353,
  'Kellyville Station',
  '2155382',
);
const BELLA_VISTA = facility(
  '31',
  'Bella Vista',
  -33.7306,
  150.944,
  'Bella Vista Station',
  '2153478',
);

const DRIVE_METRES_PER_MINUTE = 500;
const METRO_HEADWAY_MINUTES = 6;
const WALK_TO_STOP_MINUTES = 4;
const WALK_FROM_STOP_MINUTES = 5;

function driveSeconds(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  return Math.round((haversineMetres(from, to) * 1.35) / DRIVE_METRES_PER_MINUTE) * 60;
}

function fakeDriving(
  overrides: Partial<DrivingProvider> = {},
): DrivingProvider & { calls: DriveTime[] } {
  const calls: DriveTime[] = [];
  return {
    name: 'demo-fixture',
    calls,
    async estimateDrives(origin, destinations, time) {
      calls.push(time);
      return destinations.map((destination) => ({
        durationSeconds: driveSeconds(origin, destination),
        distanceMetres: haversineMetres(origin, destination) * 1.35,
        trafficAware: true,
      }));
    },
    async routeDrive(from, to, time) {
      calls.push(time);
      return {
        durationSeconds: driveSeconds(from, to),
        distanceMetres: haversineMetres(from, to) * 1.35,
        trafficAware: true,
        path: [from, to],
      };
    },
    ...overrides,
  };
}

function rideMinutes(from: Place, to: Place) {
  return Math.max(3, Math.round((haversineMetres(from.coordinate, to.coordinate) * 1.3) / 583));
}

// Every origin connects to every destination by: walk 4 min, metro every 6 min, walk 5 min.
function metroJourney(from: Place, to: Place, metroDeparts: string): TransitJourney {
  const station = place(
    `${from.name} station`,
    from.coordinate.lat,
    from.coordinate.lon + 0.001,
    'stop',
  );
  const alight = place(`${to.name} station`, to.coordinate.lat, to.coordinate.lon - 0.001, 'stop');
  const metroArrives = addMinutes(metroDeparts, rideMinutes(from, to));
  return {
    legs: [
      walk(from, station, addMinutes(metroDeparts, -WALK_TO_STOP_MINUTES), metroDeparts),
      transit(station, alight, metroDeparts, metroArrives, { realtime: true }),
      walk(
        alight,
        to,
        metroArrives,
        addMinutes(metroArrives, WALK_FROM_STOP_MINUTES),
        `walk-${to.name}`,
      ),
    ],
    fare: { status: 'unknown' },
    alerts: [],
  };
}

function alignToHeadway(iso: string, direction: 'up' | 'down'): string {
  const ms = new Date(iso).getTime();
  const headwayMs = METRO_HEADWAY_MINUTES * 60_000;
  const aligned = direction === 'up' ? Math.ceil(ms / headwayMs) : Math.floor(ms / headwayMs);
  return new Date(aligned * headwayMs).toISOString();
}

function metroTimetable(query: TransitQuery): TransitJourney[] {
  const { from, to, time } = query;
  if (time.type === 'depart') {
    const first = alignToHeadway(addMinutes(time.at, WALK_TO_STOP_MINUTES), 'up');
    return [0, 1, 2].map((n) =>
      metroJourney(from, to, addMinutes(first, n * METRO_HEADWAY_MINUTES)),
    );
  }
  const latestArrival = addMinutes(time.at, -WALK_FROM_STOP_MINUTES);
  const latestDeparture = alignToHeadway(addMinutes(latestArrival, -rideMinutes(from, to)), 'down');
  return [2, 1, 0].map((n) =>
    metroJourney(from, to, addMinutes(latestDeparture, -n * METRO_HEADWAY_MINUTES)),
  );
}

function fakeTransit(
  plan: (query: TransitQuery) => TransitJourney[] = metroTimetable,
): TransitProvider & {
  queries: TransitQuery[];
} {
  const queries: TransitQuery[] = [];
  return {
    name: 'demo-fixture',
    queries,
    async planJourneys(query) {
      queries.push(query);
      return plan(query);
    },
  };
}

function fakeCarParks(
  occupancy: Map<string, Occupancy> = new Map(),
  facilities: CarParkFacility[] = [TALLAWONG, KELLYVILLE, BELLA_VISTA],
): CarParkProvider {
  return {
    name: 'demo-fixture',
    async listFacilities() {
      return facilities;
    },
    async occupancy(ids) {
      return new Map([...occupancy].filter(([id]) => ids.includes(id)));
    },
  };
}

function deps(overrides: Partial<PlannerDeps> = {}): PlannerDeps {
  return {
    mode: 'demo',
    transit: fakeTransit(),
    driving: fakeDriving(),
    carParks: fakeCarParks(),
    clock: { now: () => new Date(NOW) },
    ...overrides,
  };
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    origin: BOX_HILL,
    destination: CHATSWOOD_OFFICE,
    time: { type: 'depart', at: NOW },
    access: { transit: true, drive: true, dropOff: false },
    preferences: DEFAULT_PREFERENCES,
    trip: { kind: 'outbound' },
    ...overrides,
  };
}

const kinds = (legs: Leg[]) => legs.map((leg) => leg.kind);

// ---------- tests ----------

describe('public transport only', () => {
  it('returns walk and transit journeys sorted by arrival', async () => {
    const response = await planTrip(
      request({ access: { transit: true, drive: false, dropOff: false } }),
      deps(),
    );

    expect(response.itineraries.length).toBeGreaterThan(0);
    expect(response.itineraries.every((it) => it.strategy === 'transit-only')).toBe(true);
    const arrivals = response.itineraries.map((it) => new Date(it.arriveAt).getTime());
    expect(arrivals).toEqual([...arrivals].sort((a, b) => a - b));
    expect(response.mode).toBe('demo');
  });
});

describe('drive, park, then metro', () => {
  it('drives to a documented car park, parks, walks and rides, with no gaps or overlaps', async () => {
    const response = await planTrip(request(), deps());
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(kinds(itinerary.legs).slice(0, 3)).toEqual(['drive', 'park', 'walk']);
      expect(findContinuityIssues(itinerary.legs)).toEqual([]);
      expect(itinerary.parking?.carPark.kind).toBe('transport-park-and-ride');
    }
  });

  it('applies the parking buffer once, between arriving and starting to walk', async () => {
    const response = await planTrip(request(), deps());
    const itinerary = response.itineraries.find((it) => it.strategy === 'park-and-ride')!;
    const park = itinerary.legs.find((leg) => leg.kind === 'park')!;

    expect(secondsBetween(park.start, park.end)).toBe(
      DEFAULT_PREFERENCES.parkingBufferMinutes * 60,
    );
    const nextLeg = itinerary.legs[itinerary.legs.indexOf(park) + 1]!;
    expect(nextLeg.start).toBe(park.end);
  });

  it('leaves no earlier than requested', async () => {
    const response = await planTrip(request(), deps());
    for (const itinerary of response.itineraries) {
      expect(secondsBetween(NOW, itinerary.departAt)).toBeGreaterThanOrEqual(-60);
    }
  });

  it('skips car parks that are behind the traveller and explains which car parks it checked', async () => {
    const response = await planTrip(request({ origin: ROUSE_HILL }), deps());
    const usedCarParks = response.itineraries.flatMap((it) =>
      it.parking ? [it.parking.carPark.id] : [],
    );

    expect(usedCarParks).not.toContain(TALLAWONG.id);
    expect(response.checkedCarParks.some((carPark) => carPark.outcome === 'used')).toBe(true);
    expect(response.checkedCarParks).toContainEqual({
      id: TALLAWONG.id,
      name: TALLAWONG.name,
      outcome: 'not-towards-destination',
    });
  });

  it('labels fresh, stale and missing occupancy honestly', async () => {
    const occupancy = new Map<string, Occupancy>([
      [
        '26',
        { status: 'known', spacesAvailable: 40, totalSpaces: 121, observedAt: addMinutes(NOW, -2) },
      ],
      [
        '29',
        {
          status: 'known',
          spacesAvailable: 10,
          totalSpaces: 351,
          observedAt: addMinutes(NOW, -45),
        },
      ],
    ]);
    const response = await planTrip(request(), deps({ carParks: fakeCarParks(occupancy) }));
    const byId = new Map(
      response.itineraries.flatMap((it) =>
        it.parking ? [[it.parking.carPark.id, it.parking.occupancy]] : [],
      ),
    );

    expect(byId.get('26')?.status).toBe('known');
    expect(byId.get('29')?.status).toBe('stale');
    expect(byId.get('31')?.status).toBe('unknown');
  });

  it('keeps parking rules separate from occupancy', async () => {
    const response = await planTrip(request(), deps());
    const parking = response.itineraries.find((it) => it.parking)!.parking!;
    expect(parking.rules.status).toBe('documented');
    expect(parking.occupancy.status).toBe('unknown');
  });

  it('only offers a user-chosen spot as parking when the user saved it', async () => {
    const savedSpot = {
      id: 'saved-1',
      name: 'Mum’s place, Kellyville',
      coordinate: { lat: -33.7101, lon: 150.9562 },
    };
    const response = await planTrip(
      request({
        origin: ROUSE_HILL,
        savedParkingSpots: [savedSpot],
        preferredCarParkId: 'saved-1',
      }),
      deps({ carParks: fakeCarParks(new Map(), []) }),
    );
    const parking = response.itineraries.find((it) => it.parking)?.parking;

    expect(parking?.carPark).toMatchObject({ id: 'saved-1', kind: 'user-saved' });
    expect(parking?.rules.status).toBe('unknown');
    expect(parking?.occupancy.status).toBe('unknown');
  });
});

describe('arrive by', () => {
  const target = '2026-10-26T22:30:00Z'; // 09:30 in Sydney

  it('works backwards so every option arrives on time and leaves after now', async () => {
    const response = await planTrip(request({ time: { type: 'arrive', at: target } }), deps());

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(secondsBetween(itinerary.arriveAt, target)).toBeGreaterThanOrEqual(-60);
      expect(secondsBetween(NOW, itinerary.departAt)).toBeGreaterThanOrEqual(-60);
      expect(findContinuityIssues(itinerary.legs)).toEqual([]);
    }
  });

  it('asks the driving provider for an arrival time on the chosen drive leg', async () => {
    const driving = fakeDriving();
    await planTrip(request({ time: { type: 'arrive', at: target } }), deps({ driving }));
    expect(driving.calls.some((call) => call.type === 'arrive')).toBe(true);
  });

  it('rejects options that would have needed to leave in the past', async () => {
    const tooSoon = addMinutes(NOW, 20);
    const response = await planTrip(request({ time: { type: 'arrive', at: tooSoon } }), deps());

    expect(response.itineraries).toEqual([]);
    expect(response.rejected.map((entry) => entry.reason)).toContain('departs-in-past');
  });
});

describe('transfer strategies need public transport', () => {
  it('does not offer parking when the only answer from the car park is a walk', async () => {
    const walkOnly = fakeTransit((query) => [
      {
        legs: [walk(query.from, query.to, addMinutes(NOW, 30), addMinutes(NOW, 42))],
        fare: { status: 'unknown' },
        alerts: [],
      },
    ]);
    const response = await planTrip(request(), deps({ transit: walkOnly }));

    expect(response.itineraries.some((it) => it.strategy === 'park-and-ride')).toBe(false);
    expect(response.checkedCarParks.some((carPark) => carPark.outcome === 'used')).toBe(false);
    expect(
      response.checkedCarParks.some((carPark) => carPark.outcome === 'no-workable-connection'),
    ).toBe(true);
  });
});

describe('drop-off', () => {
  it('rides to a station without a parking leg', async () => {
    const response = await planTrip(
      request({ origin: ROUSE_HILL, access: { transit: true, drive: false, dropOff: true } }),
      deps(),
    );
    const dropOff = response.itineraries.filter((it) => it.strategy === 'drop-off');

    expect(dropOff.length).toBeGreaterThan(0);
    for (const itinerary of dropOff) {
      expect(kinds(itinerary.legs).slice(0, 2)).toEqual(['ride', 'drop-off']);
      expect(itinerary.legs.some((leg) => leg.kind === 'park')).toBe(false);
      expect(itinerary.parking).toBeNull();
    }
  });
});

describe('getting home', () => {
  const parkedAt = {
    ...KELLYVILLE.station!,
    name: 'Kellyville (north) car park',
    kind: 'parked-car' as const,
  };
  const parkedCar = {
    location: parkedAt,
    carParkId: KELLYVILLE.id,
    confirmedAt: addMinutes(NOW, -600),
  };

  it('goes back through the confirmed parked car before driving home', async () => {
    const response = await planTrip(
      request({
        origin: CHATSWOOD_OFFICE,
        destination: ROUSE_HILL,
        time: { type: 'depart', at: '2026-10-27T06:30:00Z' },
        trip: { kind: 'return-via-car', parkedCar },
      }),
      deps({ clock: { now: () => new Date('2026-10-27T06:30:00Z') } }),
    );

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.strategy).toBe('return-via-car');
      const retrieval = itinerary.legs.findIndex((leg) => leg.kind === 'car-retrieval');
      const drive = itinerary.legs[retrieval + 1]!;
      expect(drive.kind).toBe('drive');
      expect(drive.from.coordinate).toEqual(parkedAt.coordinate);
      expect(itinerary.legs[retrieval - 1]!.to.coordinate).toEqual(parkedAt.coordinate);
      expect(findContinuityIssues(itinerary.legs)).toEqual([]);
    }
  });

  it('never sends a dropped-off traveller back for a car', async () => {
    const response = await planTrip(
      request({
        origin: CHATSWOOD_OFFICE,
        destination: ROUSE_HILL,
        trip: { kind: 'return-without-car' },
      }),
      deps(),
    );

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.strategy).toBe('transit-home');
      expect(
        itinerary.legs.some((leg) => ['drive', 'ride', 'car-retrieval'].includes(leg.kind)),
      ).toBe(false);
    }
  });
});

describe('connections people cannot make', () => {
  it('rejects a transfer shorter than the buffer, counting the walk inside it', async () => {
    const stationA = place('Epping', -33.7727, 151.0818, 'stop');
    const stationB = place('Chatswood', -33.7969, 151.1803, 'stop');
    const tightTransfer: TransitJourney = {
      legs: [
        walk(BOX_HILL, stationA, '2026-10-26T20:40:00Z', '2026-10-26T20:44:00Z'),
        transit(stationA, stationB, '2026-10-26T20:44:00Z', '2026-10-26T21:00:00Z'),
        transit(stationB, CHATSWOOD_OFFICE, '2026-10-26T21:02:00Z', '2026-10-26T21:10:00Z', {
          mode: 'bus',
          name: '545',
        }),
      ],
      fare: { status: 'unknown' },
      alerts: [],
    };
    const response = await planTrip(
      request({ access: { transit: true, drive: false, dropOff: false } }),
      deps({ transit: fakeTransit(() => [tightTransfer]) }),
    );

    expect(response.itineraries).toEqual([]);
    expect(response.rejected).toEqual([{ reason: 'transfer-too-short', count: 1 }]);
  });

  it('drops journeys that use a cancelled service', async () => {
    const cancelled = metroTimetable({
      from: BOX_HILL,
      to: CHATSWOOD_OFFICE,
      time: { type: 'depart', at: NOW },
      maxJourneys: 1,
      maxWalkMinutes: 15,
      walkingSpeed: 'normal',
      excludedModes: [],
    }).slice(0, 1);
    const metro = cancelled[0]!.legs[1]!;
    if (metro.kind === 'transit') metro.cancelled = true;

    const response = await planTrip(
      request({ access: { transit: true, drive: false, dropOff: false } }),
      deps({ transit: fakeTransit(() => cancelled) }),
    );

    expect(response.itineraries).toEqual([]);
    expect(response.rejected).toEqual([{ reason: 'cancelled-service', count: 1 }]);
  });

  it('rejects walks longer than the traveller allows', async () => {
    const response = await planTrip(
      request({
        access: { transit: true, drive: false, dropOff: false },
        preferences: { ...DEFAULT_PREFERENCES, maxWalkMinutes: 3 },
      }),
      deps(),
    );

    expect(response.itineraries).toEqual([]);
    expect(response.rejected.map((entry) => entry.reason)).toContain('walk-too-long');
  });

  it('keeps car parks beyond the driving limit out and says so', async () => {
    const response = await planTrip(
      request({ preferences: { ...DEFAULT_PREFERENCES, maxDriveMinutes: 5 } }),
      deps(),
    );

    expect(response.itineraries.every((it) => it.strategy === 'transit-only')).toBe(true);
    expect(
      response.checkedCarParks.every((carPark) => carPark.outcome === 'too-far-to-drive'),
    ).toBe(true);
  });
});

describe('when providers fail', () => {
  it('still returns public transport when drive times are unavailable, and explains why', async () => {
    const driving = fakeDriving({
      async estimateDrives() {
        throw new ProviderError('apple-maps', 'rate-limited', 'HTTP 429');
      },
    });
    const response = await planTrip(request(), deps({ driving }));

    expect(response.itineraries.every((it) => it.strategy === 'transit-only')).toBe(true);
    expect(response.itineraries.length).toBeGreaterThan(0);
    expect(response.unavailable).toContainEqual({
      strategy: 'park-and-ride',
      reason: 'Drive times are busy right now. Try again shortly.',
    });
  });

  it('marks driving strategies unavailable when no driving provider is configured', async () => {
    const response = await planTrip(request(), deps({ driving: null }));
    expect(response.unavailable.map((entry) => entry.strategy)).toEqual([
      'park-and-ride',
      'drive-only',
    ]);
  });

  it('throws the provider error when nothing at all could be planned', async () => {
    const failing = fakeTransit(() => {
      throw new ProviderError('tfnsw-trip-planner', 'timeout', 'no answer');
    });
    await expect(
      planTrip(
        request({ access: { transit: true, drive: false, dropOff: false } }),
        deps({ transit: failing }),
      ),
    ).rejects.toMatchObject({ failure: 'timeout' });
  });

  it('stops waiting for a provider that hangs', async () => {
    const hanging: TransitProvider = {
      name: 'tfnsw-trip-planner',
      planJourneys: (_query, signal) =>
        new Promise((_resolve, rejectPromise) => {
          signal.addEventListener('abort', () =>
            rejectPromise(new DOMException('aborted', 'AbortError')),
          );
        }),
    };
    const started = Date.now();
    await expect(
      planTrip(
        request({ access: { transit: true, drive: false, dropOff: false } }),
        deps({ transit: hanging, limits: { providerTimeoutMs: 50 } }),
      ),
    ).rejects.toMatchObject({ failure: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('carries on with unknown occupancy when the occupancy feed fails', async () => {
    const carParks: CarParkProvider = {
      ...fakeCarParks(),
      async occupancy() {
        throw new ProviderError('tfnsw-car-park', 'unavailable', 'HTTP 503');
      },
    };
    const response = await planTrip(request(), deps({ carParks }));
    const parking = response.itineraries.find((it) => it.parking)?.parking;

    expect(parking?.occupancy.status).toBe('unknown');
    expect(response.notices).toContain('Car park occupancy figures are unavailable right now.');
  });
});

describe('no valid route', () => {
  it('returns an empty plan with reasons instead of padding', async () => {
    const response = await planTrip(
      request({
        destination: place('Next door', BOX_HILL.coordinate.lat + 0.001, BOX_HILL.coordinate.lon),
        access: { transit: true, drive: true, dropOff: false },
      }),
      deps({ transit: fakeTransit(() => []) }),
    );

    expect(response.itineraries.filter((it) => it.strategy !== 'drive-only')).toEqual([]);
    expect(response.unavailable.map((entry) => entry.strategy)).toContain('park-and-ride');
    expect(response.unavailable).toContainEqual({
      strategy: 'transit-only',
      reason: 'No public transport journeys were found for this time.',
    });
  });

  it('explains when no public transport gets back to the parked car', async () => {
    const parkedCar = {
      location: { ...KELLYVILLE.station!, kind: 'parked-car' as const },
      carParkId: KELLYVILLE.id,
      confirmedAt: addMinutes(NOW, -600),
    };
    const response = await planTrip(
      request({
        origin: CHATSWOOD_OFFICE,
        destination: ROUSE_HILL,
        trip: { kind: 'return-via-car', parkedCar },
      }),
      deps({ transit: fakeTransit(() => []) }),
    );

    expect(response.itineraries).toEqual([]);
    expect(response.unavailable).toEqual([
      {
        strategy: 'return-via-car',
        reason: 'No public transport gets you back to your car in time from here.',
      },
    ]);
  });
});

describe('late night', () => {
  it('plans across Sydney midnight', async () => {
    const lateNight = '2026-10-26T12:50:00Z'; // 23:50 in Sydney
    const response = await planTrip(
      request({
        time: { type: 'depart', at: lateNight },
        access: { transit: true, drive: false, dropOff: false },
      }),
      deps({ clock: { now: () => new Date(lateNight) } }),
    );
    const itinerary = response.itineraries[0]!;

    expect(secondsBetween(lateNight, itinerary.arriveAt)).toBeGreaterThan(0);
    expect(addSeconds(itinerary.departAt, itinerary.durationSeconds)).toBe(
      new Date(itinerary.arriveAt).toISOString(),
    );
  });
});
