import {
  formatSydneyTime,
  type Itinerary,
  type PlanRequest,
  type PlanResponse,
  type Strategy,
} from '@hopready/core';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { describeWait } from '@/api';
import {
  AppText,
  Banner,
  Button,
  EmptyState,
  LoadingState,
  type MapPoint,
  Screen,
  TripMap,
} from '@/components';
import { turnOnDemoMode } from '@/features/plan/demo-mode';
import { usePlanChoices } from '@/features/plan/plan-choices';
import { describeRequestTime } from '@/features/plan/time-choice';
import { planSession, usePlanSession } from '@/state';
import { appStorage, usePreferences } from '@/storage';
import { MAX_CONTENT_WIDTH, SPACING, useTheme } from '@/theme';
import { MANUAL_REFRESH_MIN_INTERVAL_SECONDS, replanRequest, useTripHomeOutOfDate } from '@/trip';

import { useStaleCheckAt } from '../itinerary/use-stale-check-at';
import { TripHomeOutOfDate } from '../shared/trip-home-out-of-date';
import { CarParksChecked } from './car-parks-checked';
import { optionsChangedSince, withCurrentOptions } from './current-options';
import { defaultOrderFor, orderItineraries, ordersFor, type ResultOrder } from './itinerary-order';
import { NoOptions } from './no-options';
import { OrderPicker } from './order-picker';
import { STRATEGY_LABELS } from './plan-explanations';
import { ResultsError } from './results-error';
import { RouteCard } from './route-card';
import { useNow } from './use-now';

// Occupancy ages ("updated 3 min ago") stay roughly right while the list is open.
const AGE_REFRESH_MS = 30_000;
// The map stays on screen while the list scrolls: drive times from Apple are only shown with an
// Apple map. This share of the window keeps room for the list on small phones.
const MAP_SHARE_OF_WINDOW = 0.28;
const MAP_MIN_HEIGHT = 150;
const MAP_MAX_HEIGHT = 260;

function endpointsOf(request: PlanRequest): MapPoint[] {
  return [
    {
      id: 'origin',
      coordinate: request.origin.coordinate,
      kind: 'origin',
      label: request.origin.name,
    },
    {
      id: 'destination',
      coordinate: request.destination.coordinate,
      kind: 'destination',
      label: request.destination.name,
    },
  ];
}

// "Public transport not included" would read as false next to a Drive and park card that uses the
// metro, so the public-transport-only strategy is named for what is actually missing.
function unavailableTitle(strategy: Strategy): string {
  if (strategy === 'transit-only') return 'Public transport the whole way: not included';
  return `${STRATEGY_LABELS[strategy]} not included`;
}

function uniqueUnavailable(entries: PlanResponse['unavailable']): PlanResponse['unavailable'] {
  const byKey = new Map(entries.map((entry) => [`${entry.strategy}:${entry.reason}`, entry]));
  return [...byKey.values()];
}

interface RefreshNote {
  text: string;
  // The note describes these results; newer results make it out of date.
  plannedAt: string | null;
}

