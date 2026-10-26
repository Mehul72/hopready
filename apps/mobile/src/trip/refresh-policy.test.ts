import {
  addMinutes,
  buildItinerary,
  type Fare,
  type Itinerary,
  type Leg,
  planRequestSchema,
  type TransitLeg,
} from '@hopready/core';

import type { ActiveTrip } from '@/storage';
import {
  metroThenBusItinerary,
  parkAndRideItinerary,
  place,
  PLACES,
  planRequest,
  transitItinerary,
} from '@/test-support/trips';

import { joinAlternative, matchItinerary, matchRestOfTrip } from './itinerary-match';
import {
  manualRefreshAvailability,
  partToCheck,
  refreshableRequest,
  restOfTripRequest,
  shouldRefreshActiveTripOnResume,
  withFollowedCarParkOrStation,
} from './refresh-policy';

const NOW = new Date('2026-10-26T20:55:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

// A lift to Tallawong Station, then the metro to Chatswood.
function dropOffItinerary(departAt: string): Itinerary {
  const droppedAt = addMinutes(departAt, 6);
  const readyAt = addMinutes(droppedAt, 2);
  // transitItinerary walks 10 min to the station first, so its metro boards as the drop-off ends.
  const [, ...metroOnwards] = transitItinerary({ departAt: addMinutes(readyAt, -10) }).legs;
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
      ...metroOnwards,
    ],
  });
}

function activeTrip(overrides: Partial<ActiveTrip> = {}): ActiveTrip {
  return {
    request: planRequest(),
    itinerary: transitItinerary({ departAt: addMinutes(NOW, 20) }),
    plannedAt: secondsAgo(120),
    mode: 'live',
    ...overrides,
  };
}

describe('manual refresh', () => {
  it('is allowed when nothing has been planned yet', () => {
    expect(manualRefreshAvailability(null, NOW)).toEqual({ allowed: true });
  });

  it('waits until 30 seconds after the last results arrived', () => {
    expect(manualRefreshAvailability(secondsAgo(10), NOW)).toEqual({
      allowed: false,
      retryInSeconds: 20,
    });
    expect(manualRefreshAvailability(secondsAgo(29), NOW)).toEqual({
      allowed: false,
      retryInSeconds: 1,
    });
    expect(manualRefreshAvailability(secondsAgo(30), NOW)).toEqual({ allowed: true });
  });

  it('is allowed after the clock was set backwards, rather than blocking for hours', () => {
    expect(manualRefreshAvailability(addMinutes(NOW, 90), NOW)).toEqual({ allowed: true });
  });
});

describe('refresh on resume', () => {
  it('refreshes an active trip planned more than 60 seconds ago that has not started', () => {
    expect(shouldRefreshActiveTripOnResume(activeTrip(), NOW, 'live')).toBe(true);
  });

  it('does nothing without an active trip', () => {
    expect(shouldRefreshActiveTripOnResume(null, NOW, 'live')).toBe(false);
  });

  it('leaves a trip planned in the last 60 seconds alone', () => {
    expect(
      shouldRefreshActiveTripOnResume(activeTrip({ plannedAt: secondsAgo(60) }), NOW, 'live'),
    ).toBe(false);
    expect(
      shouldRefreshActiveTripOnResume(activeTrip({ plannedAt: secondsAgo(61) }), NOW, 'live'),
    ).toBe(true);
  });

  it('never refreshes a demo trip with live data, or a live trip with demo data', () => {
    expect(shouldRefreshActiveTripOnResume(activeTrip({ mode: 'demo' }), NOW, 'live')).toBe(false);
    expect(shouldRefreshActiveTripOnResume(activeTrip({ mode: 'live' }), NOW, 'demo')).toBe(false);
  });

  it('checks the rest of a trip that has started, from the service that has not left', () => {
    // Five minutes into the walk to the station, with the metro still to come.
    const started = activeTrip({ itinerary: transitItinerary({ departAt: addMinutes(NOW, -5) }) });
    expect(shouldRefreshActiveTripOnResume(started, NOW, 'live')).toBe(true);
    expect(partToCheck(started, NOW, 'live')).toEqual({
      kind: 'rest-of-trip',
      legIndex: 1,
      leg: started.itinerary.legs[1],
    });
  });

  it('has nothing left to check once every service has left', () => {
    const onTheMetro = activeTrip({
      itinerary: transitItinerary({ departAt: addMinutes(NOW, -15) }),
    });
    expect(partToCheck(onTheMetro, NOW, 'live')).toBeNull();
    expect(shouldRefreshActiveTripOnResume(onTheMetro, NOW, 'live')).toBe(false);
  });

  it('counts a newer check that left the trip as it was', () => {
    expect(shouldRefreshActiveTripOnResume(activeTrip(), NOW, 'live', secondsAgo(30))).toBe(false);
    expect(shouldRefreshActiveTripOnResume(activeTrip(), NOW, 'live', secondsAgo(61))).toBe(true);
  });
});

