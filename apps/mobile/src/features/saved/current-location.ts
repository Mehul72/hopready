import type { Place } from '@hopready/core';
import { Alert } from 'react-native';

import { type CurrentPlaceResult, openLocationSettings, requestCurrentPlace } from '@/location';
import { tripService } from '@/trip';

import { errorName } from './storage-writes';

export type CurrentPlaceOutcome =
  | { status: 'found'; place: Place }
  // `message` says what went wrong; callers add what the person can do instead.
  | { status: 'problem'; message: string; canOpenSettings: boolean };

function problemFor(
  result: Exclude<CurrentPlaceResult, { status: 'granted' }>,
): CurrentPlaceOutcome {
  switch (result.status) {
    case 'denied':
      return result.canAskAgain
        ? {
            status: 'problem',
            message: 'HopReady can only use your location if you allow it.',
            canOpenSettings: false,
          }
        : {
            status: 'problem',
            message: 'Location access is off for HopReady. You can turn it on in Settings.',
            canOpenSettings: true,
          };
    case 'outside-coverage':
      return {
        status: 'problem',
        message: 'You seem to be outside Greater Sydney, and HopReady plans trips within it only.',
        canOpenSettings: false,
      };
    case 'unavailable':
      switch (result.reason) {
        case 'services-disabled':
          return {
            status: 'problem',
            message: 'Location Services are turned off on this iPhone.',
            canOpenSettings: false,
          };
        case 'timeout':
          return {
            status: 'problem',
            message: 'Finding your location took too long.',
            canOpenSettings: false,
          };
        case 'position-failed':
          return {
            status: 'problem',
            message: "HopReady couldn't find your location just now.",
            canOpenSettings: false,
          };
      }
  }
}

// Call only from a tap: this is when iOS may ask for permission. The position is returned, not
// stored or logged.
export async function findCurrentPlace(): Promise<CurrentPlaceOutcome> {
  let result: CurrentPlaceResult;
  try {
    result = await requestCurrentPlace({
      lookUpStreetName: tripService.currentMode() === 'live',
    });
  } catch (error) {
    console.warn(`HopReady: could not get the current location (${errorName(error)}).`);
    return {
      status: 'problem',
      message: "HopReady couldn't find your location just now.",
      canOpenSettings: false,
    };
  }
  return result.status === 'granted'
    ? { status: 'found', place: result.place }
    : problemFor(result);
}

// For a "location is off" message: opens HopReady's page in the Settings app, or says how to get
// there if iOS will not open it.
export function openLocationSettingsOrExplain(): void {
  openLocationSettings().catch((error: unknown) => {
    console.warn(`HopReady: could not open Settings (${errorName(error)}).`);
    Alert.alert("Couldn't open Settings", 'Open the Settings app, then HopReady, then Location.');
  });
}