export function ResultsScreen() {
  const router = useRouter();
  const session = usePlanSession();
  const now = useNow(AGE_REFRESH_MS);
  const { colours } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [chosenOrder, setChosenOrder] = useState<ResultOrder | null>(null);
  const [refreshNote, setRefreshNote] = useState<RefreshNote | null>(null);
  const { request, response, status, error, plannedAt } = session;
  const timeType = request?.time.type ?? 'depart';
  const orders = ordersFor(timeType);
  const order =
    chosenOrder !== null && orders.includes(chosenOrder) ? chosenOrder : defaultOrderFor(timeType);
  // The map re-frames whenever its content changes, so the lists it gets keep their identity
  // across renders that change nothing, such as the clock ticking.
  const itineraries = useMemo(
    () => (response ? orderItineraries(response.itineraries, order) : []),
    [response, order],
  );
  const endpoints = useMemo(() => (request ? endpointsOf(request) : []), [request]);
  const preferences = usePreferences();
  const choices = usePlanChoices();
  const tripHomeOutOfDate = useTripHomeOutOfDate(request);
  const staleCheckAt = useStaleCheckAt(plannedAt);

  // VoiceOver users hear nothing when the loading rows are replaced, so the outcome is spoken.
  useEffect(() => {
    if (status !== 'ready' || !response) return;
    const count = response.itineraries.length;
    AccessibilityInfo.announceForAccessibility(
      count === 0
        ? 'No trip options found.'
        : `${count} trip ${count === 1 ? 'option' : 'options'} found.`,
    );
  }, [status, response]);

  function changeTrip() {
    if (router.canGoBack()) router.back();
    else router.navigate('/');
  }

  if (!request) {
    return (
      <Screen testID="results-screen">
        <EmptyState
          title="No trip planned yet"
          message="Choose where you're going on the Plan tab, and the options appear here."
          symbol="map"
          action={{ label: 'Plan a trip', onPress: changeTrip }}
          testID="results-idle"
        />
      </Screen>
    );
  }

  const highlightedId =
    itineraries.find((itinerary) => itinerary.id === session.selectedItineraryId)?.id ??
    itineraries[0]?.id ??
    null;
  const mapHeight = Math.round(
    Math.min(Math.max(windowHeight * MAP_SHARE_OF_WINDOW, MAP_MIN_HEIGHT), MAP_MAX_HEIGHT),
  );

  const currentRequest = withCurrentOptions(request, preferences, choices);
  const optionsChanged = response !== null && optionsChangedSince(request, currentRequest);
  // The same limit as the trip screen, so an option is not called live here but not there.
  // Refreshing could only plan back to the car as it was, so the banner asks for Take me home.
  const canRefresh = response !== null && !tripHomeOutOfDate;

  // A "leave at" time that passed meanwhile moves up to now. A trip home that no longer fits the
  // car is not planned at all.
  function planAgain(base: PlanRequest) {
    const next = replanRequest(base, appStorage.parkedCar.get(), new Date());
    if (next) void planSession.plan(next);
  }

  function planWithCurrentOptions() {
    planAgain(currentRequest);
  }

  function retry() {
    // A failed first search has nothing to keep on screen, so it plans afresh.
    if (request) planAgain(request);
  }

  async function refresh() {
    setRefreshNote(null);
    const outcome = await planSession.refresh();
    if (outcome.status === 'too-soon') {
      setRefreshNote({
        text: `These options are less than ${MANUAL_REFRESH_MIN_INTERVAL_SECONDS} seconds old. You can refresh again in ${describeWait(outcome.retryInSeconds)}.`,
        plannedAt: planSession.getState().plannedAt,
      });
    }
  }

  function switchToDemoMode() {
    const current = planSession.getState().request;
    // Switching modes clears the session, so the same trip is planned again with sample data.
    if (!turnOnDemoMode() || !current) return;
    planAgain(current);
  }

  // Opening an option only shows it. Following it, which refreshes it when the app comes back, is
  // the trip screen's "Start this trip".
  function openItinerary(itinerary: Itinerary) {
    router.navigate({ pathname: '/itinerary/[id]', params: { id: itinerary.id } });
  }

  let body: ReactNode;
  if (!response && status === 'failed' && error) {
    // Trying again would plan back to the car as it was; the banner above says what to do.
    body = tripHomeOutOfDate ? null : (
      <ResultsError
        error={error}
        onRetry={retry}
        onUseDemoMode={switchToDemoMode}
        onChangeTrip={changeTrip}
      />
    );
  } else if (!response) {
    body = (
      <LoadingState rows={3} accessibilityLabel="Finding trip options" testID="results-loading" />
    );
  } else {
    body = (
      <>
        {status === 'failed' && error ? (
          <Banner
            tone="error"
            title="Couldn't refresh"
            message={`${error.message} These options are from ${plannedAt ? formatSydneyTime(plannedAt) : 'earlier'}.`}
            announce
            testID="refresh-failed"
          />
        ) : null}
        {optionsChanged && !tripHomeOutOfDate ? (
          <Banner
            tone="info"
            title="Trip options changed"
            message="These results use your earlier options."
            action={{
              label: 'Plan again',
              onPress: planWithCurrentOptions,
              accessibilityHint: 'Plans this trip with your current trip options',
            }}
            testID="options-changed"
          />
        ) : null}
        {refreshNote && refreshNote.plannedAt === plannedAt ? (
          <Banner tone="info" message={refreshNote.text} announce testID="refresh-too-soon" />
        ) : null}
        {/* Each strategy reports the same provider trouble, so a notice can arrive twice. */}
        {[...new Set(response.notices)].map((notice) => (
          <Banner key={notice} tone="info" message={notice} />
        ))}
        {itineraries.length > 1 ? (
          <OrderPicker orders={orders} value={order} onChange={setChosenOrder} />
        ) : null}
        {itineraries.length === 0 ? (
          <NoOptions
            response={response}
            preferences={request.preferences}
            onChangeTripOptions={() => router.navigate('/trip-options')}
            onChangeTrip={changeTrip}
          />
        ) : (
          itineraries.map((itinerary) => (
            <RouteCard
              key={itinerary.id}
              itinerary={itinerary}
              now={now}
              staleCheckAt={staleCheckAt}
              selected={itinerary.id === session.selectedItineraryId}
              onPress={() => openItinerary(itinerary)}
            />
          ))
        )}
        {uniqueUnavailable(response.unavailable).map((entry) => (
          <Banner
            key={`${entry.strategy}:${entry.reason}`}
            tone="info"
            title={unavailableTitle(entry.strategy)}
            message={entry.reason}
            testID={`unavailable-${entry.strategy}`}
          />
        ))}
        <CarParksChecked
          checkedCarParks={response.checkedCarParks}
          maxDriveMinutes={request.preferences.maxDriveMinutes}
        />
      </>
    );
  }

  return (
    <Screen scroll={false} testID="results-screen">
      {itineraries.length > 0 ? (
        <TripMap
          itineraries={itineraries}
          selectedItineraryId={highlightedId}
          style={{ height: mapHeight }}
          testID="results-map"
        />
      ) : (
        <TripMap points={endpoints} style={{ height: mapHeight }} testID="results-map" />
      )}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          canRefresh ? (
            <RefreshControl
              refreshing={status === 'refreshing'}
              onRefresh={() => void refresh()}
              tintColor={colours.brand}
              accessibilityLabel="Refresh trip options"
            />
          ) : undefined
        }
        testID="results-list">
        <View style={styles.readableWidth}>
          <View style={styles.summaryRow}>
            <View accessible style={styles.summary} testID="results-summary">
              <AppText variant="headline">{`${request.origin.name} to ${request.destination.name}`}</AppText>
              <AppText variant="subheadline" tone="secondary">
                {[
                  describeRequestTime(request.time, now),
                  plannedAt ? `checked ${formatSydneyTime(plannedAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
            </View>
            {/* Pull to refresh is hard to find with VoiceOver or Switch Control; this does the same. */}
            {canRefresh ? (
              <Button
                variant="plain"
                label="Refresh"
                symbol="arrow.clockwise"
                loading={status === 'refreshing'}
                onPress={() => void refresh()}
                accessibilityHint="Checks for newer times, at most every 30 seconds"
              />
            ) : null}
          </View>
          {tripHomeOutOfDate ? <TripHomeOutOfDate /> : null}
          {body}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  readableWidth: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: SPACING.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  summary: {
    flex: 1,
    minWidth: '60%',
    gap: SPACING.xxs,
  },
});
