import {
  type Coordinate,
  formatSydneyTime,
  type Itinerary,
  type ParkedCar,
  type Place,
  type SavedParkingSpot,
  sydneyDateKey,
} from '@hopready/core';

import { CURRENT_LOCATION_LABEL } from '@/location';
import type { ParkedCarState } from '@/storage';

import { formatSydneyDay } from '../itinerary/trip-text';

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

export function suggestedCarParkOf(
  itinerary: Itinerary | null | undefined,
): SuggestedCarPark | null {
  const carPark = itinerary?.parking?.carPark;
  if (!carPark || carPark.kind !== 'transport-park-and-ride') return null;
  return { carParkId: carPark.id, name: carPark.name, coordinate: carPark.coordinate };
}

// Where the trip's drive ends, which is where it expected the car to be left.
export function driveEndOf(itinerary: Itinerary | null | undefined): Coordinate | null {
  const drive = itinerary?.legs.find((leg) => leg.kind === 'drive');
  return drive?.to.coordinate ?? null;
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
