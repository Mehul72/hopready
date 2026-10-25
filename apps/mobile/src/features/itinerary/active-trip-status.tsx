import { formatSydneyTime, isBefore, type Itinerary, toIso } from '@hopready/core';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Banner, Card } from '@/components';
import { planSession } from '@/state';
import { appStorage } from '@/storage';
import { SPACING } from '@/theme';
import { refreshableRequest } from '@/trip';

import { showResultsFor } from '../saved/plan-requests';
import { writeOrAlert } from '../saved/storage-writes';
import { shownDurationSeconds } from '../shared/shown-duration';
import { describeTripSummary } from './trip-summary-card';
import { optionLabel } from '../shared/option-labels';
import { duration } from './trip-text';
import type { DisplayedTrip } from './use-displayed-trip';

// Follows another option after the chosen one stopped being offered. The alternatives come from
// the same refresh, so they are planned for the same request and mode.
function followAlternative(alternative: Itinerary, checkedAt: string | null) {
  const activeTrip = appStorage.activeTrip.get();
  if (!activeTrip) return;
  const now = new Date();
  const started = writeOrAlert(
    () =>
      appStorage.activeTrip.start({
        request: refreshableRequest(activeTrip.request, now),
        itinerary: alternative,
        plannedAt: checkedAt ?? toIso(now),
        mode: activeTrip.mode,
      }),
    "Couldn't switch to this option",
  );
  if (started.ok) router.replace({ pathname: '/itinerary/[id]', params: { id: alternative.id } });
}

function AlternativeCard({
  alternative,
  checkedAt,
}: {
  alternative: Itinerary;
  checkedAt: string | null;
}) {
  const total = duration(shownDurationSeconds(alternative));
  return (
    <Card
      onPress={() => followAlternative(alternative, checkedAt)}
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
  if (!trip.isActive) return null;
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
        return (
          <Banner
            tone="error"
            title="This trip is no longer offered"
            message="A service may be cancelled or a connection no longer works, and nothing else is offered right now."
            action={
              request
                ? {
                    label: 'Plan again',
                    onPress: () => showResultsFor(refreshableRequest(request, new Date())),
                  }
                : undefined
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
            <AlternativeCard
              key={alternative.id}
              alternative={alternative}
              checkedAt={refresh.checkedAt}
            />
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
