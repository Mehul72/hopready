import type { Place, PlanRequest } from '@hopready/core';
import { useState } from 'react';
import { Alert, type AlertButton } from 'react-native';

import { appStorage, type FavouriteRoute, isSamePlace } from '@/storage';

import {
  type CurrentPlaceOutcome,
  findCurrentPlace,
  openLocationSettingsOrExplain,
} from './current-location';
import {
  accessForRoute,
  leaveNowRequest,
  repeatRecentRequest,
  showResultsFor,
  type SavedTripSettings,
} from './plan-requests';

function savedTripSettings(): SavedTripSettings {
  return { preferences: appStorage.preferences.get(), parkingSpots: appStorage.parkingSpots.get() };
}

function openSettingsButton(): AlertButton {
  return { text: 'Open Settings', onPress: openLocationSettingsOrExplain };
}

function explainLocationProblem(
  outcome: Extract<CurrentPlaceOutcome, { status: 'problem' }>,
  alternative: AlertButton | null,
) {
  const buttons: AlertButton[] = [
    ...(alternative ? [alternative] : []),
    ...(outcome.canOpenSettings ? [openSettingsButton()] : []),
    { text: alternative || outcome.canOpenSettings ? 'Cancel' : 'OK', style: 'cancel' },
  ];
  Alert.alert(
    "Couldn't use your location",
    alternative ? `${outcome.message} You can plan from Home instead.` : outcome.message,
    buttons,
  );
}

export interface ShortcutPlanner {
  // True while finding the current location, before the results screen opens.
  locating: boolean;
  planToPlace: (destination: Place) => Promise<void>;
  planRoute: (route: FavouriteRoute) => Promise<void>;
  planRecent: (recent: PlanRequest) => Promise<void>;
}

// One-tap planning from Saved: favourites, routes and recent searches, always leaving now with
// the saved trip defaults. "Current location" is found again each time, never reused.
export function useShortcutPlanner(): ShortcutPlanner {
  const [locating, setLocating] = useState(false);

  const locate = async (): Promise<CurrentPlaceOutcome> => {
    setLocating(true);
    try {
      return await findCurrentPlace();
    } finally {
      setLocating(false);
    }
  };

  // A saved "current location" origin means wherever the person is now.
  const resolveOrigin = async (origin: Place): Promise<Place | null> => {
    if (origin.kind !== 'current-location') return origin;
    const outcome = await locate();
    if (outcome.status === 'found') return outcome.place;
    explainLocationProblem(outcome, null);
    return null;
  };

  return {
    locating,
    planToPlace: async (destination) => {
      const outcome = await locate();
      const plan = (origin: Place) =>
        showResultsFor(
          leaveNowRequest(
            {
              origin,
              destination,
              access: accessForRoute({ origin, destination }, appStorage.recentRequests.get()),
              trip: { kind: 'outbound' },
              now: new Date(),
            },
            savedTripSettings(),
          ),
        );
      if (outcome.status === 'found') {
        plan(outcome.place);
        return;
      }
      const home = appStorage.places.get().home;
      const fromHome =
        home && !isSamePlace(home, destination)
          ? { text: 'Plan from Home', onPress: () => plan(home) }
          : null;
      explainLocationProblem(outcome, fromHome);
    },
    planRoute: async (route) => {
      const origin = await resolveOrigin(route.origin);
      if (!origin) return;
      showResultsFor(
        leaveNowRequest(
          {
            origin,
            destination: route.destination,
            access: accessForRoute(route, appStorage.recentRequests.get()),
            trip: { kind: 'outbound' },
            now: new Date(),
          },
          savedTripSettings(),
        ),
      );
    },
    planRecent: async (recent) => {
      const origin = await resolveOrigin(recent.origin);
      if (!origin) return;
      showResultsFor(
        repeatRecentRequest(
          { ...recent, origin },
          appStorage.parkedCar.get(),
          new Date(),
          savedTripSettings(),
        ),
      );
    },
  };
}