describe('restOfTripRequest', () => {
  const metro = parkAndRideItinerary({ departAt: NOW.toISOString() }).legs.find(
    (leg): leg is TransitLeg => leg.kind === 'transit',
  )!;
  const out = planRequest({
    preferredCarParkId: '26',
    preferredStop: PLACES.tallawongStation,
    savedParkingSpots: [
      { id: 'spot', name: 'Work', coordinate: PLACES.chatswoodOffice.coordinate },
    ],
  });

  it('plans from the stop of the next service, when it leaves, by public transport only', () => {
    const rest = restOfTripRequest(out, metro, NOW);
    expect(rest).toEqual({
      origin: PLACES.tallawongStation,
      destination: out.destination,
      time: { type: 'depart', at: metro.start },
      access: { transit: true, drive: false, dropOff: false },
      preferences: out.preferences,
      trip: { kind: 'outbound' },
    });
    // The same schema the API checks every plan request against.
    expect(planRequestSchema.safeParse(rest).success).toBe(true);
  });

  it('asks from the start of the minute the service leaves, so the service itself is found', () => {
    const atHalfPast = '2026-10-26T21:12:30.000Z';
    const leg = { ...metro, start: atHalfPast, scheduledStart: atHalfPast };
    expect(restOfTripRequest(out, leg, NOW).time).toEqual({
      type: 'depart',
      at: '2026-10-26T21:12:00.000Z',
    });
  });

  it('asks from the timetabled time of a service that was late, in case it made up time', () => {
    const late = { ...metro, start: addMinutes(metro.scheduledStart, 3) };
    expect(restOfTripRequest(out, late, NOW).time.at).toBe(metro.scheduledStart);
    const early = { ...metro, start: addMinutes(metro.scheduledStart, -1) };
    expect(restOfTripRequest(out, early, NOW).time.at).toBe(early.start);
  });

  it('never asks for a time that has passed', () => {
    // Timetabled two minutes ago, and three minutes late at the last check.
    const late = {
      ...metro,
      scheduledStart: addMinutes(NOW, -2),
      start: addMinutes(NOW, 1),
    };
    expect(restOfTripRequest(out, late, NOW).time.at).toBe(NOW.toISOString());
  });

  it('keeps a trip home going back through the car', () => {
    const home = planRequest({
      origin: PLACES.chatswoodOffice,
      destination: PLACES.rouseHillHome,
      trip: {
        kind: 'return-via-car',
        parkedCar: {
          location: PLACES.tallawongCarPark,
          carParkId: '26',
          confirmedAt: secondsAgo(600),
        },
      },
    });
    expect(restOfTripRequest(home, metro, NOW)).toMatchObject({
      origin: PLACES.tallawongStation,
      destination: PLACES.rouseHillHome,
      access: home.access,
      trip: home.trip,
    });
  });
});

describe('refreshableRequest', () => {
  it('moves a "leave at" time that has passed up to now', () => {
    const request = planRequest({ time: { type: 'depart', at: addMinutes(NOW, -10) } });
    expect(refreshableRequest(request, NOW).time).toEqual({
      type: 'depart',
      at: NOW.toISOString(),
    });
  });

  it('keeps a future "leave at" time and every "arrive by" time', () => {
    const later = planRequest({ time: { type: 'depart', at: addMinutes(NOW, 30) } });
    const arriveBy = planRequest({ time: { type: 'arrive', at: addMinutes(NOW, -10) } });
    expect(refreshableRequest(later, NOW)).toBe(later);
    expect(refreshableRequest(arriveBy, NOW)).toBe(arriveBy);
  });
});

