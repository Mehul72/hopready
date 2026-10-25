import { formatSydneyTime } from '@hopready/core';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components';
import { type ActiveTripRefreshStatus, usePlanSession } from '@/state';
import { useActiveTrip } from '@/storage';
import { SPACING } from '@/theme';

import { isFollowedTripOver } from './followed-trip-window';
import { optionLabel } from '../shared/option-labels';

const STATUS_NOTES: Readonly<Partial<Record<ActiveTripRefreshStatus, string>>> = {
  refreshing: 'Checking for changes.',
  updated: 'Updated with the latest times.',
  replaced: 'Your trip changed. Open it to see what is different.',
  'no-longer-offered': 'This trip is no longer offered. Open it for other options.',
  failed: "Couldn't check this trip. Open it to try again.",
};

// The way back to the trip being followed, and to what the check on resume found, once its own
// screen has been closed or the app has been reopened.
export function FollowedTripCard({ now }: { now: Date }) {
  const activeTrip = useActiveTrip();
  const { activeTripRefresh } = usePlanSession();
  if (!activeTrip) return null;
  if (isFollowedTripOver(activeTrip, now.getTime())) return null;
  const { itinerary } = activeTrip;

  const strategy = optionLabel(itinerary);
  const times = `Leave ${formatSydneyTime(itinerary.departAt)} · Arrive ${formatSydneyTime(itinerary.arriveAt)}`;
  const spokenTimes = `Leave ${formatSydneyTime(itinerary.departAt)}, arrive ${formatSydneyTime(itinerary.arriveAt)}`;
  const note = STATUS_NOTES[activeTripRefresh.status] ?? null;

  return (
    <Card
      onPress={() => router.navigate({ pathname: '/itinerary/[id]', params: { id: itinerary.id } })}
      accessibilityLabel={`Your trip. ${strategy}. ${spokenTimes}.${note ? ` ${note}` : ''}`}
      accessibilityHint="Opens the trip you are following"
      testID="followed-trip">
      <View style={styles.content}>
        <AppText variant="footnote" tone="brand" weight="semibold">
          Your trip
        </AppText>
        <AppText variant="headline">{strategy}</AppText>
        <AppText variant="subheadline" tabularNumbers>
          {times}
        </AppText>
        {note ? (
          <AppText variant="footnote" tone="secondary">
            {note}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: SPACING.xxs,
  },
});
