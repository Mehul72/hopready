import { type Coordinate, DEFAULT_PREFERENCES, type PlanRequest } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import * as Location from 'expo-location';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import CarTab from '@/app/(tabs)/car';
import SavedTab from '@/app/(tabs)/saved';
import SettingsTab from '@/app/(tabs)/settings';
import TabsLayout from '@/app/(tabs)/_layout';
import RootLayout from '@/app/_layout';
import MapRoute from '@/app/map';
import ItineraryRoute from '@/app/itinerary/[id]';
import ConfirmParkingRoute from '@/app/parked-car/confirm';
import CorrectParkingRoute from '@/app/parked-car/correct';

// Test support for this folder and the other trip, car, saved and settings features: the real
// root and tab layouts with these screens, and placeholders for the screens other features own.

function placeholder(name: string) {
  return function PlaceholderScreen() {
    return <Text>{name} screen</Text>;
  };
}

export const APP_ROUTES = {
  _layout: RootLayout,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': placeholder('Plan'),
  '(tabs)/car': CarTab,
  '(tabs)/saved': SavedTab,
  '(tabs)/settings': SettingsTab,
  results: placeholder('Results'),
  'itinerary/[id]': ItineraryRoute,
  'place-search': placeholder('Place search'),
  'trip-options': placeholder('Trip options'),
  'parked-car/confirm': ConfirmParkingRoute,
  'parked-car/correct': CorrectParkingRoute,
  'data-use': placeholder('Live data use'),
  map: MapRoute,
  welcome: placeholder('Welcome'),
};

export function renderApp(initialUrl: string) {
  return renderRouter(APP_ROUTES, { initialUrl });
}

// Tuesday 27 October 2026, 7.30 am in Sydney: a weekday morning in the demo timetable.
export const WEEKDAY_MORNING = new Date('2026-10-26T20:30:00.000Z');

// Freezes Date (and only Date) so the on-device demo planner and "updated 3 min ago" texts are
// deterministic. Timers stay real, so Testing Library's waiting still works.
export function freezeClockAt(instant: Date): void {
  jest.useFakeTimers({
    now: instant,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

// Rouse Hill to Chatswood, leaving at 7.35 am, by any means: the demo planner offers drive and
// park, drop-off and public transport options for it.
export function demoCommuteRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    origin: DEMO_PLACES.rouseHillHome,
    destination: DEMO_PLACES.chatswoodOffice,
    time: { type: 'depart', at: '2026-10-26T20:35:00.000Z' },
    access: { transit: true, drive: true, dropOff: true },
    preferences: { ...DEFAULT_PREFERENCES, excludedTransitModes: [] },
    trip: { kind: 'outbound' },
    ...overrides,
  };
}

function permission(granted: boolean, canAskAgain: boolean): Location.LocationPermissionResponse {
  return {
    granted,
    canAskAgain,
    status: granted ? Location.PermissionStatus.GRANTED : Location.PermissionStatus.DENIED,
    expires: 'never',
  };
}

// Location access is granted and the iPhone is at `coordinate`, with a street label from iOS.
// Spies are restored after each test (restoreMocks in jest.config.js).
export function grantLocationAt(
  coordinate: Coordinate,
  label: { name: string; city: string } = { name: '1 Example Street', city: 'Chatswood' },
): void {
  jest
    .spyOn(Location, 'requestForegroundPermissionsAsync')
    .mockResolvedValue(permission(true, true));
  jest.spyOn(Location, 'getForegroundPermissionsAsync').mockResolvedValue(permission(true, true));
  jest.spyOn(Location, 'hasServicesEnabledAsync').mockResolvedValue(true);
  jest.spyOn(Location, 'getCurrentPositionAsync').mockResolvedValue({
    coords: {
      latitude: coordinate.lat,
      longitude: coordinate.lon,
      altitude: null,
      accuracy: 20,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: WEEKDAY_MORNING.getTime(),
  });
  jest.spyOn(Location, 'reverseGeocodeAsync').mockResolvedValue([
    {
      name: label.name,
      city: label.city,
      district: null,
      streetNumber: null,
      street: null,
      region: null,
      subregion: null,
      country: null,
      postalCode: null,
      isoCountryCode: null,
      timezone: null,
      formattedAddress: null,
    },
  ]);
}

// Like grantLocationAt, but the position only arrives when `release` is called, to test what
// happens when a person does something else while the phone is still finding them.
export function holdLocationAt(coordinate: Coordinate): { release: () => Promise<void> } {
  grantLocationAt(coordinate);
  let deliver: (() => void) | null = null;
  const arrived = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  const position = {
    coords: {
      latitude: coordinate.lat,
      longitude: coordinate.lon,
      altitude: null,
      accuracy: 20,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: WEEKDAY_MORNING.getTime(),
  };
  jest.spyOn(Location, 'getCurrentPositionAsync').mockImplementation(async () => {
    await arrived;
    return position;
  });
  return {
    release: async () => {
      deliver?.();
      await arrived;
    },
  };
}

export function denyLocation(canAskAgain: boolean): void {
  jest
    .spyOn(Location, 'requestForegroundPermissionsAsync')
    .mockResolvedValue(permission(false, canAskAgain));
}
