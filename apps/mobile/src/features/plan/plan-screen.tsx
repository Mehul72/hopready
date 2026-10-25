import type { Place } from '@hopready/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, Card, ListRow, Screen } from '@/components';
import { useNow } from '@/features/results/use-now';
import { planSession } from '@/state';
import {
  appStorage,
  useFavouriteRoutes,
  usePreferences,
  useRecentRequests,
  useSavedParkingSpots,
  useSavedPlaces,
} from '@/storage';
import { SPACING } from '@/theme';

import { AccessChoices } from './access-choices';
import { ActionChip } from './action-chip';
import { LocationNotice } from './location-notice';
import { type PlaceField, planDraft, usePlanDraft } from './plan-draft';
import { planChoices, type TravelAccess, usePlanChoices } from './plan-choices';
import {
  buildPlanRequest,
  findPlanProblems,
  PLAN_PROBLEM_TEXT,
  type PlanInputs,
  type PlanProblem,
} from './plan-request';
import { FIELD_NAMES, PlaceFields } from './place-fields';
import {
  buildQuickPicks,
  favouriteRouteShortcuts,
  type QuickPick,
  recentTripShortcuts,
  type RouteShortcut,
} from './place-labels';
import { RouteShortcuts } from './route-shortcuts';
import { TimeChoiceControl } from './time-choice-control';
import { tripOptionsSummary } from './trip-option-settings';
import { useCurrentPlace } from './use-current-place';

// Keeps "That time has passed" and the picker's earliest time honest while the tab stays open.
const CLOCK_REFRESH_MS = 30_000;
const MAX_RECENT_TRIPS = 5;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

// Saved choices are conveniences; a failed write must not stop someone planning a trip.
function rememberAccess(change: Partial<TravelAccess>): void {
  try {
    planChoices.setAccess(change);
  } catch (error) {
    console.warn(`HopReady: could not save travel choices (${errorName(error)}).`);
  }
}

function spokenProblems(problems: readonly PlanProblem[]): string {
  return problems.map((problem) => PLAN_PROBLEM_TEXT[problem]).join(' ');
}

