import type { ParkedCar, PlanRequest } from '@hopready/core';

import type { ParkedCarState } from '@/storage';
import { place, PLACES, planRequest } from '@/test-support/trips';

import { withCurrentCar } from './return-trip';

const PARKED_AT_TALLAWONG: ParkedCar = {
  location: PLACES.tallawongCarPark,
  carParkId: '26',
  confirmedAt: '2026-10-26T20:40:00.000Z',
};
// A correction moves the car and keeps when it was parked.
const CORRECTED: ParkedCar = {
  ...PARKED_AT_TALLAWONG,
  location: place('Pinned location', -33.6951, 150.9071),
  carParkId: null,
};

const parked = (parkedCar: ParkedCar): ParkedCarState => ({
  status: 'parked',
  parkedCar,
  carParkName: null,
});
const DROPPED_OFF: ParkedCarState = { status: 'dropped-off', at: '2026-10-26T20:40:00.000Z' };
const NO_CAR: ParkedCarState = { status: 'none' };

function tripHome(trip: PlanRequest['trip']): PlanRequest {
  return planRequest({
    origin: PLACES.chatswoodOffice,
    destination: PLACES.rouseHillHome,
    access:
      trip.kind === 'return-via-car'
        ? { transit: true, drive: true, dropOff: false }
        : { transit: true, drive: false, dropOff: false },
    trip,
  });
}

describe('withCurrentCar', () => {
  it('leaves a trip out as it is, whatever the car', () => {
    const out = planRequest();
    expect(withCurrentCar(out, NO_CAR)).toBe(out);
    expect(withCurrentCar(out, parked(PARKED_AT_TALLAWONG))).toBe(out);
  });

  it('takes a trip home through the corrected spot', () => {
    const home = tripHome({ kind: 'return-via-car', parkedCar: PARKED_AT_TALLAWONG });
    expect(withCurrentCar(home, parked(CORRECTED))).toEqual({
      ...home,
      trip: { kind: 'return-via-car', parkedCar: CORRECTED },
    });
  });

  it('gives up on a trip home through a car that was removed or never there', () => {
    const home = tripHome({ kind: 'return-via-car', parkedCar: PARKED_AT_TALLAWONG });
    expect(withCurrentCar(home, NO_CAR)).toBeNull();
    expect(withCurrentCar(home, DROPPED_OFF)).toBeNull();
  });

  it('gives up on a trip home without the car once a parked car is saved', () => {
    const home = tripHome({ kind: 'return-without-car' });
    expect(withCurrentCar(home, parked(PARKED_AT_TALLAWONG))).toBeNull();
    expect(withCurrentCar(home, DROPPED_OFF)).toEqual(home);
    expect(withCurrentCar(home, NO_CAR)).toEqual(home);
  });
});
