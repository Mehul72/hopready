import { formatSydneyTime, type Itinerary, type PlanRequest, toIso } from '@hopready/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { describeWait } from '@/api';
import { AppText, Banner, Button, Card } from '@/components';
import { type ActiveTripRefresh, lastAnsweredAt, planSession } from '@/state';
import { appStorage } from '@/storage';
import { SPACING } from '@/theme';
import {
  joinAlternative,
  MANUAL_REFRESH_MIN_INTERVAL_SECONDS,
  partToCheck,
  refreshableRequest,
  replanRequest,
  useDataMode,
} from '@/trip';

import { showResultsFor } from '../saved/plan-requests';
import { writeOrAlert } from '../saved/storage-writes';
import { shownDurationSeconds } from '../shared/shown-duration';
import { describeTripSummary } from './trip-summary-card';
import { optionLabel } from '../shared/option-labels';
import { duration } from './trip-text';
import type { DisplayedTrip } from './use-displayed-trip';
import { useStaleCheckAt } from './use-stale-check-at';

// Follows another option after the chosen one stopped being offered. The alternatives come from
// the same refresh, so the trip keeps the search they answer and the same mode. Once the trip has
// started, they cover only the rest of it: the part already travelled stays, and so does the
// search for the whole trip.
function followAlternative(alternative: Itinerary, refresh: ActiveTripRefresh) {
  const activeTrip = appStorage.activeTrip.get();
  const { request, restOfTrip } = refresh;
  if (!activeTrip || !request) return;
  const now = new Date();
  const followed = restOfTrip
    ? {
        request: activeTrip.request,
        itinerary: joinAlternative(activeTrip.itinerary, restOfTrip.fromLegIndex, alternative),
      }
    : { request: refreshableRequest(request, now), itinerary: alternative };
  const started = writeOrAlert(
    () =>
      planSession.follow({
        ...followed,
        plannedAt: refresh.checkedAt ?? toIso(now),
        mode: activeTrip.mode,
      }),
    "Couldn't switch to this option",
  );
  if (started.ok) {
    router.replace({ pathname: '/itinerary/[id]', params: { id: followed.itinerary.id } });
  }
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
  // Once the trip has started, an option leaves from the stop of its next service, not from where
  // the trip began, so someone still on the way there can tell where Leave applies.
  const from = refresh.restOfTrip ? (refresh.request?.origin.name ?? null) : null;
  // The alternatives are only as fresh as the check that found them.
  const staleCheckAt = useStaleCheckAt(refresh.checkedAt);
  const summary = describeTripSummary(alternative, staleCheckAt);
  return (
    <Card
      onPress={() => followAlternative(alternative, refresh)}
      accessibilityLabel={from ? `From ${from}. ${summary}` : summary}
      accessibilityHint="Follows this option instead">
      <View style={styles.alternative}>
        <AppText variant="subheadline" tone="secondary" weight="semibold">
          {from ? `${optionLabel(alternative)} from ${from}` : optionLabel(alternative)}
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

interface CheckNote {
  text: string;
  // The note is about the check at this time; a newer answer makes it out of date.
  checkedAt: string | null;
}

// When the followed trip was last checked, and a way to check it again, as the results have.
function CheckForChanges({
  checkedAt,
  canCheck,
  checking,
}: {
  checkedAt: string | null;
  canCheck: boolean;
  checking: boolean;
}) {
  const [note, setNote] = useState<CheckNote | null>(null);

  async function check() {
    setNote(null);
    const outcome = await planSession.checkActiveTrip();
    if (outcome.status === 'too-soon') {
      setNote({
        text: `This trip was checked less than ${MANUAL_REFRESH_MIN_INTERVAL_SECONDS} seconds ago. You can check again in ${describeWait(outcome.retryInSeconds)}.`,
        checkedAt,
      });
    }
  }

  if (!checkedAt && !canCheck) return null;
  return (
    <>
      <View style={styles.checkRow}>
        {checkedAt ? (
          <AppText
            variant="subheadline"
            tone="secondary"
            tabularNumbers
            accessibilityLabel={`Times checked at ${formatSydneyTime(checkedAt)}`}
            style={styles.checkedAt}
            testID="times-checked-at">
            {`Checked ${formatSydneyTime(checkedAt)}`}
          </AppText>
        ) : null}
        {canCheck ? (
          <Button
            variant="plain"
            label="Check for changes"
            symbol="arrow.clockwise"
            loading={checking}
            onPress={() => void check()}
            accessibilityHint="Plans what is left of your trip again, at most every 30 seconds"
          />
        ) : null}
      </View>
      {note && note.checkedAt === checkedAt ? (
        <Banner tone="info" message={note.text} announce testID="check-too-soon" />
      ) : null}
    </>
  );
}

// The followed trip's times and what the latest check of it found. Shown only on the followed
// trip.
export function ActiveTripStatus({ trip, nowMs }: { trip: DisplayedTrip; nowMs: number }) {
  const mode = useDataMode();
  if (!trip.isActive) return null;
  // Once every service has left, there is nothing left to check (refresh-policy.ts).
  const canCheck = partToCheck(trip, new Date(nowMs), mode) !== null;
  // A check that found the trip no longer offered leaves its times as they were, but it still
  // counts towards when the trip can be checked again, so the line says when it ran.
  const checkedAt = trip.plannedAt ? lastAnsweredAt(trip.plannedAt, trip.activeTripRefresh) : null;
  return (
    <>
      <CheckForChanges
        checkedAt={checkedAt}
        canCheck={canCheck}
        checking={trip.activeTripRefresh.status === 'refreshing'}
      />
      <CheckResult trip={trip} canCheck={canCheck} />
    </>
  );
}

function CheckResult({ trip, canCheck }: { trip: DisplayedTrip; canCheck: boolean }) {
  const { activeTripRefresh: refresh, itinerary, request } = trip;
  switch (refresh.status) {
    case 'idle':
      return null;
    case 'refreshing':
      return <Banner tone="info" message="Checking this trip for changes." />;
    case 'updated':
      // When it was checked is on the line above. Only the services still to come were planned
      // again, so a service that had already left is not vouched for.
      return (
        <Banner
          tone="info"
          message={
            refresh.restOfTrip?.serviceAlreadyLeft
              ? "Your next services are still running, with the latest times. A service that has already left can't be checked, so a delay on it could still make you miss a connection."
              : 'This trip is still on, with the latest times.'
          }
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
            canCheck
              ? {
                  label: 'Try again',
                  onPress: () => {
                    void planSession.checkActiveTrip();
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  checkedAt: {
    flexShrink: 1,
  },
  alternatives: {
    gap: SPACING.sm,
  },
  alternative: {
    gap: SPACING.xxs,
  },
});
