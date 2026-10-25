import { describe, expect, it } from 'vitest';

import { haversineMetres } from './geo';
import { findContinuityIssues, legSeconds, transitLegsOf } from './itinerary';
import {
  DEFAULT_PREFERENCES,
  type Leg,
  type Occupancy,
  type Place,
  type PlanRequest,
  type PlanResponse,
  type ServiceAlert,
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

// Every origin connects to every destination by: walk 4 min, metro every 6 min, walk 5 min. A slower
// service can be asked for by name.
function metroJourney(
  from: Place,
  to: Place,
  metroDeparts: string,
  slower: { name: string; extraRideMinutes: number } | null = null,
): TransitJourney {
  const station = place(
    `${from.name} station`,
    from.coordinate.lat,
    from.coordinate.lon + 0.001,
    'stop',
  );
  const alight = place(`${to.name} station`, to.coordinate.lat, to.coordinate.lon - 0.001, 'stop');
  const metroArrives = addMinutes(
    metroDeparts,
    rideMinutes(from, to) + (slower?.extraRideMinutes ?? 0),
  );
  return {
    legs: [
      walk(from, station, addMinutes(metroDeparts, -WALK_TO_STOP_MINUTES), metroDeparts),
      transit(station, alight, metroDeparts, metroArrives, { realtime: true, name: slower?.name }),
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

// The metro journey that reaches `to` at exactly `arrival`, such as a late-running one.
function journeyArrivingAt(from: Place, to: Place, arrival: string): TransitJourney {
  const departs = addMinutes(arrival, -rideMinutes(from, to) - WALK_FROM_STOP_MINUTES);
  return metroJourney(from, to, departs);
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
    // The fresh count is nearly full, so Tallawong P1 hides none of the other car parks.
    const occupancy = new Map<string, Occupancy>([
      [
        '26',
        { status: 'known', spacesAvailable: 10, totalSpaces: 121, observedAt: addMinutes(NOW, -2) },
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
    const outcomes = response.checkedCarParks.map((carPark) => carPark.outcome);

    expect(response.itineraries).toEqual([]);
    expect(response.rejected.map((entry) => entry.reason)).toContain('departs-in-past');
    expect(outcomes).toContain('no-workable-connection');
    expect(outcomes).not.toContain('used');
  });

  it('counts a car park whose drive runs past the limit in traffic as too far, not used', async () => {
    const jammed = fakeDriving({
      async routeDrive(from, to) {
        return {
          durationSeconds: 35 * 60,
          distanceMetres: haversineMetres(from, to) * 1.35,
          trafficAware: true,
          path: [from, to],
        };
      },
    });
    // Arrive-by, so no car park is dropped earlier for missing its first service in the jam.
    const response = await planTrip(
      request({ time: { type: 'arrive', at: '2026-10-26T23:00:00Z' } }),
      deps({ driving: jammed }),
    );
    const outcomes = response.checkedCarParks.map((carPark) => carPark.outcome);

    expect(response.itineraries.some((it) => it.strategy === 'park-and-ride')).toBe(false);
    expect(response.rejected.map((entry) => entry.reason)).toContain('drive-too-long');
    expect(outcomes).toContain('too-far-to-drive');
    expect(outcomes).not.toContain('used');
  });

  it('skips a service now expected after the arrive-by time for one that arrives in time', async () => {
    const runningLate = fakeTransit((query) =>
      query.from.kind === 'car-park'
        ? [
            ...metroTimetable(query),
            journeyArrivingAt(query.from, query.to, addMinutes(query.time.at, 3)),
          ]
        : [],
    );
    const response = await planTrip(
      request({ time: { type: 'arrive', at: target } }),
      deps({ transit: runningLate }),
    );
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(secondsBetween(itinerary.arriveAt, target)).toBeGreaterThanOrEqual(0);
    }
    expect(response.rejected.map((entry) => entry.reason)).not.toContain('arrives-after-target');
  });
});

describe('choosing which car parks to check', () => {
  it('checks a nearby car park even when many far ones would rank better on the rough estimate', async () => {
    // Nine car parks beside the destination: a long drive, then a short train ride.
    const farButShortRide = Array.from({ length: 9 }, (_, index) =>
      facility(
        `far-${index}`,
        `Far car park ${index}`,
        -33.77 - index * 0.002,
        151.17,
        `Far station ${index}`,
        `far-stop-${index}`,
      ),
    );
    const response = await planTrip(
      request(),
      deps({ carParks: fakeCarParks(new Map(), [TALLAWONG, ...farButShortRide]) }),
    );

    expect(response.checkedCarParks).toContainEqual({
      id: TALLAWONG.id,
      name: TALLAWONG.name,
      outcome: 'used',
    });
  });

  it('only names wrong-way car parks that are within a realistic drive', async () => {
    const penrith = facility(
      '22',
      'Penrith (multi-level)',
      -33.750055,
      150.696135,
      'Penrith Station',
      '275010',
    );
    const response = await planTrip(
      request(),
      deps({ carParks: fakeCarParks(new Map(), [TALLAWONG, penrith]) }),
    );

    expect(response.checkedCarParks.map((carPark) => carPark.id)).not.toContain('22');
  });
});

describe('leaving out car parks that are no better', () => {
  // From Tallawong P1 the traveller leaves later, drives less and arrives sooner than from Bella Vista.
  const tallawongAndBellaVista = (tallawongCount: Occupancy | null) =>
    fakeCarParks(new Map(tallawongCount ? [[TALLAWONG.id, tallawongCount]] : []), [
      TALLAWONG,
      BELLA_VISTA,
    ]);
  const count = (spacesAvailable: number, minutesAgo = 2): Occupancy => ({
    status: 'known',
    spacesAvailable,
    totalSpaces: 120,
    observedAt: addMinutes(NOW, -minutesAgo),
  });
  const shownCarParks = (response: PlanResponse) =>
    response.itineraries.flatMap((it) => (it.parking ? [it.parking.carPark.id] : []));
  const LIFTS_OUT: ServiceAlert = {
    id: 'lifts-out-tallawong',
    severity: 'severe',
    title: 'Lifts out of service at Tallawong Station',
  };
  const withLiftsOut = (journey: TransitJourney): TransitJourney => ({
    ...journey,
    alerts: [LIFTS_OUT],
  });
  const onTimetable = (journey: TransitJourney): TransitJourney => ({
    ...journey,
    legs: journey.legs.map((leg) =>
      leg.kind === 'transit' ? { ...leg, timing: 'scheduled' } : leg,
    ),
  });
  const changingJourneysFrom = (
    carParkName: string,
    change: (journey: TransitJourney) => TransitJourney,
  ) =>
    fakeTransit((query) => {
      const journeys = metroTimetable(query);
      return query.from.name === carParkName ? journeys.map(change) : journeys;
    });

  it('hides the slower car park only while the quicker one has a fresh count with room', async () => {
    const planWith = async (tallawongCount: Occupancy | null) =>
      shownCarParks(
        await planTrip(request(), deps({ carParks: tallawongAndBellaVista(tallawongCount) })),
      );

    expect(await planWith(count(13))).toEqual([TALLAWONG.id]);
    // A tenth of the spaces free is nearly full, so Bella Vista stays as somewhere else to park.
    expect(await planWith(count(12))).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
    expect(await planWith(count(60, 45))).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
    expect(await planWith(null)).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
  });

  describe('with a service alert or live times on one car park only', () => {
    const planWith = async (transit: TransitProvider) =>
      shownCarParks(
        await planTrip(request(), deps({ transit, carParks: tallawongAndBellaVista(count(60)) })),
      );

    it('keeps the slower car park when only the quicker one has an alert', async () => {
      expect(await planWith(changingJourneysFrom(TALLAWONG.name, withLiftsOut))).toEqual([
        TALLAWONG.id,
        BELLA_VISTA.id,
      ]);
      expect(await planWith(changingJourneysFrom(BELLA_VISTA.name, withLiftsOut))).toEqual([
        TALLAWONG.id,
      ]);
    });

    it('still hides the slower car park when both have the same alert', async () => {
      const everyJourney = fakeTransit((query) => metroTimetable(query).map(withLiftsOut));

      expect(await planWith(everyJourney)).toEqual([TALLAWONG.id]);
    });

    it('keeps the slower car park when only it has live times', async () => {
      expect(await planWith(changingJourneysFrom(TALLAWONG.name, onTimetable))).toEqual([
        TALLAWONG.id,
        BELLA_VISTA.id,
      ]);
      expect(await planWith(changingJourneysFrom(BELLA_VISTA.name, onTimetable))).toEqual([
        TALLAWONG.id,
      ]);
    });
  });

  it('still shows a slower car park the traveller asked for', async () => {
    const withRoomAtTallawong = deps({ carParks: tallawongAndBellaVista(count(60)) });

    expect(shownCarParks(await planTrip(request(), withRoomAtTallawong))).toEqual([TALLAWONG.id]);
    expect(
      shownCarParks(
        await planTrip(request({ preferredCarParkId: BELLA_VISTA.id }), withRoomAtTallawong),
      ),
    ).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
  });

  describe('of two car parks at the same station', () => {
    // About 30 m west of P1, so the planner lists P1 first and drives into P2 can be told apart.
    const TALLAWONG_P2 = facility(
      '27',
      'Tallawong P2',
      TALLAWONG.coordinate.lat,
      TALLAWONG.coordinate.lon - 0.0003,
      'Tallawong Station',
      '2155384',
    );
    const tallawongTwins = (occupancy: Map<string, Occupancy>) =>
      fakeCarParks(occupancy, [TALLAWONG, TALLAWONG_P2]);
    // From P2 a quicker train two minutes later arrives with the all-stops one from P1.
    const quickerTrainFromP2 = () =>
      fakeTransit((query) => {
        if (query.from.kind !== 'car-park') return metroTimetable(query);
        const first = alignToHeadway(addMinutes(query.time.at, WALK_TO_STOP_MINUTES), 'up');
        return query.from.name === TALLAWONG_P2.name
          ? [metroJourney(query.from, query.to, addMinutes(first, 2))]
          : [
              metroJourney(query.from, query.to, first, {
                name: 'M1 all stops',
                extraRideMinutes: 2,
              }),
            ];
      });

    it('lists only the one with room when their cards would read the same', async () => {
      // Twenty seconds more driving into P2 still reads as the same whole minutes.
      const driving = fakeDriving();
      const intoP2 = (to: { lon: number }) => to.lon === TALLAWONG_P2.coordinate.lon;
      const longerIntoP2: DrivingProvider = {
        ...driving,
        estimateDrives: async (origin, destinations, time, signal) =>
          (await driving.estimateDrives(origin, destinations, time, signal)).map(
            (estimate, index) =>
              estimate && intoP2(destinations[index]!)
                ? { ...estimate, durationSeconds: estimate.durationSeconds + 20 }
                : estimate,
          ),
        routeDrive: async (from, to, time, signal) => {
          const route = await driving.routeDrive(from, to, time, signal);
          return intoP2(to) ? { ...route, durationSeconds: route.durationSeconds + 20 } : route;
        },
      };
      const occupancy = new Map([
        [TALLAWONG.id, count(12)],
        [TALLAWONG_P2.id, count(60)],
      ]);
      const response = await planTrip(
        request(),
        deps({ driving: longerIntoP2, carParks: tallawongTwins(occupancy) }),
      );

      expect(shownCarParks(response)).toEqual([TALLAWONG_P2.id]);
    });

    it('lists only the one that lets the traveller leave later for the same arrival', async () => {
      const occupancy = new Map([
        [TALLAWONG.id, count(60)],
        [TALLAWONG_P2.id, count(60)],
      ]);
      const response = await planTrip(
        request(),
        deps({ transit: quickerTrainFromP2(), carParks: tallawongTwins(occupancy) }),
      );

      expect(shownCarParks(response)).toEqual([TALLAWONG_P2.id]);
    });

    it('lists only the one without an alert, or with live times, when the rest reads the same', async () => {
      const occupancy = new Map([
        [TALLAWONG.id, count(60)],
        [TALLAWONG_P2.id, count(60)],
      ]);
      // P1 comes first, so the planner has to look past it to the twin that is more certain.
      const planWith = async (transit: TransitProvider) =>
        shownCarParks(
          await planTrip(request(), deps({ transit, carParks: tallawongTwins(occupancy) })),
        );

      expect(await planWith(changingJourneysFrom(TALLAWONG.name, withLiftsOut))).toEqual([
        TALLAWONG_P2.id,
      ]);
      expect(await planWith(changingJourneysFrom(TALLAWONG.name, onTimetable))).toEqual([
        TALLAWONG_P2.id,
      ]);
    });

    it('still lists the car park asked for when a better one is at the station asked for', async () => {
      const occupancy = new Map([
        [TALLAWONG.id, count(60)],
        [TALLAWONG_P2.id, count(60)],
      ]);
      const planAskingFor = async (asked: Partial<PlanRequest>) =>
        shownCarParks(
          await planTrip(
            request(asked),
            deps({ transit: quickerTrainFromP2(), carParks: tallawongTwins(occupancy) }),
          ),
        );
      const station = TALLAWONG.station!;

      expect(await planAskingFor({ preferredStop: station })).toEqual([TALLAWONG_P2.id]);
      expect(
        await planAskingFor({ preferredStop: station, preferredCarParkId: TALLAWONG.id }),
      ).toEqual([TALLAWONG_P2.id, TALLAWONG.id]);
    });
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

describe('choosing which journey to take from a car park', () => {
  it('takes the journey that arrives first, even when a slower one leaves earlier', async () => {
    const slowerFirst = fakeTransit((query) =>
      query.from.kind === 'car-park'
        ? [
            metroJourney(query.from, query.to, addMinutes(query.time.at, WALK_TO_STOP_MINUTES), {
              name: 'Slow',
              extraRideMinutes: 40,
            }),
            metroJourney(query.from, query.to, addMinutes(query.time.at, 10)),
          ]
        : [],
    );
    const response = await planTrip(request(), deps({ transit: slowerFirst }));
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(transitLegsOf(itinerary.legs).map((leg) => leg.service.name)).toEqual(['M1']);
    }
  });

  it('catches a later service when the drive leaving on time misses the first one', async () => {
    // Each route takes a minute longer than the estimate the car park was ranked on.
    const slowerThanEstimated = fakeDriving({
      async routeDrive(from, to) {
        return {
          durationSeconds: driveSeconds(from, to) + 60,
          distanceMetres: haversineMetres(from, to) * 1.35,
          trafficAware: true,
          path: [from, to],
        };
      },
    });
    // The first service leaves just as the estimate has the traveller reach the platform.
    const justInTime = fakeTransit((query) =>
      query.from.kind === 'car-park'
        ? [0, 1, 2].map((n) =>
            metroJourney(
              query.from,
              query.to,
              addMinutes(query.time.at, WALK_TO_STOP_MINUTES + n * METRO_HEADWAY_MINUTES),
            ),
          )
        : [],
    );
    const response = await planTrip(
      request(),
      deps({ driving: slowerThanEstimated, transit: justInTime }),
    );
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(secondsBetween(NOW, itinerary.departAt)).toBe(0);
      expect(findContinuityIssues(itinerary.legs)).toEqual([]);
    }
    expect(response.rejected.map((entry) => entry.reason)).not.toContain(
      'departs-before-requested',
    );
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

  it('says so when no station with drop-off access is within the driving limit', async () => {
    const response = await planTrip(
      request({
        origin: ROUSE_HILL,
        access: { transit: true, drive: false, dropOff: true },
        preferences: { ...DEFAULT_PREFERENCES, maxDriveMinutes: 5 },
      }),
      deps(),
    );

    expect(response.itineraries.some((it) => it.strategy === 'drop-off')).toBe(false);
    expect(response.unavailable).toContainEqual({
      strategy: 'drop-off',
      reason: 'No stations with drop-off access are within your 5 min driving limit.',
    });
  });

  it('says so when no public transport connection works from the stations', async () => {
    const nothingFromStations = fakeTransit((query) =>
      query.from.kind === 'stop' ? [] : metroTimetable(query),
    );
    const response = await planTrip(
      request({ origin: ROUSE_HILL, access: { transit: true, drive: false, dropOff: true } }),
      deps({ transit: nothingFromStations }),
    );

    expect(response.itineraries.some((it) => it.strategy === 'drop-off')).toBe(false);
    expect(response.unavailable).toContainEqual({
      strategy: 'drop-off',
      reason: 'No public transport connection worked from the stations checked.',
    });
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
  const evening = '2026-10-27T06:30:00Z'; // 5.30 pm in Sydney
  const homeBy = '2026-10-27T08:00:00Z'; // 7 pm in Sydney
  const atEvening = (overrides: Partial<PlannerDeps> = {}) =>
    deps({ clock: { now: () => new Date(evening) }, ...overrides });
  const homeThroughCar = (overrides: Partial<PlanRequest> = {}) =>
    request({
      origin: CHATSWOOD_OFFICE,
      destination: ROUSE_HILL,
      time: { type: 'depart', at: evening },
      trip: { kind: 'return-via-car', parkedCar },
      ...overrides,
    });

  it('goes back through the confirmed parked car before driving home', async () => {
    const response = await planTrip(homeThroughCar(), atEvening());

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.strategy).toBe('return-via-car');
      const retrieval = itinerary.legs.findIndex((leg) => leg.kind === 'car-retrieval');
      const drive = itinerary.legs[retrieval + 1]!;
      expect(drive.kind).toBe('drive');
      expect(drive.from.coordinate).toEqual(parkedAt.coordinate);
      expect(itinerary.legs[retrieval - 1]!.to.coordinate).toEqual(parkedAt.coordinate);
      expect(findContinuityIssues(itinerary.legs)).toEqual([]);
      expect(itinerary.notes).toEqual([]);
    }
  });

  it('still goes home through the car when the drive home is longer than the driving limit', async () => {
    // The fake drive from the car to Rouse Hill takes 12 minutes.
    const preferences = { ...DEFAULT_PREFERENCES, maxDriveMinutes: 10 };
    const leaving = await planTrip(homeThroughCar({ preferences }), atEvening());
    const arriving = await planTrip(
      homeThroughCar({ preferences, time: { type: 'arrive', at: homeBy } }),
      atEvening(),
    );

    for (const response of [leaving, arriving]) {
      expect(response.itineraries.length).toBeGreaterThan(0);
      expect(response.rejected).toEqual([]);
      for (const itinerary of response.itineraries) {
        expect(legSeconds(itinerary.legs.at(-1)!)).toBeGreaterThan(10 * 60);
        expect(itinerary.notes).toEqual([
          'The drive home is longer than your 10 min driving limit.',
        ]);
      }
    }
  });

  it('goes home on the journeys that reach the car first, whatever order they come in', async () => {
    const slowerFirst = fakeTransit((query) => [
      metroJourney(query.from, query.to, addMinutes(query.time.at, 4), {
        name: 'Slow 1',
        extraRideMinutes: 40,
      }),
      metroJourney(query.from, query.to, addMinutes(query.time.at, 5), {
        name: 'Slow 2',
        extraRideMinutes: 40,
      }),
      metroJourney(query.from, query.to, addMinutes(query.time.at, 10)),
    ]);
    const response = await planTrip(homeThroughCar(), atEvening({ transit: slowerFirst }));
    const services = response.itineraries.map(
      (itinerary) => transitLegsOf(itinerary.legs)[0]!.service.name,
    );

    expect(services).toEqual(['M1', 'Slow 1']);
  });

  it('never shortens the car retrieval buffer for a service that reaches the car late', async () => {
    const runningLate = fakeTransit((query) => [
      ...metroTimetable(query),
      journeyArrivingAt(query.from, query.to, addMinutes(query.time.at, 3)),
    ]);
    const response = await planTrip(
      homeThroughCar({ time: { type: 'arrive', at: homeBy } }),
      atEvening({ transit: runningLate }),
    );

    expect(response.itineraries).toHaveLength(1);
    const legs = response.itineraries[0]!.legs;
    const retrieval = legs.find((leg) => leg.kind === 'car-retrieval')!;
    expect(legSeconds(retrieval)).toBe(DEFAULT_PREFERENCES.carRetrievalBufferMinutes * 60);
    expect(findContinuityIssues(legs)).toEqual([]);
    expect(secondsBetween(legs.at(-1)!.end, homeBy)).toBeGreaterThanOrEqual(0);
  });

  it('starts at the car, without asking for public transport, when already there', async () => {
    // Like the demo provider, this one has no journey for a trip this short.
    const transit = fakeTransit(() => []);
    const response = await planTrip(
      homeThroughCar({
        origin: { ...parkedAt, name: 'Current location', kind: 'current-location' },
      }),
      atEvening({ transit }),
    );

    expect(transit.queries).toEqual([]);
    expect(response.unavailable).toEqual([]);
    expect(response.itineraries).toHaveLength(1);
    const itinerary = response.itineraries[0]!;
    expect(kinds(itinerary.legs)).toEqual(['car-retrieval', 'drive']);
    expect(secondsBetween(evening, itinerary.departAt)).toBe(0);
  });

  it('walks to a car close by at the traveller’s walking speed', async () => {
    const transit = fakeTransit(() => []);
    // About 200 m north of the car: 260 m on foot, so 4 minutes at a normal pace and 5 when slow.
    const nearby = place('Café', parkedAt.coordinate.lat + 0.0018, parkedAt.coordinate.lon);
    const plans = await Promise.all(
      (['normal', 'slow'] as const).map((walkingSpeed) =>
        planTrip(
          homeThroughCar({
            origin: nearby,
            preferences: { ...DEFAULT_PREFERENCES, walkingSpeed },
          }),
          atEvening({ transit }),
        ),
      ),
    );

    expect(transit.queries).toEqual([]);
    for (const response of plans) {
      const [walkToCar, retrieval] = response.itineraries[0]!.legs;
      expect(kinds(response.itineraries[0]!.legs)).toEqual(['walk', 'car-retrieval', 'drive']);
      expect(walkToCar).toMatchObject({ from: nearby, to: { kind: 'parked-car' } });
      expect(secondsBetween(evening, walkToCar!.start)).toBe(0);
      expect(retrieval!.start).toBe(walkToCar!.end);
    }
    expect(plans.map((response) => legSeconds(response.itineraries[0]!.legs[0]!) / 60)).toEqual([
      4, 5,
    ]);
  });

  it('works back from an arrive-by time when the car is close by', async () => {
    const nearby = place('Café', parkedAt.coordinate.lat + 0.0018, parkedAt.coordinate.lon);
    const response = await planTrip(
      homeThroughCar({ origin: nearby, time: { type: 'arrive', at: homeBy } }),
      atEvening({ transit: fakeTransit(() => []) }),
    );
    const legs = response.itineraries[0]!.legs;

    expect(kinds(legs)).toEqual(['walk', 'car-retrieval', 'drive']);
    expect(legs[1]!.start).toBe(legs[0]!.end);
    expect(legSeconds(legs[1]!)).toBe(DEFAULT_PREFERENCES.carRetrievalBufferMinutes * 60);
    expect(secondsBetween(legs[2]!.end, homeBy)).toBe(0);
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

  describe('when the car park list fails', () => {
    const listBusy = 'Car park details are busy right now. Try again shortly.';
    const failingList: CarParkProvider = {
      ...fakeCarParks(),
      async listFacilities() {
        throw new ProviderError('tfnsw-car-park', 'rate-limited', 'HTTP 429');
      },
    };

    it('says the car park details are unavailable instead of that none are on the way', async () => {
      const response = await planTrip(
        request({ access: { transit: true, drive: true, dropOff: true } }),
        deps({ carParks: failingList }),
      );

      expect(response.notices).toContain(listBusy);
      expect(response.unavailable).toContainEqual({ strategy: 'park-and-ride', reason: listBusy });
      expect(response.unavailable).toContainEqual({ strategy: 'drop-off', reason: listBusy });
      expect(response.unavailable).toHaveLength(2);
      expect(response.itineraries.map((it) => it.strategy)).toContain('transit-only');
    });

    it('still parks at a spot the traveller saved', async () => {
      const savedSpot = {
        id: 'saved-1',
        name: 'Mum’s place, Kellyville',
        coordinate: { lat: -33.7101, lon: 150.9562 },
      };
      const response = await planTrip(
        request({ origin: ROUSE_HILL, savedParkingSpots: [savedSpot] }),
        deps({ carParks: failingList }),
      );

      expect(response.notices).toContain(listBusy);
      expect(response.unavailable).toEqual([]);
      const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');
      expect(parkAndRide.map((it) => it.parking?.carPark.id)).toEqual(['saved-1']);
    });
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
