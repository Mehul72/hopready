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
  type Strategy,
} from './model';
import { findCataloguedCarPark } from './data/park-and-ride';
import {
  DEFAULT_PLANNER_LIMITS,
  PARK_AND_WALK_FEE_NOTE,
  planTrip,
  type PlannerDeps,
} from './planner';
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
import { addMinutes, addSeconds, isBefore, secondsBetween } from './time';
import { place, transit, walk } from './test-support/legs';
import { streetWalkBetween } from './walking';

// ---------- a tiny deterministic world ----------

const BOX_HILL = place('8 Example Rd, Box Hill', -33.6431, 150.8975);
const ROUSE_HILL = place('12 Example St, Rouse Hill', -33.6789, 150.9152);
const BELLA_VISTA_HOME = place('5 Example Close, Bella Vista', -33.7306, 150.9445);
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
const HILLS_SHOWGROUND = facility(
  '32',
  'Hills Showground',
  -33.7289,
  150.9817,
  'Hills Showground Station',
  '2154392',
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

// How a journey reaches its first service: from a stop (asked for by stop id, as the planner does
// for a car park's station) it starts on the platform, like TfNSW; from anywhere else it walks 4
// minutes to a nearby station.
function boarding(from: Place, boards: string): { station: Place; access: Leg[] } {
  if (from.stopId) return { station: from, access: [] };
  const station = place(
    `${from.name} station`,
    from.coordinate.lat,
    from.coordinate.lon + 0.001,
    'stop',
  );
  return {
    station,
    access: [walk(from, station, addMinutes(boards, -WALK_TO_STOP_MINUTES), boards)],
  };
}

// Every origin connects to every destination by: walk 4 min (none from a stop), metro every 6 min,
// walk 5 min. A slower service can be asked for by name.
function metroJourney(
  from: Place,
  to: Place,
  metroDeparts: string,
  slower: { name: string; extraRideMinutes: number } | null = null,
): TransitJourney {
  const { station, access } = boarding(from, metroDeparts);
  const alight = place(`${to.name} station`, to.coordinate.lat, to.coordinate.lon - 0.001, 'stop');
  const metroArrives = addMinutes(
    metroDeparts,
    rideMinutes(from, to) + (slower?.extraRideMinutes ?? 0),
  );
  return {
    legs: [
      ...access,
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

// A journey that boards at `boards` and reaches the destination's station `rideMinutes` later,
// optionally changing trains at Epping on the way.
function journeyBoardingAt(
  from: Place,
  to: Place,
  boards: string,
  { rideMinutes, change = false }: { rideMinutes: number; change?: boolean },
): TransitJourney {
  const { station, access } = boarding(from, boards);
  const alight = place(`${to.name} station`, to.coordinate.lat, to.coordinate.lon - 0.001, 'stop');
  const epping = place('Epping Station', -33.7727, 151.0818, 'stop');
  const arrives = addMinutes(boards, rideMinutes);
  const rides = change
    ? [
        transit(station, epping, boards, addMinutes(boards, 10), { realtime: true }),
        transit(epping, alight, addMinutes(boards, 14), arrives, { realtime: true, name: 'T9' }),
      ]
    : [transit(station, alight, boards, arrives, { realtime: true })];
  return {
    legs: [
      ...access,
      ...rides,
      walk(alight, to, arrives, addMinutes(arrives, WALK_FROM_STOP_MINUTES), `walk-${to.name}`),
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
    const accessMinutes = from.stopId ? 0 : WALK_TO_STOP_MINUTES;
    const first = alignToHeadway(addMinutes(time.at, accessMinutes), 'up');
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

  it('never reports the outcome reserved for apps older than the server', async () => {
    for (const origin of [BOX_HILL, ROUSE_HILL, BELLA_VISTA_HOME]) {
      const response = await planTrip(request({ origin }), deps());
      expect(response.checkedCarParks.map((carPark) => carPark.outcome)).not.toContain(
        'not-understood',
      );
    }
  });

  it('checks a car park a short drive back from the start, as a local would', async () => {
    // Tallawong is about 1.6 km behind Rouse Hill on the way to Chatswood.
    const response = await planTrip(request({ origin: ROUSE_HILL }), deps());

    expect(response.checkedCarParks).toContainEqual(
      expect.objectContaining({
        id: TALLAWONG.id,
        name: TALLAWONG.name,
        outcome: 'used',
      }),
    );
  });

  it('always tries the quickest drive, even when further car parks score better', async () => {
    // From Rouse Hill, Tallawong is the quickest drive (about 5 minutes), but Kellyville scores
    // better on the rough estimate because it is nearer Chatswood. With room for one car park,
    // the estimate alone would pick Kellyville.
    const response = await planTrip(
      request({ origin: ROUSE_HILL }),
      deps({ limits: { maxTransferCandidates: 1 } }),
    );
    const outcomeOf = (id: string) =>
      response.checkedCarParks.find((carPark) => carPark.id === id)?.outcome;

    expect(outcomeOf(TALLAWONG.id)).toBe('used');
    expect(outcomeOf(KELLYVILLE.id)).toBe('not-tried');
  });

  it('tries the two quickest drives to different stations, and names the car parks left', async () => {
    // From Rouse Hill: Tallawong 5 min, Kellyville 12 min, Bella Vista 17 min, Hills Showground
    // 22 min. Hills Showground scores best because it is nearest Chatswood. With room for two,
    // the estimate alone would pick Tallawong and Hills Showground.
    const response = await planTrip(
      request({ origin: ROUSE_HILL }),
      deps({
        carParks: fakeCarParks(new Map(), [TALLAWONG, KELLYVILLE, BELLA_VISTA, HILLS_SHOWGROUND]),
        limits: { maxTransferCandidates: 2 },
      }),
    );
    const outcomeOf = (id: string) =>
      response.checkedCarParks.find((carPark) => carPark.id === id)?.outcome;

    expect(outcomeOf(TALLAWONG.id)).toBe('used');
    expect(outcomeOf(KELLYVILLE.id)).toBe('used');
    expect(outcomeOf(HILLS_SHOWGROUND.id)).toBe('not-tried');
    expect(outcomeOf(BELLA_VISTA.id)).toBe('not-tried');
  });

  it('counts two car parks at one station as one quickest drive', async () => {
    // Tallawong P2 shares Tallawong Station with P1, so Kellyville is the second station tried.
    const tallawongP2 = { ...TALLAWONG, id: '27', name: 'Tallawong P2' };
    const response = await planTrip(
      request({ origin: ROUSE_HILL }),
      deps({
        carParks: fakeCarParks(new Map(), [TALLAWONG, tallawongP2, KELLYVILLE, HILLS_SHOWGROUND]),
        limits: { maxTransferCandidates: 2 },
      }),
    );
    const outcomeOf = (id: string) =>
      response.checkedCarParks.find((carPark) => carPark.id === id)?.outcome;

    expect(outcomeOf(TALLAWONG.id)).toBe('used');
    expect(outcomeOf(KELLYVILLE.id)).toBe('used');
    expect(outcomeOf(tallawongP2.id)).toBe('not-tried');
  });

  it('tries car parks behind the traveller too, since the estimate decides, not the direction', async () => {
    // From Bella Vista, Kellyville is 2.1 km back and Tallawong 5.6 km back. Driving back to a
    // station is a real choice, so both are tried and listed.
    const response = await planTrip(request({ origin: BELLA_VISTA_HOME }), deps());
    const outcomeOf = (id: string) =>
      response.checkedCarParks.find((carPark) => carPark.id === id)?.outcome;

    expect(outcomeOf(TALLAWONG.id)).toBe('used');
    expect(outcomeOf(KELLYVILLE.id)).toBe('used');
    expect(outcomeOf(BELLA_VISTA.id)).toBe('used');
    expect(response.checkedCarParks.map((carPark) => carPark.outcome)).not.toContain(
      'not-towards-destination',
    );
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

  it('keeps a car park whose drive runs past the limit in traffic, marked as a long drive', async () => {
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
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) expect(itinerary.concerns).toContain('long-drive');
    expect(response.rejected.map((entry) => entry.reason)).not.toContain('drive-too-long');
    expect(response.checkedCarParks.map((carPark) => carPark.outcome)).toContain('used');
  });

  it('skips a service now expected after the arrive-by time for one that arrives in time', async () => {
    const runningLate = fakeTransit((query) =>
      query.from.kind === 'stop'
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

    expect(response.checkedCarParks).toContainEqual(
      expect.objectContaining({
        id: TALLAWONG.id,
        name: TALLAWONG.name,
        outcome: 'used',
      }),
    );
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

describe('listing car parks as real choices', () => {
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
  // The planner asks for a car park's journeys from its station, so journeys are keyed by the
  // station's name, and two car parks at one station get the same answer.
  const changingJourneysFrom = (
    stationName: string,
    change: (journey: TransitJourney) => TransitJourney,
  ) =>
    fakeTransit((query) => {
      const journeys = metroTimetable(query);
      return query.from.name === stationName ? journeys.map(change) : journeys;
    });

  describe('at different stations', () => {
    // From Tallawong P1 the traveller leaves later, drives less and arrives sooner than from Bella
    // Vista, which is no reason to hide Bella Vista: it is a different station, and where to go
    // when Tallawong fills.
    const tallawongAndBellaVista = (tallawongCount: Occupancy | null) =>
      fakeCarParks(new Map(tallawongCount ? [[TALLAWONG.id, tallawongCount]] : []), [
        TALLAWONG,
        BELLA_VISTA,
      ]);

    it('lists both, whatever the better one says about its spaces', async () => {
      const planWith = async (tallawongCount: Occupancy | null) =>
        shownCarParks(
          await planTrip(request(), deps({ carParks: tallawongAndBellaVista(tallawongCount) })),
        );

      expect(await planWith(count(60))).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
      expect(await planWith(count(12))).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
      expect(await planWith(count(60, 45))).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
      expect(await planWith(null)).toEqual([TALLAWONG.id, BELLA_VISTA.id]);
    });

    it('reports both as used', async () => {
      const response = await planTrip(
        request(),
        deps({ carParks: tallawongAndBellaVista(count(60)) }),
      );

      expect(response.checkedCarParks).toContainEqual(
        expect.objectContaining({
          id: BELLA_VISTA.id,
          name: BELLA_VISTA.name,
          outcome: 'used',
        }),
      );
      expect(response.checkedCarParks).toContainEqual(
        expect.objectContaining({
          id: TALLAWONG.id,
          name: TALLAWONG.name,
          outcome: 'used',
        }),
      );
    });

    it('lists both when only one has an alert, or only one has live times', async () => {
      const planWith = async (transit: TransitProvider) =>
        shownCarParks(
          await planTrip(request(), deps({ transit, carParks: tallawongAndBellaVista(count(60)) })),
        );
      const tallawongStation = TALLAWONG.station!.name;

      expect(await planWith(changingJourneysFrom(tallawongStation, withLiftsOut))).toEqual([
        TALLAWONG.id,
        BELLA_VISTA.id,
      ]);
      expect(await planWith(changingJourneysFrom(tallawongStation, onTimetable))).toEqual([
        TALLAWONG.id,
        BELLA_VISTA.id,
      ]);
    });

    describe('in order of arrival', () => {
      // Tallawong P1 is a 15 min drive and Kellyville 23 min. Each station has one journey,
      // boarding at a set time.
      const at = (minutesAfterNow: number) => addMinutes(NOW, minutesAfterNow);
      const tallawongStation = TALLAWONG.station!.name;
      const kellyvilleStation = KELLYVILLE.station!.name;
      const planWith = async (
        journeys: Record<string, { boards: string; rideMinutes: number; change?: boolean }>,
        overrides: Partial<PlanRequest> = {},
      ) => {
        const transit = fakeTransit((query) => {
          const journey = journeys[query.from.name];
          return journey
            ? [journeyBoardingAt(query.from, query.to, journey.boards, journey)]
            : metroTimetable(query);
        });
        const occupancy = new Map([
          [TALLAWONG.id, count(60)],
          [KELLYVILLE.id, count(60)],
        ]);
        const carParks = fakeCarParks(occupancy, [TALLAWONG, KELLYVILLE]);
        return shownCarParks(await planTrip(request(overrides), deps({ transit, carParks })));
      };

      it('puts the one arriving sooner first, even behind one at the station asked for', async () => {
        const shown = await planWith(
          {
            [tallawongStation]: { boards: at(30), rideMinutes: 40 },
            [kellyvilleStation]: { boards: at(36), rideMinutes: 30 },
          },
          { preferredStop: TALLAWONG.station! },
        );

        expect(shown).toEqual([KELLYVILLE.id, TALLAWONG.id]);
      });

      it('keeps the one that drives less, after one that arrives sooner', async () => {
        const shown = await planWith({
          [tallawongStation]: { boards: at(30), rideMinutes: 40 },
          [kellyvilleStation]: { boards: at(38), rideMinutes: 30 },
        });

        expect(shown).toEqual([KELLYVILLE.id, TALLAWONG.id]);
      });

      it('keeps the one with fewer changes, after one that arrives sooner', async () => {
        const shown = await planWith({
          [tallawongStation]: { boards: at(28), rideMinutes: 37, change: true },
          [kellyvilleStation]: { boards: at(36), rideMinutes: 30 },
        });

        expect(shown).toEqual([TALLAWONG.id, KELLYVILLE.id]);
      });
    });
  });

  it('never hides a car park behind a drop-off, which is another way to travel', async () => {
    const response = await planTrip(
      request({ access: { transit: true, drive: true, dropOff: true } }),
      deps({ carParks: fakeCarParks(new Map([[TALLAWONG.id, count(60)]]), [TALLAWONG]) }),
    );
    const arrivals = (strategy: Strategy) =>
      response.itineraries.filter((it) => it.strategy === strategy).map((it) => it.arriveAt);

    expect(shownCarParks(response)).toEqual([TALLAWONG.id]);
    // The drop-off at the same station gets there sooner, with no more time in a car.
    expect(arrivals('drop-off')).toHaveLength(1);
    expect(isBefore(arrivals('drop-off')[0]!, arrivals('park-and-ride')[0]!)).toBe(true);
  });

  describe('at one station', () => {
    // Two car parks at Tallawong Station, which both get the same train. P2 is beside the platform;
    // P1 is a walk away, so from P1 the traveller leaves earlier for that train.
    const platform = TALLAWONG.station!.coordinate;
    const metresPerDegreeOfLongitude = 92_600;
    const carParkWestOfPlatform = (id: string, name: string, metres: number): CarParkFacility => ({
      ...TALLAWONG,
      id,
      name,
      coordinate: { lat: platform.lat, lon: platform.lon - metres / metresPerDegreeOfLongitude },
    });
    const TALLAWONG_P2 = carParkWestOfPlatform('27', 'Tallawong P2', 0);
    const twoMinutesFromPlatform = carParkWestOfPlatform('26', 'Tallawong P1', 100);
    const tallawongTwins = (p1: CarParkFacility, occupancy: Map<string, Occupancy>) =>
      fakeCarParks(occupancy, [p1, TALLAWONG_P2]);
    // One train from the station, so the twins can only differ in the walk, the drive and the count.
    const oneTrain = fakeTransit((query) =>
      query.from.kind === 'stop'
        ? [metroJourney(query.from, query.to, addMinutes(NOW, 45))]
        : metroTimetable(query),
    );
    const planWith = async (
      p1: CarParkFacility,
      p1Count: Occupancy | null,
      p2Count: Occupancy | null,
      overrides: Partial<PlanRequest> = {},
    ) => {
      const occupancy = new Map<string, Occupancy>();
      if (p1Count) occupancy.set(p1.id, p1Count);
      if (p2Count) occupancy.set(TALLAWONG_P2.id, p2Count);
      return planTrip(
        request(overrides),
        deps({ transit: oneTrain, carParks: tallawongTwins(p1, occupancy) }),
      );
    };

    it('lists only the one with room when their cards would read the same', async () => {
      const beside = carParkWestOfPlatform('26', 'Tallawong P1', 0);

      expect(shownCarParks(await planWith(beside, count(12), count(60)))).toEqual([
        TALLAWONG_P2.id,
      ]);
      expect(shownCarParks(await planWith(beside, count(60), count(12)))).toEqual([beside.id]);
    });

    it('lists only the one that lets the traveller leave later for the same train', async () => {
      const response = await planWith(twoMinutesFromPlatform, count(60), count(60));
      const [option] = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

      expect(shownCarParks(response)).toEqual([TALLAWONG_P2.id]);
      // Beside the platform there is nothing to walk, and the drive is timed to meet the train.
      expect(option?.legs.map((leg) => leg.kind)).toEqual(['drive', 'park', 'transit', 'walk']);
    });

    it('walks from the car park to the platform in its own estimate when they are apart', async () => {
      const response = await planWith(twoMinutesFromPlatform, count(60), null);
      const option = response.itineraries.find((it) => it.parking?.carPark.id === '26')!;
      const walkToPlatform = option.legs[2]!;

      expect(option.legs.map((leg) => leg.kind)).toEqual([
        'drive',
        'park',
        'walk',
        'transit',
        'walk',
      ]);
      expect(walkToPlatform).toMatchObject({ source: 'hopready', timing: 'estimated' });
      expect(secondsBetween(walkToPlatform.start, walkToPlatform.end)).toBe(120);
      expect(walkToPlatform.to).toEqual(TALLAWONG.station);
    });

    it('tries one car park per station: the one surer of a space, then the one nearer the platform', async () => {
      const shownWith = async (p1Count: Occupancy | null, p2Count: Occupancy | null) =>
        shownCarParks(await planWith(twoMinutesFromPlatform, p1Count, p2Count));
      const withRoom = count(60);
      const nearlyFull = count(12);
      const stale = count(60, 45);

      // Both get the same train, so only one is asked for journeys: room beats no count or an old
      // one, which beats nearly full; all else equal, the shorter walk to the platform wins.
      expect(await shownWith(null, null)).toEqual([TALLAWONG_P2.id]);
      expect(await shownWith(nearlyFull, withRoom)).toEqual([TALLAWONG_P2.id]);
      expect(await shownWith(nearlyFull, null)).toEqual([TALLAWONG_P2.id]);
      expect(await shownWith(null, stale)).toEqual([TALLAWONG_P2.id]);
      expect(await shownWith(withRoom, nearlyFull)).toEqual(['26']);
      expect(await shownWith(withRoom, null)).toEqual(['26']);
      expect(await shownWith(stale, nearlyFull)).toEqual(['26']);
    });

    it('lists the twin it did not try with its station and an estimate, never as used', async () => {
      const response = await planWith(twoMinutesFromPlatform, null, null);
      const notTried = response.checkedCarParks.find((carPark) => carPark.id === '26');

      expect(notTried).toMatchObject({
        name: 'Tallawong P1',
        outcome: 'not-tried',
        stationName: 'Tallawong Station',
      });
      expect(notTried?.estimatedMinutes).toBeGreaterThan(0);
      expect(response.checkedCarParks).toContainEqual(
        expect.objectContaining({ id: TALLAWONG_P2.id, outcome: 'used' }),
      );
    });

    it('still lists the car park asked for, next to its better twin', async () => {
      const response = await planWith(twoMinutesFromPlatform, null, null, {
        preferredCarParkId: '26',
      });

      expect(shownCarParks(response)).toEqual([TALLAWONG_P2.id, '26']);
    });

    it('lists one option for a station asked for, not one per car park', async () => {
      const response = await planWith(twoMinutesFromPlatform, null, null, {
        preferredStop: TALLAWONG.station!,
      });

      expect(shownCarParks(response)).toEqual([TALLAWONG_P2.id]);
    });
  });
});

describe('more options than the list has room for', () => {
  it('says a car park whose option is cut from the list was left out for space, not used', async () => {
    // Four public transport journeys, three car parks, three drop-off stations and the drive make
    // eleven options. Each car park and station has a service alert of its own, so none matches
    // another, and Bella Vista's train is slow, so its car park arrives last of all.
    const transit = fakeTransit((query) => {
      if (query.from.name === BOX_HILL.name) {
        const first = alignToHeadway(addMinutes(query.time.at, WALK_TO_STOP_MINUTES), 'up');
        return [0, 1, 2, 3].map((n) =>
          metroJourney(query.from, query.to, addMinutes(first, n * METRO_HEADWAY_MINUTES)),
        );
      }
      const slower = query.from.name.startsWith('Bella Vista')
        ? { name: 'M1 slow', extraRideMinutes: 45 }
        : null;
      const first = alignToHeadway(addMinutes(query.time.at, WALK_TO_STOP_MINUTES), 'up');
      const alert: ServiceAlert = {
        id: `works-${query.from.name}`,
        severity: 'info',
        title: `Station works at ${query.from.name}`,
      };
      return [{ ...metroJourney(query.from, query.to, first, slower), alerts: [alert] }];
    });
    const response = await planTrip(
      request({
        access: { transit: true, drive: true, dropOff: true },
        preferences: { ...DEFAULT_PREFERENCES, maxDriveMinutes: 120 },
      }),
      deps({ transit }),
    );
    const outcomeOf = (carPark: CarParkFacility) =>
      response.checkedCarParks.find((checked) => checked.id === carPark.id)?.outcome;

    expect(response.rejected).toEqual([]);
    expect(response.itineraries).toHaveLength(DEFAULT_PLANNER_LIMITS.maxItineraries);
    expect(
      response.itineraries
        .map((it) => it.parking?.carPark.id)
        .filter(Boolean)
        .sort(),
    ).toEqual([TALLAWONG.id, KELLYVILLE.id].sort());
    expect(outcomeOf(TALLAWONG)).toBe('used');
    expect(outcomeOf(KELLYVILLE)).toBe('used');
    expect(outcomeOf(BELLA_VISTA)).toBe('left-out-for-space');
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

// About 600 m south of the Bella Vista car park: a 14 minute street walk at normal pace (600 m x 1.5
// at 1.1 m/s, rounded up).
const NEAR_BELLA_VISTA = place('3 Example Pl, Bella Vista', -33.736, 150.944);

// Boards `boards`, rides `rideMinutes`, then walks `walkMinutes` from the stop to `to`.
function journeyWithFinalWalk(
  from: Place,
  to: Place,
  boards: string,
  rideMinutes: number,
  walkMinutes: number,
  name = 'M1',
): TransitJourney {
  const { station, access } = boarding(from, boards);
  const alight = place(`${to.name} stop`, to.coordinate.lat, to.coordinate.lon - 0.001, 'stop');
  const arrives = addMinutes(boards, rideMinutes);
  return {
    legs: [
      ...access,
      transit(station, alight, boards, arrives, { realtime: true, name }),
      walk(alight, to, arrives, addMinutes(arrives, walkMinutes), `walk-${name}-${to.name}`),
    ],
    fare: { status: 'unknown' },
    alerts: [],
  };
}

describe('walking the rest from a car park near the destination', () => {
  // TfNSW's answer on a Saturday evening when it was asked to keep every walk short: a school bus
  // on Monday afternoon (owner's trip, 2026-10-31).
  const onlyMondayBuses = fakeTransit((query) => [
    journeyWithFinalWalk(query.from, query.to, addMinutes(query.time.at, 42 * 60), 5, 7, '6627'),
  ]);

  it('drives, parks and walks instead of taking a bus days later', async () => {
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: onlyMondayBuses }),
    );
    const bellaVista = response.itineraries.find(
      (it) => it.parking?.carPark.id === BELLA_VISTA.id,
    )!;

    expect(kinds(bellaVista.legs)).toEqual(['drive', 'park', 'walk']);
    const walkThere = bellaVista.legs[2]!;
    expect(walkThere).toMatchObject({ source: 'hopready', timing: 'estimated' });
    expect(walkThere.from.carParkId).toBe(BELLA_VISTA.id);
    expect(walkThere.to).toEqual(NEAR_BELLA_VISTA);
    expect(legSeconds(walkThere)).toBe(
      streetWalkBetween(BELLA_VISTA.coordinate, NEAR_BELLA_VISTA.coordinate, 'normal')
        .durationSeconds,
    );
    expect(bellaVista.departAt).toBe(NOW);
    expect(bellaVista.notes).toEqual([PARK_AND_WALK_FEE_NOTE]);
    expect(bellaVista.concerns).toEqual([]);
    expect(findContinuityIssues(bellaVista.legs)).toEqual([]);
    expect(response.checkedCarParks.find((carPark) => carPark.id === BELLA_VISTA.id)?.outcome).toBe(
      'used',
    );
  });

  it('never offers an option leaving more than 12 hours after the time asked for', async () => {
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: onlyMondayBuses }),
    );

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(secondsBetween(NOW, itinerary.departAt)).toBeLessThanOrEqual(12 * 60 * 60);
    }
    expect(response.rejected).toContainEqual({
      reason: 'departs-long-after-requested',
      count: expect.any(Number),
    });
    // Tallawong and Kellyville are a long walk from the destination, so Monday was all they had.
    expect(response.checkedCarParks.find((carPark) => carPark.id === TALLAWONG.id)?.outcome).toBe(
      'no-workable-connection',
    );
  });

  it('never offers an option arriving more than 12 hours before an arrive-by time', async () => {
    // Asked to arrive by Sunday 10:00, a capped TfNSW answered with Friday arrivals (2026-10-31).
    // Here: arrive by 30 hours from now; one journey gets there 20 hours early, one 2 hours early.
    const arriveBy = addMinutes(NOW, 30 * 60);
    const earlyOrNear = fakeTransit((query) => [
      journeyWithFinalWalk(
        query.from,
        query.to,
        addMinutes(query.time.at, -20 * 60),
        30,
        5,
        'EARLY',
      ),
      journeyWithFinalWalk(query.from, query.to, addMinutes(query.time.at, -2 * 60), 30, 5, 'NEAR'),
    ]);
    const response = await planTrip(
      request({
        time: { type: 'arrive', at: arriveBy },
        access: { transit: true, drive: false, dropOff: false },
      }),
      deps({ transit: earlyOrNear }),
    );

    expect(
      response.itineraries.map((it) => transitLegsOf(it.legs).map((leg) => leg.service.name)),
    ).toEqual([['NEAR']]);
    expect(response.rejected).toEqual([{ reason: 'arrives-long-before-target', count: 1 }]);
  });

  it('says when the first public transport leaves when everything found is too far off', async () => {
    const response = await planTrip(
      request({ access: { transit: true, drive: false, dropOff: false } }),
      deps({ transit: onlyMondayBuses }),
    );

    expect(response.itineraries).toEqual([]);
    // Tuesday 7.30 am plus 42 hours is a 1.30 am bus on Thursday.
    expect(response.unavailable).toEqual([
      {
        strategy: 'transit-only',
        reason:
          'The first public transport found leaves Thu 29 Oct 1:30\u00a0am, more than 12 hours after the time asked for.',
      },
    ]);
    expect(response.rejected).toEqual([{ reason: 'departs-long-after-requested', count: 1 }]);
  });

  it('keeps a public transport option that leaves within 12 hours, such as the first train', async () => {
    const firstTrainTomorrow = fakeTransit((query) => [
      journeyWithFinalWalk(query.from, query.to, addMinutes(query.time.at, 11 * 60), 30, 5),
    ]);
    const response = await planTrip(
      request({ access: { transit: true, drive: false, dropOff: false } }),
      deps({ transit: firstTrainTomorrow }),
    );

    expect(response.itineraries).toHaveLength(1);
    expect(response.rejected).toEqual([]);
  });

  it('never leaves on time only to wait more than 12 hours for the bus', async () => {
    // Each route takes 5 minutes longer than the estimate the car park was ranked on, so the drive
    // misses the service it was planned for, and the next one TfNSW found is 40 hours later.
    const slowerThanEstimated = fakeDriving({
      async routeDrive(from, to) {
        return {
          durationSeconds: driveSeconds(from, to) + 5 * 60,
          distanceMetres: haversineMetres(from, to) * 1.35,
          trafficAware: true,
          path: [from, to],
        };
      },
    });
    const tonightOrDaysLater = fakeTransit((query) =>
      query.from.stopId
        ? [
            journeyWithFinalWalk(query.from, query.to, query.time.at, 30, 5, 'TONIGHT'),
            journeyWithFinalWalk(
              query.from,
              query.to,
              addMinutes(query.time.at, 40 * 60),
              30,
              5,
              'DAYS-LATER',
            ),
          ]
        : [],
    );
    const response = await planTrip(
      request(),
      deps({ driving: slowerThanEstimated, transit: tonightOrDaysLater }),
    );

    for (const itinerary of response.itineraries) {
      expect(secondsBetween(itinerary.departAt, itinerary.arriveAt)).toBeLessThan(12 * 60 * 60);
    }
    expect(response.rejected.map((entry) => entry.reason)).toContain(
      'departs-long-after-requested',
    );
  });

  it('takes a journey inside 12 hours over a better one just past them', async () => {
    // A boards 11 h 45 min after the time asked for and ends with a 20 minute walk, over the limit.
    // B boards at 12 h 40 min and gets there 5 minutes after A, within the limit.
    const nearTheLine = fakeTransit((query) =>
      query.from.stopId
        ? [
            journeyWithFinalWalk(query.from, query.to, addMinutes(NOW, 11 * 60 + 45), 40, 20, 'A'),
            journeyWithFinalWalk(query.from, query.to, addMinutes(NOW, 12 * 60 + 40), 5, 5, 'B'),
          ]
        : [],
    );
    const response = await planTrip(request(), deps({ transit: nearTheLine }));
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(parkAndRide.length).toBeGreaterThan(0);
    for (const itinerary of parkAndRide) {
      expect(transitLegsOf(itinerary.legs).map((leg) => leg.service.name)).toEqual(['A']);
    }
  });

  it('takes public transport from the nearby car park when it gets there sooner', async () => {
    const quickBus = fakeTransit((query) =>
      query.from.stopId
        ? [journeyWithFinalWalk(query.from, query.to, addMinutes(query.time.at, 1), 1, 1, '735')]
        : [],
    );
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: quickBus }),
    );
    const bellaVista = response.itineraries.find(
      (it) => it.parking?.carPark.id === BELLA_VISTA.id,
    )!;

    expect(transitLegsOf(bellaVista.legs).map((leg) => leg.service.name)).toEqual(['735']);
    expect(bellaVista.notes).toEqual([]);
  });

  it('arrives by the time asked for, walking in from the car park', async () => {
    const arriveBy = '2026-10-26T22:00:00Z';
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA, time: { type: 'arrive', at: arriveBy } }),
      deps({ transit: fakeTransit(() => []) }),
    );
    const bellaVista = response.itineraries.find(
      (it) => it.parking?.carPark.id === BELLA_VISTA.id,
    )!;

    expect(kinds(bellaVista.legs)).toEqual(['drive', 'park', 'walk']);
    expect(secondsBetween(bellaVista.arriveAt, arriveBy)).toBe(0);
    const park = bellaVista.legs[1]!;
    expect(secondsBetween(park.start, park.end)).toBe(
      DEFAULT_PREFERENCES.parkingBufferMinutes * 60,
    );
  });

  it('walks from a saved parking spot without the Park&Ride fee note', async () => {
    const savedSpot = {
      id: 'spot-1',
      name: 'Work car space',
      coordinate: { lat: -33.7345, lon: 150.944 },
    };
    const response = await planTrip(
      request({
        destination: NEAR_BELLA_VISTA,
        savedParkingSpots: [savedSpot],
        preferredCarParkId: savedSpot.id,
      }),
      deps({ transit: fakeTransit(() => []) }),
    );
    const fromSpot = response.itineraries.find((it) => it.parking?.carPark.id === savedSpot.id)!;

    expect(kinds(fromSpot.legs)).toEqual(['drive', 'park', 'walk']);
    expect(fromSpot.notes).toEqual([]);
  });

  it('does not walk the rest more than 1.2 km in a straight line, whatever the walking limit', async () => {
    // About 2 km from the Bella Vista car park.
    const farther = place('9 Example Ave, Baulkham Hills', -33.7487, 150.944);
    for (const maxWalkMinutes of [15, 60]) {
      const response = await planTrip(
        request({
          destination: farther,
          preferences: { ...DEFAULT_PREFERENCES, maxWalkMinutes },
        }),
        deps({ transit: fakeTransit(() => []) }),
      );

      expect(response.itineraries.some((it) => it.strategy === 'park-and-ride')).toBe(false);
    }
  });

  it('keeps walking the rest for a slow walker, timed at their pace and marked', async () => {
    // About 1.1 km from the Bella Vista car park: inside the 1.2 km gate, 25 minutes at normal pace.
    const fartherButWalkable = place('7 Example Ave, Bella Vista', -33.7405, 150.944);
    const response = await planTrip(
      request({
        destination: fartherButWalkable,
        preferences: { ...DEFAULT_PREFERENCES, walkingSpeed: 'slow' },
      }),
      deps({ transit: fakeTransit(() => []) }),
    );
    const bellaVista = response.itineraries.find(
      (it) => it.parking?.carPark.id === BELLA_VISTA.id,
    )!;

    expect(kinds(bellaVista.legs)).toEqual(['drive', 'park', 'walk']);
    expect(legSeconds(bellaVista.legs[2]!)).toBe(
      streetWalkBetween(BELLA_VISTA.coordinate, fartherButWalkable.coordinate, 'slow')
        .durationSeconds,
    );
    expect(bellaVista.concerns).toEqual(['long-walk']);
  });

  it('does not drive to a car park to walk from it when the start is no farther away', async () => {
    // Starting 200 m from the destination, nearer than the Bella Vista car park is.
    const nextDoor = place('1 Example Cl, Bella Vista', -33.7378, 150.944);
    const response = await planTrip(
      request({ origin: nextDoor, destination: NEAR_BELLA_VISTA }),
      deps({ transit: fakeTransit(() => []) }),
    );

    expect(response.itineraries.some((it) => it.strategy === 'park-and-ride')).toBe(false);
  });

  it('takes a free public transport option over a paid walk when it is at most 10 minutes later', async () => {
    const walkMinutes =
      streetWalkBetween(BELLA_VISTA.coordinate, NEAR_BELLA_VISTA.coordinate, 'normal')
        .durationSeconds / 60;
    // A bus from the platform that gets there `minutesLater` after walking would.
    const busAfterWalking = (minutesLater: number) =>
      fakeTransit((query) =>
        query.from.stopId === BELLA_VISTA.station!.stopId
          ? [
              journeyWithFinalWalk(
                query.from,
                query.to,
                addMinutes(query.time.at, walkMinutes - 2 - 3 + minutesLater),
                2,
                3,
                '735',
              ),
            ]
          : [],
      );
    const optionAt = (response: PlanResponse) =>
      response.itineraries.find((it) => it.parking?.carPark.id === BELLA_VISTA.id)!;

    const nearlyAsQuick = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: busAfterWalking(6) }),
    );
    expect(transitLegsOf(optionAt(nearlyAsQuick).legs).map((leg) => leg.service.name)).toEqual([
      '735',
    ]);

    const muchLater = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: busAfterWalking(30) }),
    );
    expect(kinds(optionAt(muchLater).legs)).toEqual(['drive', 'park', 'walk']);
  });

  it('keeps both ways on from the car park the traveller asked for, walking first when quicker', async () => {
    const slowBus = fakeTransit((query) =>
      query.from.stopId === BELLA_VISTA.station!.stopId
        ? [journeyWithFinalWalk(query.from, query.to, addMinutes(query.time.at, 30), 2, 3, '735')]
        : [],
    );
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA, preferredCarParkId: BELLA_VISTA.id }),
      deps({ transit: slowBus }),
    );
    const atBellaVista = response.itineraries.filter(
      (it) => it.parking?.carPark.id === BELLA_VISTA.id,
    );

    expect(atBellaVista.map((it) => transitLegsOf(it.legs).length > 0)).toEqual([false, true]);
  });

  it('walks from a car park beside the destination even when its twin at the station has more room', async () => {
    // Two car parks for Bella Vista Station: the north one is 2 km away, the south one 300 m from
    // the destination and nearly full.
    const north = facility(
      '31',
      'Bella Vista (north)',
      -33.7195,
      150.944,
      'Bella Vista Station',
      '2153478',
    );
    const south = facility(
      '310',
      'Bella Vista (south)',
      -33.7333,
      150.944,
      'Bella Vista Station',
      '2153478',
    );
    const counts = new Map<string, Occupancy>([
      [north.id, { status: 'known', spacesAvailable: 300, totalSpaces: 400, observedAt: NOW }],
      [south.id, { status: 'known', spacesAvailable: 10, totalSpaces: 400, observedAt: NOW }],
    ]);
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: fakeTransit(() => []), carParks: fakeCarParks(counts, [north, south]) }),
    );
    const outcomeOf = (carPark: CarParkFacility) =>
      response.checkedCarParks.find((checked) => checked.id === carPark.id)?.outcome;

    expect(outcomeOf(south)).toBe('used');
    expect(
      kinds(response.itineraries.find((it) => it.parking?.carPark.id === south.id)!.legs),
    ).toEqual(['drive', 'park', 'walk']);
  });

  it('still walks from the car park when public transport fails there', async () => {
    const failing = fakeTransit(() => {
      throw new ProviderError('demo-fixture', 'unavailable', 'TfNSW is down');
    });
    const response = await planTrip(
      request({ destination: NEAR_BELLA_VISTA }),
      deps({ transit: failing }),
    );

    expect(
      kinds(response.itineraries.find((it) => it.parking?.carPark.id === BELLA_VISTA.id)!.legs),
    ).toEqual(['drive', 'park', 'walk']);
    expect(response.checkedCarParks.find((carPark) => carPark.id === TALLAWONG.id)?.outcome).toBe(
      'provider-error',
    );
  });

  it('leaves out drop-off stations a short walk from the destination', async () => {
    const transit = fakeTransit();
    await planTrip(
      request({
        destination: NEAR_BELLA_VISTA,
        access: { transit: true, drive: false, dropOff: true },
      }),
      deps({ transit }),
    );

    expect(transit.queries.some((query) => query.from.stopId === BELLA_VISTA.station!.stopId)).toBe(
      false,
    );
  });

  it('marks a walk the rest that is longer than the walking limit', async () => {
    const response = await planTrip(
      request({
        destination: NEAR_BELLA_VISTA,
        preferences: { ...DEFAULT_PREFERENCES, maxWalkMinutes: 8 },
      }),
      deps({ transit: onlyMondayBuses }),
    );
    const bellaVista = response.itineraries.find(
      (it) => it.parking?.carPark.id === BELLA_VISTA.id,
    )!;

    expect(kinds(bellaVista.legs)).toEqual(['drive', 'park', 'walk']);
    expect(bellaVista.concerns).toEqual(['long-walk']);
  });

  it('ranks a car park by the walk when that is how it would be used', async () => {
    // 200 m from the Bella Vista car park; the Kellyville car park is a shorter drive from Box Hill
    // but needs a train.
    const besideBellaVista = place('1 Example Pl, Bella Vista', -33.7324, 150.944);
    const response = await planTrip(
      request({ destination: besideBellaVista }),
      deps({ transit: fakeTransit(() => []), limits: { maxTransferCandidates: 2 } }),
    );
    const outcomeOf = (carPark: CarParkFacility) =>
      response.checkedCarParks.find((checked) => checked.id === carPark.id)?.outcome;

    expect(outcomeOf(BELLA_VISTA)).toBe('used');
    expect(outcomeOf(KELLYVILLE)).toBe('not-tried');
  });
});