describe('withFollowedCarParkOrStation', () => {
  const departAt = addMinutes(NOW, 20);

  it('asks for the car park of a followed drive and park trip, in place of any other', () => {
    const request = planRequest({ preferredCarParkId: '29' });
    expect(withFollowedCarParkOrStation(request, parkAndRideItinerary({ departAt }))).toEqual({
      ...request,
      preferredCarParkId: '26',
    });
  });

  it('asks for the station of a followed drop-off', () => {
    const request = planRequest({ access: { transit: true, drive: true, dropOff: true } });
    expect(withFollowedCarParkOrStation(request, dropOffItinerary(departAt))).toEqual({
      ...request,
      preferredStop: PLACES.tallawongStation,
    });
  });

  it('leaves the request alone for a trip with no car park or station of its own', () => {
    const request = planRequest();
    expect(withFollowedCarParkOrStation(request, transitItinerary({ departAt }))).toBe(request);
  });
});

describe('matchItinerary', () => {
  const chosen = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' });

  it('finds the very same trip, with its updated times', () => {
    const live = parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z', realtime: true });
    expect(live.id).toBe(chosen.id);
    expect(
      matchItinerary(chosen, [transitItinerary({ departAt: NOW.toISOString() }), live]),
    ).toEqual({
      itinerary: live,
      exact: true,
    });
  });

  it('falls back to the same strategy, car park and first service on the closest run', () => {
    const muchLater = parkAndRideItinerary({ departAt: '2026-10-26T22:00:00.000Z' });
    const nextRun = parkAndRideItinerary({ departAt: '2026-10-26T21:10:00.000Z' });
    const otherService = parkAndRideItinerary({
      departAt: '2026-10-26T21:05:00.000Z',
      service: 'T1',
    });
    expect(matchItinerary(chosen, [muchLater, otherService, nextRun])).toEqual({
      itinerary: nextRun,
      exact: false,
    });
  });

  it('reports nothing when the chosen option is no longer offered', () => {
    expect(matchItinerary(chosen, [transitItinerary({ departAt: NOW.toISOString() })])).toBeNull();
  });

  it('keeps following the same runs when a delay adds a wait between them', () => {
    const tight = withBusLeaving(metroThenBusItinerary({ departAt: NOW.toISOString() }), 0.5);
    const busLate = withBusLeaving(tight, 0.5, 2);
    // The wait before the late bus changes the fingerprint, but it is the same trip.
    expect(busLate.id).not.toBe(tight.id);
    expect(matchItinerary(tight, [busLate])).toEqual({
      itinerary: { ...busLate, id: tight.id },
      exact: true,
    });
  });

  it('keeps to the drop-off station when the chosen run is gone', () => {
    const chosenDropOff = dropOffItinerary('2026-10-26T21:00:00.000Z');
    const sameStationLater = dropOffItinerary('2026-10-26T21:04:00.000Z');
    const otherStationSooner = atStation(dropOffItinerary('2026-10-26T21:02:00.000Z'), KELLYVILLE);
    expect(matchItinerary(chosenDropOff, [otherStationSooner, sameStationLater])).toEqual({
      itinerary: sameStationLater,
      exact: false,
    });
  });
});

const KELLYVILLE = place('Kellyville Station', -33.7136, 150.9353, 'stop', { stopId: '2155495' });

// The same trip with the drop-off moved to another station on the line.
function atStation(itinerary: Itinerary, station: typeof KELLYVILLE): Itinerary {
  return buildItinerary({
    strategy: itinerary.strategy,
    legs: itinerary.legs.map((leg) => {
      if (leg.kind === 'ride') return { ...leg, to: station };
      if (leg.kind === 'drop-off') return { ...leg, from: station, to: station };
      return leg;
    }),
  });
}

