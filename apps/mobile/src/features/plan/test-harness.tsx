import {
  type LocationObject,
  type LocationPermissionResponse,
  PermissionStatus,
} from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { renderRouter, testRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import TabsLayout from '@/app/(tabs)/_layout';
import PlanRoute from '@/app/(tabs)/index';
import RootLayout from '@/app/_layout';
import MapRoute from '@/app/map';
import PlaceSearchRoute from '@/app/place-search';
import CarParksConsideredRoute from '@/app/car-parks-considered';
import ResultsRoute from '@/app/results';
import TripOptionsRoute from '@/app/trip-options';

// Test support for the plan and results flows: the real layouts and these features' routes,
// with stand-ins for screens other features own. Only tests import this file.

// Tuesday 27 October 2026, 7.30 am in Sydney: a weekday morning in the demo timetable.
export const TUESDAY_0730 = new Date('2026-10-26T20:30:00.000Z');

const TIMERS_KEPT_REAL = [
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
] as const;

// Stops the clock at a fixed moment, so the demo timetable gives the same trips on every run,
// while timers keep running in real time for debouncing, navigation and the query client.
export function freezeClockAt(at: Date): void {
  jest.useFakeTimers({ now: at, doNotFake: [...TIMERS_KEPT_REAL] });
}

const MAX_TEST_DRIFT_MS = 5_000;

const PERMISSION_STATUSES = {
  granted: PermissionStatus.GRANTED,
  denied: PermissionStatus.DENIED,
  undetermined: PermissionStatus.UNDETERMINED,
} as const;

// An answer for the expo-location permission mocks.
export function locationPermission(
  status: keyof typeof PERMISSION_STATUSES,
  canAskAgain = true,
): LocationPermissionResponse {
  return {
    status: PERMISSION_STATUSES[status],
    granted: status === 'granted',
    canAskAgain,
    expires: 'never',
  };
}

// A position for the expo-location getCurrentPositionAsync mock.
export function positionAt(
  latitude: number,
  longitude: number,
  accuracyMetres = 20,
): LocationObject {
  return {
    coords: {
      latitude,
      longitude,
      altitude: null,
      accuracy: accuracyMetres,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: TUESDAY_0730.getTime(),
  };
}

// userEvent moves the stopped clock on by each press's duration, so "now" in a test is the start
// time plus a few hundred milliseconds. This says whether an instant is within that drift.
export function isMomentsAfter(at: string | undefined, start: Date): boolean {
  if (at === undefined) return false;
  const elapsedMs = Date.parse(at) - start.getTime();
  return elapsedMs >= 0 && elapsedMs < MAX_TEST_DRIFT_MS;
}

function placeholder(name: string) {
  return function PlaceholderScreen() {
    return <Text>{name} screen</Text>;
  };
}

function ItineraryPlaceholder() {
  const { id } = useLocalSearchParams();
  return <Text>{`Itinerary ${String(id)}`}</Text>;
}

export const APP_ROUTES = {
  _layout: RootLayout,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': PlanRoute,
  '(tabs)/car': placeholder('Car'),
  '(tabs)/saved': placeholder('Saved'),
  '(tabs)/settings': placeholder('Settings'),
  results: ResultsRoute,
  'itinerary/[id]': ItineraryPlaceholder,
  'place-search': PlaceSearchRoute,
  'trip-options': TripOptionsRoute,
  'parked-car/confirm': placeholder('Confirm parking'),
  'parked-car/correct': placeholder('Correct parking'),
  'data-use': placeholder('Data use'),
  map: MapRoute,
  'car-parks-considered': CarParksConsideredRoute,
  welcome: placeholder('Welcome'),
};

// Opens the Plan tab, then the given screen on top of it, the way a person gets there.
export async function renderApp(path = '/') {
  const result = await renderRouter(APP_ROUTES, { initialUrl: '/' });
  if (path !== '/') await testRouter.push(path);
  return result;
}
