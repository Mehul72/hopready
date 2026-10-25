import { addMinutes, buildItinerary, type Itinerary, type Leg, type Place } from '@hopready/core';

import { PLACES, parkAndRideItinerary, transitItinerary } from '@/test-support/trips';

import { defaultOrderFor, orderItineraries, ordersFor, selfDriveSeconds } from './itinerary-order';

const T0 = '2026-10-26T20:00:00.000Z';

function ride(from: Place, to: Place, start: string, minutes: number): Leg {
  return {
    id: `ride-${to.name}`,
    kind: 'ride',
    from,
    to,
    start,
    end: addMinutes(start, minutes),
    source: 'apple-maps',
    timing: 'estimated',
    distanceMetres: minutes * 600,
    trafficAware: true,
  };
}

function transit(from: Place, to: Place, start: string, minutes: number, name: string): Leg {
  const end = addMinutes(start, minutes);
  return {
    id: `transit-${name}-${start}`,
    kind: 'transit',
    from,
    to,
    start,
    end,
    source: 'tfnsw-trip-planner',
    timing: 'scheduled',
    mode: 'bus',
    service: { name, description: null, headsign: null, operator: null },
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

// Someone drives the traveller 20 minutes to the station, then they ride the metro.
function dropOffItinerary(departAt: string): Itinerary {
  const atStation = addMinutes(departAt, 20);
  return buildItinerary({
    strategy: 'drop-off',
    legs: [
      ride(PLACES.rouseHillHome, PLACES.tallawongStation, departAt, 20),
      transit(PLACES.tallawongStation, PLACES.chatswoodStation, atStation, 40, 'M1'),
    ],
  });
}

// Two buses with a change, arriving early.
function twoBusItinerary(departAt: string): Itinerary {
  const change = addMinutes(departAt, 20);
  return buildItinerary({
    strategy: 'transit-only',
    legs: [
      transit(PLACES.tallawongStation, PLACES.chatswoodStation, departAt, 20, '600'),
      transit(PLACES.chatswoodStation, PLACES.chatswoodOffice, addMinutes(change, 5), 10, '200'),
    ],
  });
}

describe('orderItineraries', () => {
  const transitLater = transitItinerary({ departAt: addMinutes(T0, 10) }); // arrives T0+65
  const parkAndRide = parkAndRideItinerary({ departAt: T0 }); // arrives T0+62, drives 6 min
  const dropOff = dropOffItinerary(T0); // arrives T0+60, a 20 minute lift
  const twoBuses = twoBusItinerary(T0); // arrives T0+35, one change
  const all = [transitLater, parkAndRide, dropOff, twoBuses];

  it('puts the earliest arrival first', () => {
    expect(orderItineraries(all, 'earliest-arrival')).toEqual([
      twoBuses,
      dropOff,
      parkAndRide,
      transitLater,
    ]);
  });

  it('breaks an arrival tie by the later departure, so less waiting comes first', () => {
    const early = transitItinerary({ departAt: T0, service: 'M1' });
    const sameArrivalLeavingLater = buildItinerary({
      strategy: 'transit-only',
      legs: early.legs.slice(1),
    });
    expect(orderItineraries([early, sameArrivalLeavingLater], 'earliest-arrival')).toEqual([
      sameArrivalLeavingLater,
      early,
    ]);
  });

  it('counts only time behind the wheel as driving, not a lift from someone else', () => {
    expect(selfDriveSeconds(dropOff)).toBe(0);
    expect(selfDriveSeconds(parkAndRide)).toBe(6 * 60);
    expect(orderItineraries(all, 'least-driving').at(-1)).toBe(parkAndRide);
  });

  it('keeps the planner order for ties, so equal options stay in their best order', () => {
    const ordered = orderItineraries(all, 'least-driving');
    expect(ordered.slice(0, 3)).toEqual([transitLater, dropOff, twoBuses]);
  });

  it('puts the fewest changes first', () => {
    expect(orderItineraries(all, 'fewest-changes').at(-1)).toBe(twoBuses);
  });

  it('puts the latest departure first for arrive-by trips', () => {
    expect(orderItineraries(all, 'leave-latest')[0]).toBe(transitLater);
  });

  it('does not change the list it was given', () => {
    const copy = [...all];
    orderItineraries(all, 'fewest-changes');
    expect(all).toEqual(copy);
  });
});

describe('available orders', () => {
  it('offers "Leave latest" only for arrive-by trips, and starts there', () => {
    expect(ordersFor('depart')).not.toContain('leave-latest');
    expect(ordersFor('arrive')).toContain('leave-latest');
    expect(defaultOrderFor('arrive')).toBe('leave-latest');
    expect(defaultOrderFor('depart')).toBe('earliest-arrival');
  });
});
