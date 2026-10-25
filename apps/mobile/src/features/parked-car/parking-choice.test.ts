import type { Itinerary } from '@hopready/core';

import type { ActiveTrip } from '@/storage';
import { parkAndRideItinerary, planRequest, PLACES } from '@/test-support/trips';

import { itineraryFollowedToday, pinPosition } from './parking-choice';
import { nudge } from './pin-drop-map';

// Tuesday 27 October 2026, 7.30 am in Sydney.
const TUESDAY_MORNING_MS = Date.parse('2026-10-26T20:30:00.000Z');

function followed(itinerary: Itinerary): ActiveTrip {
  return { request: planRequest(), itinerary, plannedAt: itinerary.departAt, mode: 'demo' };
}

describe('itineraryFollowedToday', () => {
  it('is the followed trip when it runs today in Sydney', () => {
    const trip = followed(parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }));
    expect(itineraryFollowedToday(trip, TUESDAY_MORNING_MS)).toBe(trip.itinerary);
  });

  it('is nothing for a trip followed on another day', () => {
    const trip = followed(parkAndRideItinerary({ departAt: '2026-10-22T20:40:00.000Z' }));
    expect(itineraryFollowedToday(trip, TUESDAY_MORNING_MS)).toBeNull();
  });

  it('counts a trip that left before midnight and arrives today', () => {
    // Leaves at 11.30 pm on Monday and arrives just after midnight.
    const trip = followed(parkAndRideItinerary({ departAt: '2026-10-26T12:30:00.000Z' }));
    expect(itineraryFollowedToday(trip, TUESDAY_MORNING_MS)).toBe(trip.itinerary);
  });

  it('is nothing when no trip is followed', () => {
    expect(itineraryFollowedToday(null, TUESDAY_MORNING_MS)).toBeNull();
  });
});

describe('pinPosition', () => {
  const carPark = { name: 'Tallawong P1', coordinate: PLACES.tallawongCarPark.coordinate };

  it('puts an unmoved pin at the place', () => {
    expect(pinPosition(carPark.coordinate, carPark)).toEqual({
      text: 'Pin at Tallawong P1',
      spoken: 'Pin at Tallawong P1',
    });
  });

  it.each([
    [['north'], 'north'],
    [['north', 'east'], 'north-east'],
    [['east'], 'east'],
    [['south', 'east'], 'south-east'],
    [['south'], 'south'],
    [['south', 'west'], 'south-west'],
    [['west'], 'west'],
    [['north', 'west'], 'north-west'],
  ] as const)('names the direction after moves %j', (moves, direction) => {
    const pin = moves.reduce((point, move) => nudge(point, move, 30), carPark.coordinate);
    expect(pinPosition(pin, carPark).text).toMatch(
      new RegExp(`^Pin \\d+ m ${direction} of Tallawong P1$`),
    );
  });

  it('gives the distance in words VoiceOver reads in full', () => {
    expect(pinPosition(nudge(carPark.coordinate, 'west', 50), carPark)).toEqual({
      text: 'Pin 50 m west of Tallawong P1',
      spoken: 'Pin 50 metres west of Tallawong P1',
    });
    expect(pinPosition(nudge(carPark.coordinate, 'south', 1_240), carPark)).toEqual({
      text: 'Pin 1.2 km south of Tallawong P1',
      spoken: 'Pin 1.2 kilometres south of Tallawong P1',
    });
  });
});
