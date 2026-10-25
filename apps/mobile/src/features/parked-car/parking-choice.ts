import {
  type Coordinate,
  formatSydneyTime,
  haversineMetres,
  type Itinerary,
  type ParkedCar,
  type Place,
  type SavedParkingSpot,
  sydneyDateKey,
} from '@hopready/core';

import { CURRENT_LOCATION_LABEL } from '@/location';
import type { ActiveTrip, ParkedCarState } from '@/storage';

import { distance, formatSydneyDay, type Wording } from '../itinerary/trip-text';

// Where the person says the car is. Only these, confirmed by the person, become the parked car;
// a car park suggested by a trip is never stored on its own.
export type ParkingChoice =
  | {
      kind: 'car-park';
      carParkId: string;
      name: string;
      coordinate: Coordinate;
      // Offered by the trip; shown as a suggestion, not as proof of where the car is.
      suggested: boolean;
    }
  | { kind: 'current-location'; place: Place }
  | { kind: 'saved-spot'; spot: SavedParkingSpot }
  | { kind: 'pin'; name: string; coordinate: Coordinate };

export const PINNED_LOCATION_NAME = 'Pinned location';

// The documented car park a trip planned to use. Spots the person saved are listed separately.
export interface SuggestedCarPark {
  carParkId: string;
  name: string;
  coordinate: Coordinate;
}

// A followed trip hints where the car is only on the day it runs. One followed last week would
// suggest a car park, and start the pin, far from where the car is today.
export function itineraryFollowedToday(
  activeTrip: ActiveTrip | null,
  nowMs: number,
): Itinerary | null {
  if (!activeTrip) return null;
  const today = sydneyDateKey(new Date(nowMs));
  const { departAt, arriveAt } = activeTrip.itinerary;
  // Either end counts, for a trip that runs past midnight.
  return sydneyDateKey(departAt) === today || sydneyDateKey(arriveAt) === today
    ? activeTrip.itinerary
    : null;
}

export function suggestedCarParkOf(
  itinerary: Itinerary | null | undefined,
): SuggestedCarPark | null {
  const carPark = itinerary?.parking?.carPark;
  if (!carPark || carPark.kind !== 'transport-park-and-ride') return null;
  return { carParkId: carPark.id, name: carPark.name, coordinate: carPark.coordinate };
}

// A named place a pin starts from, so where the pin is can be put in words.
export interface PinStart {
  name: string;
  coordinate: Coordinate;
}

// Where the trip expected the car to be left: its Park&Ride car park, or else where its drive ends.
export function pinStartOf(itinerary: Itinerary | null | undefined): PinStart | null {
  const carPark = suggestedCarParkOf(itinerary);
  if (carPark) return { name: carPark.name, coordinate: carPark.coordinate };
  const drive = itinerary?.legs.find((leg) => leg.kind === 'drive');
  return drive ? { name: drive.to.name, coordinate: drive.to.coordinate } : null;
}

const COMPASS_POINTS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;

// distance() rounds to 10 m, so a pin nearer than this would read as "0 m" away.
const AT_PLACE_METRES = 5;

// Which way `to` lies from `from`, to the nearest of eight compass points. Over the distances a
// pin is moved, treating the ground as flat is accurate enough for that.
function compassPoint(from: Coordinate, to: Coordinate): string {
  const north = to.lat - from.lat;
  const east = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  const eighths = Math.round((Math.atan2(east, north) / Math.PI) * 4);
  return COMPASS_POINTS[(eighths + 8) % 8] ?? 'north';
}

// Where the pin is, in words, for people who cannot see the map: "Pin 20 m west of Tallawong P1".
export function pinPosition(pin: Coordinate, from: PinStart): Wording {
  const metres = haversineMetres(from.coordinate, pin);
  if (metres < AT_PLACE_METRES) {
    const at = `Pin at ${from.name}`;
    return { text: at, spoken: at };
  }
  const away = distance(metres);
  const direction = compassPoint(from.coordinate, pin);
  return {
    text: `Pin ${away.text} ${direction} of ${from.name}`,
    spoken: `Pin ${away.spoken} ${direction} of ${from.name}`,
  };
}

export interface ParkedCarRecord {
  parkedCar: ParkedCar;
  carParkName: string | null;
}

export function choiceCoordinate(choice: ParkingChoice): Coordinate {
  switch (choice.kind) {
    case 'car-park':
    case 'pin':
      return choice.coordinate;
    case 'current-location':
      return choice.place.coordinate;
    case 'saved-spot':
      return choice.spot.coordinate;
  }
}

// Identifies a choice for list selection, so a re-render with equal data stays selected.
export function choiceKey(choice: ParkingChoice): string {
  switch (choice.kind) {
    case 'car-park':
      return `car-park:${choice.carParkId}`;
    case 'current-location':
      return 'current-location';
    case 'saved-spot':
      return `saved-spot:${choice.spot.id}`;
    case 'pin':
      return 'pin';
  }
}

// A reverse-geocoded address is only roughly where the car is, so it is labelled "Near ...".
function nameForCurrentLocation(place: Place): string {
  return place.name === CURRENT_LOCATION_LABEL ? 'Your parked car' : `Near ${place.name}`;
}

export function parkedCarFrom(choice: ParkingChoice, confirmedAt: string): ParkedCarRecord {
  switch (choice.kind) {
    case 'car-park':
      return {
        parkedCar: {
          location: {
            name: choice.name,
            coordinate: choice.coordinate,
            kind: 'car-park',
            carParkId: choice.carParkId,
          },
          carParkId: choice.carParkId,
          confirmedAt,
        },
        carParkName: choice.name,
      };
    case 'current-location':
      return {
        parkedCar: {
          location: {
            name: nameForCurrentLocation(choice.place).slice(0, 200),
            coordinate: choice.place.coordinate,
            kind: 'parked-car',
          },
          carParkId: null,
          confirmedAt,
        },
        carParkName: null,
      };
    case 'saved-spot':
      return {
        parkedCar: {
          location: {
            name: choice.spot.name,
            coordinate: choice.spot.coordinate,
            kind: 'saved-parking',
          },
          carParkId: null,
          confirmedAt,
        },
        carParkName: choice.spot.name,
      };
    case 'pin':
      return {
        parkedCar: {
          location: { name: choice.name, coordinate: choice.coordinate, kind: 'parked-car' },
          carParkId: null,
          confirmedAt,
        },
        carParkName: null,
      };
  }
}

export function parkedCarName(state: Extract<ParkedCarState, { status: 'parked' }>): string {
  return state.carParkName ?? state.parkedCar.location.name;
}

// "7:58 am today" or "Sat 24 Oct at 7:58 am", in Sydney time.
export function describeWhen(instant: string, nowMs: number): string {
  const time = formatSydneyTime(instant);
  return sydneyDateKey(instant) === sydneyDateKey(new Date(nowMs))
    ? `${time} today`
    : `${formatSydneyDay(instant)} at ${time}`;
}