// The metro then the bus, with the bus leaving `gapMinutes` after the metro arrives as timetabled,
// and running `lateMinutes` behind that.
function withBusLeaving(itinerary: Itinerary, gapMinutes: number, lateMinutes = 0): Itinerary {
  const metro = itinerary.legs.find((leg): leg is TransitLeg => leg.kind === 'transit');
  if (!metro) throw new Error('The trip has no metro');
  const legs = itinerary.legs.filter((leg) => leg.kind !== 'wait');
  return buildItinerary({
    strategy: itinerary.strategy,
    legs: legs.map((leg) => {
      if (leg.kind !== 'transit' || leg === metro) return leg;
      const scheduledStart = addMinutes(metro.end, gapMinutes);
      const start = addMinutes(scheduledStart, lateMinutes);
      return { ...leg, scheduledStart, start, end: addMinutes(start, 10) };
    }),
  });
}

// Drive and park done, the metro still to come.
const started = parkAndRideItinerary({ departAt: '2026-10-26T20:50:00.000Z' });
const metroIndex = started.legs.findIndex((leg) => leg.kind === 'transit');

// What planning from the station offers: the metro and the walk after it, `lateMinutes` late.
function restFromStation(trip: Itinerary, lateMinutes = 0, fare?: Fare): Itinerary {
  const shift = (leg: Leg): Leg => ({
    ...leg,
    start: addMinutes(leg.start, lateMinutes),
    end: addMinutes(leg.end, lateMinutes),
  });
  const fromMetro = trip.legs.slice(trip.legs.findIndex((leg) => leg.kind === 'transit'));
  return buildItinerary({ strategy: 'transit-only', legs: fromMetro.map(shift), fare });
}

describe('matchRestOfTrip', () => {
  it('joins the latest times of the same runs to the part already travelled', () => {
    const running = restFromStation(started, 3);
    const nextRun = restFromStation(parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' }));

    const match = matchRestOfTrip(started, metroIndex, [nextRun, running]);

    expect(match?.exact).toBe(true);
    // The same trip, so it keeps its id, its start and its car park.
    expect(match?.itinerary).toMatchObject({
      id: started.id,
      strategy: 'park-and-ride',
      departAt: started.departAt,
      arriveAt: addMinutes(started.arriveAt, 3),
      parking: started.parking,
    });
    // Waiting three minutes for the late metro shows as a wait.
    expect(match?.itinerary.legs.map((leg) => leg.kind)).toEqual([
      'drive',
      'park',
      'walk',
      'wait',
      'transit',
      'walk',
    ]);
  });

  it('finds nothing when a service still to come is not offered on its run', () => {
    const nextRun = restFromStation(parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' }));
    expect(matchRestOfTrip(started, metroIndex, [nextRun])).toBeNull();
    expect(matchRestOfTrip(started, metroIndex, [])).toBeNull();
  });
});

describe('joinAlternative', () => {
  const FARE: Fare = {
    status: 'known',
    adultCents: 520,
    currency: 'AUD',
    source: 'tfnsw-trip-planner',
  };

  it('keeps the drive, the car park and the strategy, then follows the other option', () => {
    const nextRun = restFromStation(
      parkAndRideItinerary({ departAt: '2026-10-26T21:00:00.000Z' }),
      0,
      FARE,
    );

    const joined = joinAlternative(started, metroIndex, nextRun);

    expect(joined).toMatchObject({
      strategy: 'park-and-ride',
      parking: started.parking,
      departAt: started.departAt,
      arriveAt: nextRun.arriveAt,
      fare: FARE,
    });
    expect(joined.legs.slice(0, metroIndex)).toEqual(started.legs.slice(0, metroIndex));
    // Ten minutes at the station until the later metro.
    expect(joined.legs.map((leg) => leg.kind)).toEqual([
      'drive',
      'park',
      'walk',
      'wait',
      'transit',
      'walk',
    ]);
    // Another trip, so it has its own id.
    expect(joined.id).not.toBe(started.id);
  });

  it('leaves the fare unknown once a service of the trip was ridden', () => {
    // Off the metro, with only the walk to the office left.
    const walkIndex = started.legs.length - 1;
    const walkOn = buildItinerary({
      strategy: 'transit-only',
      legs: started.legs.slice(walkIndex),
      fare: FARE,
    });
    expect(joinAlternative(started, walkIndex, walkOn).fare).toEqual({ status: 'unknown' });
  });
});
