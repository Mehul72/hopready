import {
  findCataloguedCarPark,
  fromSydneyWallClock,
  sydneyWallClock,
  type Place,
} from '@hopready/core';

// Places and times shared by the live test and the recording script, so both ask TfNSW the same
// questions. Places come from the documented Park&Ride catalogue, never from guesses.

const MS_PER_DAY = 86_400_000;

export function tallawongP1Entrance(): Place {
  const carPark = findCataloguedCarPark('26');
  if (!carPark?.entrance) throw new Error('Facility 26 (Tallawong P1) has no catalogued entrance');
  return {
    name: carPark.name,
    coordinate: carPark.entrance,
    kind: 'car-park',
    carParkId: carPark.facilityId,
  };
}

export function kellyvilleStation(): Place {
  const carPark = findCataloguedCarPark('29');
  if (!carPark) throw new Error('Facility 29 (Kellyville north) is missing from the catalogue');
  const { name, stopId, coordinate } = carPark.station;
  return { name, coordinate, kind: 'stop', stopId };
}

// The next Monday to Friday after the Sydney date of `now`, at the given Sydney wall-clock time.
export function nextWeekdayAt(now: Date, hour: number, minute: number): string {
  const today = sydneyWallClock(now);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const weekday = tomorrow.getUTCDay();
  const daysToSkip = weekday === 6 ? 2 : weekday === 0 ? 1 : 0;
  const day = new Date(tomorrow.getTime() + daysToSkip * MS_PER_DAY);
  return fromSydneyWallClock({
    year: day.getUTCFullYear(),
    month: day.getUTCMonth() + 1,
    day: day.getUTCDate(),
    hour,
    minute,
  }).toISOString();
}