describe('choosing which journey to take from a car park', () => {
  // From each car park: LONG gets there 42 minutes after the time asked for, ending with a 20
  // minute walk (over the 15 minute limit); SHORT ends with a 5 minute walk and gets there
  // `minutesLater` after LONG.
  function longWalkOrLater(minutesLater: number) {
    return fakeTransit((query) =>
      query.from.stopId
        ? [
            journeyWithFinalWalk(
              query.from,
              query.to,
              addMinutes(query.time.at, 2),
              20,
              20,
              'LONG',
            ),
            journeyWithFinalWalk(
              query.from,
              query.to,
              addMinutes(query.time.at, 17 + minutesLater),
              20,
              5,
              'SHORT',
            ),
          ]
        : [],
    );
  }
  const servicesUsed = (response: PlanResponse) =>
    response.itineraries
      .filter((it) => it.strategy === 'park-and-ride')
      .map((it) =>
        transitLegsOf(it.legs)
          .map((leg) => leg.service.name)
          .join('+'),
      );

  it('takes the journey within the walking limit when it gets there at most 10 minutes later', async () => {
    for (const minutesLater of [5, 10]) {
      const response = await planTrip(request(), deps({ transit: longWalkOrLater(minutesLater) }));

      expect(servicesUsed(response).length).toBeGreaterThan(0);
      expect(new Set(servicesUsed(response))).toEqual(new Set(['SHORT']));
    }
  });

  it('takes the quicker journey, marked, when the one within the limit is hours later', async () => {
    const response = await planTrip(request(), deps({ transit: longWalkOrLater(3 * 60) }));
    const parkAndRide = response.itineraries.filter((it) => it.strategy === 'park-and-ride');

    expect(new Set(servicesUsed(response))).toEqual(new Set(['LONG']));
    for (const itinerary of parkAndRide) expect(itinerary.concerns).toContain('long-walk');
  });

  it('takes the journey that arrives first, even when a slower one leaves earlier', async () => {
    const slowerFirst = fakeTransit((query) =>
      query.from.kind === 'stop'
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
      query.from.kind === 'stop'
        ? [0, 1, 2].map((n) =>
            metroJourney(
              query.from,
              query.to,
              addMinutes(query.time.at, n * METRO_HEADWAY_MINUTES),
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
    // Box Hill is 5.5 km from Tallawong, the nearest station: a 15 minute drive in this world.
    const response = await planTrip(
      request({
        origin: BOX_HILL,
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

  it('walks back to a car parked within 1.2 km when TfNSW has no journey there', async () => {
    // About 800 m from the Kellyville car park.
    const nearTheCar = place('3 Example Way, Kellyville', -33.7063, 150.9353);
    const response = await planTrip(
      homeThroughCar({ origin: nearTheCar }),
      atEvening({ transit: fakeTransit(() => []) }),
    );

    expect(response.itineraries).toHaveLength(1);
    const walkToCar = response.itineraries[0]!.legs[0]!;
    expect(walkToCar).toMatchObject({ kind: 'walk', source: 'hopready' });
    expect(legSeconds(walkToCar)).toBe(
      streetWalkBetween(nearTheCar.coordinate, parkedAt.coordinate, 'normal').durationSeconds,
    );
    expect(response.unavailable).toEqual([]);
  });

  it('does not reach the car more than 12 hours before an arrive-by time', async () => {
    const arriveBy = addMinutes(evening, 30 * 60);
    // TfNSW's latest journey back to the car gets there 20 hours before it is needed.
    const dayEarly = fakeTransit((query) =>
      query.time.type === 'arrive'
        ? [
            journeyWithFinalWalk(
              query.from,
              query.to,
              addMinutes(query.time.at, -(20 * 60 + 40)),
              30,
              5,
              'EARLY',
            ),
          ]
        : [],
    );
    const response = await planTrip(
      homeThroughCar({ time: { type: 'arrive', at: arriveBy } }),
      atEvening({ transit: dayEarly }),
    );

    expect(response.itineraries).toEqual([]);
    expect(response.rejected).toEqual([{ reason: 'arrives-long-before-target', count: 1 }]);
    // Home by Wed 28 Oct 11.30 pm: back at the car by 11.13 pm, after the 12 minute drive and the
    // 5 minutes to get going. The service gets there 20 h 10 min before that.
    expect(response.unavailable).toEqual([
      {
        strategy: 'return-via-car',
        reason:
          'The latest way back to your car found arrives Wed 28 Oct 3:03\u00a0am, more than 12 hours before the time asked for.',
      },
    ]);
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
  it('marks a change shorter than the buffer as tight, counting the walk inside it', async () => {
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

    expect(response.itineraries).toHaveLength(1);
    expect(response.itineraries[0]?.concerns).toEqual(['tight-change']);
    expect(response.rejected).toEqual([]);
  });

  it('drops journeys that use a cancelled service', async () => {
    const cancelled = metroTimetable({
      from: BOX_HILL,
      to: CHATSWOOD_OFFICE,
      time: { type: 'depart', at: NOW },
      maxJourneys: 1,
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

  it('marks walks longer than the traveller allows, instead of hiding the trip', async () => {
    const response = await planTrip(
      request({
        access: { transit: true, drive: false, dropOff: false },
        preferences: { ...DEFAULT_PREFERENCES, maxWalkMinutes: 3 },
      }),
      deps(),
    );

    expect(response.itineraries.length).toBeGreaterThan(0);
    for (const itinerary of response.itineraries) {
      expect(itinerary.concerns).toEqual(['long-walk']);
    }
    expect(response.rejected).toEqual([]);
  });

  it('keeps car parks beyond the driving limit out and says so, and marks the long drive', async () => {
    const response = await planTrip(
      request({ preferences: { ...DEFAULT_PREFERENCES, maxDriveMinutes: 5 } }),
      deps(),
    );

    expect(response.itineraries.some((it) => it.strategy === 'park-and-ride')).toBe(false);
    for (const itinerary of response.itineraries) {
      expect(itinerary.concerns).toEqual(itinerary.strategy === 'drive-only' ? ['long-drive'] : []);
    }
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
    const strategies = response.itineraries.map((it) => it.strategy);

    expect(strategies).toContain('transit-only');
    expect(strategies).not.toContain('park-and-ride');
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
    // Every car park was tried and found no connection; that is the explanation, car park by car park.
    expect(response.checkedCarParks.length).toBeGreaterThan(0);
    expect(new Set(response.checkedCarParks.map((carPark) => carPark.outcome))).toEqual(
      new Set(['no-workable-connection']),
    );
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

describe('ranking car parks by the estimated door-to-door time', () => {
  // Real car parks around Kellyville, placed at their stations, so the hub table applies: Seven
  // Hills is on the T1 Western line (33 minutes to Central every 8), the metro stations 39 to 47
  // minutes every 4, and North Rocks is a bus car park (50 minutes every 3).
  const catalogued = (id: string): CarParkFacility => {
    const entry = findCataloguedCarPark(id)!;
    return facility(
      id,
      entry.name,
      entry.station.coordinate.lat,
      entry.station.coordinate.lon - 0.001,
      entry.station.name,
      entry.station.stopId,
    );
  };
  const AROUND_KELLYVILLE = ['32', '29', '31', '33', '488', '38'].map(catalogued);
  const WRIGHTS_ROAD = place('Wrights Rd after Ardley Ave, Kellyville', -33.714906, 150.970669);
  const CENTRAL = place('Central Station', -33.884024, 151.206203, 'stop');

  it('tries Seven Hills from Kellyville, and lists the bus car park it did not try with an estimate', async () => {
    const response = await planTrip(
      request({ origin: WRIGHTS_ROAD, destination: CENTRAL }),
      deps({ carParks: fakeCarParks(new Map(), AROUND_KELLYVILLE) }),
    );
    const outcomeOf = (id: string) => response.checkedCarParks.find((carPark) => carPark.id === id);

    expect(outcomeOf('488')).toMatchObject({ outcome: 'used', stationName: 'Seven Hills Station' });
    expect(outcomeOf('32')).toMatchObject({ outcome: 'used' });
    expect(outcomeOf('29')).toMatchObject({ outcome: 'used' });
    expect(outcomeOf('38')).toMatchObject({
      outcome: 'not-tried',
      stationName: 'North Rocks Park&Ride stop',
    });
    expect(outcomeOf('38')?.estimatedMinutes).toBeGreaterThan(outcomeOf('32')!.estimatedMinutes!);
    expect(response.checkedCarParks).toHaveLength(AROUND_KELLYVILLE.length);
    for (const carPark of response.checkedCarParks) {
      expect(carPark.estimatedMinutes).toBeGreaterThan(0);
    }
  });

  it('reports a used car park with the time of its own option', async () => {
    const response = await planTrip(
      request({ origin: WRIGHTS_ROAD, destination: CENTRAL }),
      deps({ carParks: fakeCarParks(new Map(), AROUND_KELLYVILLE) }),
    );
    const sevenHills = response.itineraries.find((it) => it.parking?.carPark.id === '488')!;

    expect(response.checkedCarParks.find((carPark) => carPark.id === '488')?.estimatedMinutes).toBe(
      Math.round(sevenHills.durationSeconds / 60),
    );
  });

  it('asks the drive-time provider about every car park within the driving limit, in one go', async () => {
    const driving = fakeDriving();
    const calls: number[] = [];
    const counting: DrivingProvider = {
      ...driving,
      estimateDrives: async (origin, destinations, time, signal) => {
        calls.push(destinations.length);
        return driving.estimateDrives(origin, destinations, time, signal);
      },
    };
    await planTrip(
      request({ origin: WRIGHTS_ROAD, destination: CENTRAL }),
      deps({ driving: counting, carParks: fakeCarParks(new Map(), AROUND_KELLYVILLE) }),
    );

    expect(calls).toEqual([AROUND_KELLYVILLE.length]);
  });
});
