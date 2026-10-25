import { isWithinGreaterSydney, type Coordinate, type Place } from '@hopready/core';
import {
  Accuracy,
  getCurrentPositionAsync,
  getForegroundPermissionsAsync,
  hasServicesEnabledAsync,
  type LocationGeocodedAddress,
  requestForegroundPermissionsAsync,
  reverseGeocodeAsync,
} from 'expo-location';
import { Linking } from 'react-native';

export const CURRENT_LOCATION_LABEL = 'Current location';
export const POSITION_TIMEOUT_MS = 10_000;
// The label is a nicety; a slow geocoder must not hold up the trip.
export const REVERSE_GEOCODE_TIMEOUT_MS = 4_000;

export type CurrentPlaceResult =
  | { status: 'granted'; place: Place }
  // Offer manual entry; when canAskAgain is false, also offer openLocationSettings().
  | { status: 'denied'; canAskAgain: boolean }
  // HopReady only plans within Greater Sydney, so the position is not used.
  | { status: 'outside-coverage' }
  | { status: 'unavailable'; reason: 'services-disabled' | 'timeout' | 'position-failed' };

class TimedOutError extends Error {
  constructor() {
    super('Timed out');
    this.name = 'TimedOutError';
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string') return code;
  }
  return error instanceof Error ? error.name : 'unknown';
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOutError()), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// "12 Example St, Rouse Hill" from the parts iOS returns. The suburb is `city` in Australia.
export function labelFromAddress(address: LocationGeocodedAddress | undefined): string | null {
  if (!address) return null;
  const street =
    address.name ?? ([address.streetNumber, address.street].filter(Boolean).join(' ') || null);
  const parts = [street, address.city].filter((part): part is string => Boolean(part?.trim()));
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length > 0 ? unique.join(', ').slice(0, 200) : null;
}

async function labelFor(coordinate: Coordinate): Promise<string> {
  try {
    const [address] = await withTimeout(
      reverseGeocodeAsync({ latitude: coordinate.lat, longitude: coordinate.lon }),
      REVERSE_GEOCODE_TIMEOUT_MS,
    );
    return labelFromAddress(address) ?? CURRENT_LOCATION_LABEL;
  } catch {
    // Geocoding is rate limited by iOS and can fail offline. The trip only needs the coordinate,
    // so the plain label is the right fallback, not an error.
    return CURRENT_LOCATION_LABEL;
  }
}

export interface CurrentPlaceOptions {
  // Naming the street sends the position from the phone to Apple, through iOS. Only live mode,
  // which the person has agreed to, may do that; demo mode sends nothing.
  lookUpStreetName?: boolean;
}

// Call only from a person's action, such as tapping "Use my location": this is when iOS shows the
// permission prompt. Nothing is logged, and the position is not stored by this function.
export async function requestCurrentPlace({
  lookUpStreetName = false,
}: CurrentPlaceOptions = {}): Promise<CurrentPlaceResult> {
  const permission = await requestForegroundPermissionsAsync();
  if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };

  if (!(await hasServicesEnabledAsync())) {
    return { status: 'unavailable', reason: 'services-disabled' };
  }

  let coordinate: Coordinate;
  try {
    const position = await withTimeout(
      getCurrentPositionAsync({ accuracy: Accuracy.Balanced }),
      POSITION_TIMEOUT_MS,
    );
    coordinate = { lat: position.coords.latitude, lon: position.coords.longitude };
  } catch (error) {
    if (error instanceof TimedOutError) return { status: 'unavailable', reason: 'timeout' };
    // Core Location reports a failed fix (indoors, airplane mode) as an error; the person can
    // still type a starting point. Only the error code is logged, never a position.
    console.warn(`HopReady: no position fix (${errorCode(error)}).`);
    return { status: 'unavailable', reason: 'position-failed' };
  }

  if (!isWithinGreaterSydney(coordinate)) return { status: 'outside-coverage' };

  return {
    status: 'granted',
    place: {
      name: lookUpStreetName ? await labelFor(coordinate) : CURRENT_LOCATION_LABEL,
      coordinate,
      kind: 'current-location',
    },
  };
}

// Never prompts. For showing the blue dot on maps only when the person already said yes.
export async function hasLocationPermission(): Promise<boolean> {
  const permission = await getForegroundPermissionsAsync();
  return permission.granted;
}

// Opens HopReady's page in the Settings app, where location access can be turned back on.
export function openLocationSettings(): Promise<void> {
  return Linking.openSettings();
}
