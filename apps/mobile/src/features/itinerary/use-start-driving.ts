import type { Coordinate } from '@hopready/core';
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

import { type NavigationApp, usePreferences } from '@/storage';

import { errorName } from '../saved/storage-writes';
import {
  drivingDirectionsUrl,
  findInstalledNavigationApps,
  NAVIGATION_APP_NAMES,
  type NavigationAppId,
  planNavigationLaunch,
} from './navigation-apps';

export interface DriveDestination {
  name: string;
  coordinate: Coordinate;
}

// Opening the app is the last step, so a failure here is told to the person, never thrown on.
async function openDirections(app: NavigationAppId, destination: DriveDestination) {
  const url = drivingDirectionsUrl(app, destination.coordinate, Platform.Version);
  const appName = NAVIGATION_APP_NAMES[app];
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn(`HopReady: could not open ${appName} (${errorName(error)}).`);
    Alert.alert(
      `Couldn't open ${appName}`,
      `Try another navigation app, or open one yourself and head for ${destination.name}.`,
    );
  }
}

async function startDriving(preference: NavigationApp, destination: DriveDestination) {
  const installed = await findInstalledNavigationApps((url) => Linking.canOpenURL(url));
  const launch = planNavigationLaunch(preference, installed);
  if (launch.kind === 'open') {
    await openDirections(launch.app, destination);
    return;
  }
  const preferredMissing = preference !== 'ask' && !installed.includes(preference);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `Directions to ${destination.name}`,
      message: preferredMissing
        ? `${NAVIGATION_APP_NAMES[preference]} isn't installed. Choose another app.`
        : 'Choose an app for turn-by-turn directions.',
      options: [...launch.apps.map((app) => NAVIGATION_APP_NAMES[app]), 'Cancel'],
      cancelButtonIndex: launch.apps.length,
    },
    (index) => {
      const app = launch.apps[index];
      if (app) void openDirections(app, destination);
    },
  );
}

// Hands a drive leg to a navigation app. HopReady gives no turn-by-turn directions itself.
export function useStartDriving(): (destination: DriveDestination) => Promise<void> {
  const { navigationApp } = usePreferences();

  return async (destination) => {
    try {
      await startDriving(navigationApp, destination);
    } catch (error) {
      console.warn(`HopReady: could not offer navigation apps (${errorName(error)}).`);
      Alert.alert(
        "Couldn't open directions",
        `Open a navigation app yourself and head for ${destination.name}.`,
      );
    }
  };
}
