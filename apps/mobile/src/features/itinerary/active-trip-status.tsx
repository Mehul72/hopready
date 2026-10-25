import {
  formatSydneyTime,
  isBefore,
  type Itinerary,
  type PlanRequest,
  toIso,
} from '@hopready/core';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Banner, Card } from '@/components';
import { type ActiveTripRefresh, planSession } from '@/state';
import { appStorage } from '@/storage';
import { SPACING } from '@/theme';
import { refreshableRequest, replanRequest, useTripHomeOutOfDate } from '@/trip';

import { showResultsFor } from '../saved/plan-requests';
import { writeOrAlert } from '../saved/storage-writes';
import { shownDurationSeconds } from '../shared/shown-duration';
import { TripHomeOutOfDate } from '../shared/trip-home-out-of-date';
import { describeTripSummary } from './trip-summary-card';
import { optionLabel } from '../shared/option-labels';
import { duration } from './trip-text';
import type { DisplayedTrip } from './use-displayed-trip';

// Follows another option after the chosen one stopped being offered. The alternatives come from
// the same refresh, so the trip keeps the search they answer and the same mode.
function followAlternative(alternative: Itinerary, refresh: ActiveTripRefresh) {
  const activeTrip = appStorage.activeTrip.get();
  const { request } = refresh;
  if (!activeTrip || !request) return;
  const now = new Date();
  const started = writeOrAlert(
    () =>
      appStorage.activeTrip.start({
        request: refreshableRequest(request, now),
        itinerary: alternative,
        plannedAt: refresh.checkedAt ?? toIso(now),
        mode: activeTrip.mode,
      }),
    "Couldn't switch to this option",
  );
  if (started.ok) router.replace({ pathname: '/itinerary/[id]', params: { id: alternative.id } });
}

// Through replanRequest, so a trip home never goes back to a car that has moved or gone.
function planAgain(request: PlanRequest) {
  const next = replanRequest(request, appStorage.parkedCar.get(), new Date());
  if (next) showResultsFor(next);
}

function AlternativeCard({
  alternative,
  refresh,
}: {
  alternative: Itinerary;
  refresh: ActiveTripRefresh;
}) {
  const total = duration(shownDurationSeconds(alternative));
  return (
    <Card
      onPress={() => followAlternative(alternative, refresh)}
      accessibilityLabel={describeTripSummary(alternative)}
      accessibilityHint="Follows this option instead">
      <View style={styles.alternative}>
        <AppText variant="subheadline" tone="secondary" weight="semibold">
          {optionLabel(alternative)}
        </AppText>
        <AppText variant="headline" tabularNumbers>
          {`Leave ${formatSydneyTime(alternative.departAt)} · Arrive ${formatSydneyTime(alternative.arriveAt)}`}
        </AppText>
        <AppText variant="subheadline" tone="secondary" tabularNumbers>
          {`${total.text} total`}
        </AppText>
      </View>
    </Card>
  );
}

// What the latest check of the followed trip found. Shown only on the followed trip.
export function ActiveTripStatus({ trip, nowMs }: { trip: DisplayedTrip; nowMs: number }) {
  const { activeTripRefresh: refresh, itinerary, request } = trip;
  const tripHomeOutOfDate = useTripHomeOutOfDate(request);
  if (!trip.isActive) return null;
  // What a check found is about the car as it was, so it gives way to asking for Take me home.
  if (tripHomeOutOfDate) return <TripHomeOutOfDate />;
  // Once the trip has started, checking it again cannot find it (refresh-policy.ts).
  const canCheckAgain = isBefore(new Date(nowMs), itinerary.departAt);

  switch (refresh.status) {
    case 'idle':
      return null;
    case 'refreshing':
      return <Banner tone="info" message="Checking this trip for changes." />;
    case 'updated':
      return (
        <Banner
          tone="info"
          message={`Checked ${refresh.checkedAt ? `at ${formatSydneyTime(refresh.checkedAt)}` : 'just now'}. This trip is still on, with the latest times.`}
        />
      );
    case 'replaced':
      return (
        <Banner
          tone="warning"
          title="Your trip changed"
          message={`The ${refresh.previous ? `${formatSydneyTime(refresh.previous.departAt)} ` : ''}option is no longer running, so you're now following the same option leaving at ${formatSydneyTime(itinerary.departAt)}.`}
          announce
        />
      );
    case 'no-longer-offered': {
      // This itinerary is one of the options offered now, so the warning is about another one.
      if (refresh.alternatives.some((alternative) => alternative.id === itinerary.id)) return null;
      if (refresh.alternatives.length === 0) {
        const searched = refresh.request ?? request;
        return (
          <Banner
            tone="error"
            title="This trip is no longer offered"
            message="A service may be cancelled or a connection no longer works, and nothing else is offered right now."
            action={
              searched ? { label: 'Plan again', onPress: () => planAgain(searched) } : undefined
            }
            announce
          />
        );
      }
      return (
        <View style={styles.alternatives}>
          <Banner
            tone="error"
            title="This trip is no longer offered"
            message="A service may be cancelled or a connection no longer works. These options are offered now:"
            announce
          />
          {refresh.alternatives.map((alternative) => (
            <AlternativeCard key={alternative.id} alternative={alternative} refresh={refresh} />
          ))}
        </View>
      );
    }
    case 'failed':
      return (
        <Banner
          tone="error"
          title="Couldn't check this trip"
          message={refresh.error?.message ?? 'Something went wrong. Try again.'}
          action={
            canCheckAgain
              ? {
                  label: 'Try again',
                  onPress: () => {
                    void planSession.refreshActiveTrip();
                  },
                }
              : undefined
          }
          announce
        />
      );
  }
}

const styles = StyleSheet.create({
  alternatives: {
    gap: SPACING.sm,
  },
  alternative: {
    gap: SPACING.xxs,
  },
});
