import type { Itinerary, Place } from '@hopready/core';

import { CURRENT_LOCATION_LABEL } from '@/location';
import type { ActiveTrip, ParkedCarState } from '@/storage';
import { parkAndRideItinerary, planRequest, PLACES } from '@/test-support/trips';

import { itineraryFollowedToday, pinOriginOf, pinPosition } from './parking-choice';
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

describe('pinOriginOf', () => {
  const street = { lat: -33.7143, lon: 150.9358 };

  function parkedAt(location: Place, carParkName: string | null) {
    return {
      status: 'parked',
      parkedCar: {
        location,
        carParkId: location.carParkId ?? null,
        confirmedAt: '2026-10-26T20:45:00.000Z',
      },
      carParkName,
    } satisfies ParkedCarState;
  }

  function hereAt(name: string) {
    return {
      kind: 'current-location',
      place: { name, coordinate: street, kind: 'current-location' },
    } as const;
  }

  // Where a pin 20 m north of the origin is said to be, and the name it is saved under.
  function nudgedFrom(origin: ReturnType<typeof pinOriginOf>) {
    return [pinPosition(nudge(origin.coordinate, 'north', 20), origin).text, origin.keptName];
  }

  it('names the car park or saved spot the car is saved at', () => {
    const atCarPark = parkedAt(PLACES.tallawongCarPark, 'Tallawong P1');
    expect(nudgedFrom(pinOriginOf(null, atCarPark))).toEqual([
      'Pin 20 m north of Tallawong P1',
      'Tallawong P1',
    ]);
    const spot = {
      name: 'Kerb on Example Road',
      coordinate: street,
      kind: 'saved-parking',
    } as const;
    expect(nudgedFrom(pinOriginOf(null, parkedAt(spot, spot.name)))).toEqual([
      'Pin 20 m north of Kerb on Example Road',
      'Kerb on Example Road',
    ]);
  });

  it('describes a car saved as a pin or an address by where it is saved', () => {
    const location = { name: 'Near 3 Example Lane, Kellyville', coordinate: street };
    const saved = parkedAt({ ...location, kind: 'parked-car' }, null);
    expect(nudgedFrom(pinOriginOf(null, saved))).toEqual([
      'Pin 20 m north of where your car is saved',
      'Near 3 Example Lane, Kellyville',
    ]);
  });

  it('names the current location by its address, and keeps it as only near there', () => {
    const saved = parkedAt(PLACES.tallawongCarPark, 'Tallawong P1');
    expect(nudgedFrom(pinOriginOf(hereAt('3 Example Lane, Kellyville'), saved))).toEqual([
      'Pin 20 m north of 3 Example Lane, Kellyville',
      'Near 3 Example Lane, Kellyville',
    ]);
    expect(nudgedFrom(pinOriginOf(hereAt(CURRENT_LOCATION_LABEL), saved))).toEqual([
      'Pin 20 m north of where you are',
      'Your parked car',
    ]);
  });
});