export function PlanScreen() {
  const router = useRouter();
  const draft = usePlanDraft();
  const choices = usePlanChoices();
  const preferences = usePreferences();
  const saved = useSavedPlaces();
  const recents = useRecentRequests();
  const favouriteRoutes = useFavouriteRoutes();
  const parkingSpots = useSavedParkingSpots();
  const location = useCurrentPlace();
  const now = useNow(CLOCK_REFRESH_MS);
  // Problems appear after the first attempt to plan, then update as the person fixes them.
  const [attempted, setAttempted] = useState(false);
  const [locationField, setLocationField] = useState<PlaceField>('origin');

  const inputs: PlanInputs = {
    origin: draft.origin,
    destination: draft.destination,
    time: draft.time,
    access: choices.access,
    choices,
    preferences,
    savedParkingSpots: parkingSpots,
  };
  const problems = attempted ? findPlanProblems(inputs, now) : [];
  // Quick picks fill the first empty field, then replace the destination.
  const pickField: PlaceField = draft.origin ? 'destination' : 'origin';
  const quickPicks = buildQuickPicks(saved, recents, { includeCurrentLocation: true });
  const locating = location.attempt.status === 'locating';

  function openSearch(field: PlaceField) {
    // Typing a place replaces any location lookup still running or any notice about one.
    location.dismiss();
    router.navigate({ pathname: '/place-search', params: { field } });
  }

  async function fillWithCurrentPlace(field: PlaceField): Promise<Place | null> {
    setLocationField(field);
    const place = await location.locate();
    if (place) planDraft.setPlace(field, place);
    return place;
  }

  function choosePick(pick: QuickPick) {
    if (pick.kind === 'current-location') {
      void fillWithCurrentPlace(pickField);
      return;
    }
    location.dismiss();
    planDraft.setPlace(pickField, pick.place);
  }

  function startPlanning(planInputs: PlanInputs) {
    const result = buildPlanRequest(planInputs, new Date());
    if (!result.ok) {
      setAttempted(true);
      AccessibilityInfo.announceForAccessibility(spokenProblems(result.problems));
      return;
    }
    setAttempted(false);
    // The results screen follows the session, including the wait and any error. Navigating
    // rather than pushing means a double tap cannot stack two results screens.
    void planSession.plan(result.request);
    router.navigate('/results');
  }

  async function planShortcut(shortcut: RouteShortcut) {
    let { origin, destination } = shortcut;
    // A recent "Current location" holds where the person was then, so it is looked up again.
    const staleField: PlaceField | null =
      origin.kind === 'current-location'
        ? 'origin'
        : destination.kind === 'current-location'
          ? 'destination'
          : null;
    if (staleField) {
      planDraft.setRoute(
        staleField === 'origin' ? null : origin,
        staleField === 'destination' ? null : destination,
      );
      const here = await fillWithCurrentPlace(staleField);
      if (!here) return;
      if (staleField === 'origin') origin = here;
      else destination = here;
    }
    planDraft.setRoute(origin, destination);
    const access = shortcut.access ?? choices.access;
    if (shortcut.access) rememberAccess(shortcut.access);
    startPlanning({ ...inputs, origin, destination, access });
  }

  function clearRecents() {
    try {
      appStorage.recentRequests.clear();
    } catch (error) {
      console.warn(`HopReady: could not clear recent trips (${errorName(error)}).`);
    }
  }

  return (
    <Screen testID="plan-screen">
      <AppText variant="largeTitle" accessibilityRole="header">
        Plan a trip
      </AppText>
      <PlaceFields
        origin={draft.origin}
        destination={draft.destination}
        saved={saved}
        onOpenField={openSearch}
        onSwap={() => planDraft.swapPlaces()}
      />
      <View style={styles.group}>
        <AppText variant="footnote" tone="secondary">
          {`Quick picks for ${FIELD_NAMES[pickField]}`}
        </AppText>
        <View style={styles.chips}>
          {quickPicks.map((pick) => (
            <ActionChip
              key={pick.key}
              label={pick.label}
              symbol={pick.symbol}
              busy={pick.kind === 'current-location' && locating}
              onPress={() => choosePick(pick)}
              accessibilityHint={`Sets ${FIELD_NAMES[pickField]}`}
              testID={`quick-pick-${pick.key}`}
            />
          ))}
        </View>
      </View>
      <LocationNotice
        attempt={location.attempt}
        enterPlaceLabel={
          locationField === 'origin' ? 'Enter a starting point' : 'Enter a destination'
        }
        onEnterPlace={() => openSearch(locationField)}
        onTryAgain={() => void fillWithCurrentPlace(locationField)}
      />
      <TimeChoiceControl
        choice={draft.time}
        now={now}
        onChangeType={(type) => planDraft.setTimeType(type, new Date())}
        onChangeTime={(at) => planDraft.setChosenTime(at)}
      />
      <AccessChoices access={choices.access} onChange={rememberAccess} />
      <Card padded={false} style={styles.optionsCard}>
        <ListRow
          title="Trip options"
          subtitle={tripOptionsSummary(preferences, choices)}
          leadingSymbol="slider.horizontal.3"
          onPress={() => router.navigate('/trip-options')}
          accessibilityHint="Opens driving and walking limits, buffers and preferred stops"
        />
      </Card>
      {problems.length > 0 ? (
        <Banner
          tone="error"
          title="Before you plan"
          message={spokenProblems(problems)}
          testID="plan-problems"
        />
      ) : null}
      <Button
        label="Plan trip"
        symbol="magnifyingglass"
        onPress={() => startPlanning(inputs)}
        fullWidth
        testID="plan-button"
      />
      <RouteShortcuts
        title="Favourite routes"
        shortcuts={favouriteRouteShortcuts(favouriteRoutes, saved)}
        onPlan={(shortcut) => void planShortcut(shortcut)}
        testID="favourite-routes"
      />
      <RouteShortcuts
        title="Recent trips"
        shortcuts={recentTripShortcuts(recents, saved, MAX_RECENT_TRIPS)}
        onPlan={(shortcut) => void planShortcut(shortcut)}
        action={{
          label: 'Clear',
          onPress: clearRecents,
          accessibilityHint: 'Removes your recent trips from this phone',
        }}
        testID="recent-trips"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: SPACING.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  optionsCard: {
    overflow: 'hidden',
  },
});
