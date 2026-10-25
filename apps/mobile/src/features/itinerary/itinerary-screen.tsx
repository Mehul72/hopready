import { router } from 'expo-router';
import { AccessibilityInfo, Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Banner, Button, EmptyState, Screen, TripMap } from '@/components';
import { planSession } from '@/state';
import { appStorage, isSamePlace, useFavouriteRoutes } from '@/storage';
import { RADII, SPACING } from '@/theme';

import { routeLabelFor } from '../saved/place-labels';
import { writeOrAlert } from '../saved/storage-writes';
import { ActiveTripStatus } from './active-trip-status';
import { DataAttribution } from './data-attribution';
import { AlertBanner, ArrivalRow, LegRow } from './leg-row';
import { TripSummaryCard } from './trip-summary-card';
import { describeStepNotes } from './trip-text';
import { useCurrentMinute } from './use-current-minute';
import { type DisplayedTrip, useDisplayedTrip } from './use-displayed-trip';
import { useStartDriving } from './use-start-driving';

const MAP_MIN_HEIGHT = 180;
const MAP_MAX_HEIGHT = 280;
const MAP_SHARE_OF_WINDOW = 0.3;

function TripNotFound() {
  return (
    <Screen>
      <EmptyState
        symbol="map"
        title="This trip isn't available"
        message="It may have been replaced by a newer search, or the app was restarted. Plan the trip again to see the options now."
        action={{ label: 'Plan a trip', onPress: () => router.navigate('/') }}
      />
    </Screen>
  );
}

function startTrip(trip: DisplayedTrip) {
  const started = writeOrAlert(
    () => planSession.select(trip.itinerary.id),
    "Couldn't start this trip",
  );
  if (!started.ok) return;
  if (!started.value) {
    Alert.alert(
      "Couldn't start this trip",
      'It is no longer in your results. Plan the trip again to start it.',
    );
    return;
  }
  AccessibilityInfo.announceForAccessibility(
    "You're following this trip. HopReady checks it for changes when you come back to the app.",
  );
}

function stopFollowing(trip: DisplayedTrip) {
  const stop = () => {
    writeOrAlert(() => appStorage.activeTrip.clear(), "Couldn't stop following this trip");
  };
  if (trip.inResults) {
    stop();
    return;
  }
  // Without the search results, the trip cannot be followed again from here.
  Alert.alert('Stop following this trip?', "You'll need to plan it again to follow it.", [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Stop following', style: 'destructive', onPress: stop },
  ]);
}

function TripFooter({ trip }: { trip: DisplayedTrip }) {
  if (!trip.isActive) {
    return (
      <Button
        label="Start this trip"
        symbol="play.fill"
        fullWidth
        accessibilityHint="Follows this trip, so HopReady checks it for changes when you come back to the app"
        onPress={() => startTrip(trip)}
      />
    );
  }
  return (
    <View style={styles.following}>
      <AppText variant="subheadline" weight="semibold" style={styles.followingText}>
        You&apos;re following this trip
      </AppText>
      <Button variant="plain" label="Stop following" onPress={() => stopFollowing(trip)} />
    </View>
  );
}

function SaveRouteButton({ trip }: { trip: DisplayedTrip }) {
  const favouriteRoutes = useFavouriteRoutes();
  const { request } = trip;
  if (!request) return null;
  const { origin, destination } = request;
  const alreadySaved = favouriteRoutes.some(
    (route) => isSamePlace(route.origin, origin) && isSamePlace(route.destination, destination),
  );

  const save = () => {
    const outcome = writeOrAlert(
      () =>
        appStorage.favouriteRoutes.add({
          label: routeLabelFor(origin, destination),
          origin,
          destination,
        }),
      "Couldn't save this route",
    );
    if (!outcome.ok) return;
    if (outcome.value.status === 'limit-reached') {
      Alert.alert(
        'Too many saved routes',
        `You can save up to ${outcome.value.limit} routes. Delete one in Saved to add this one.`,
      );
      return;
    }
    AccessibilityInfo.announceForAccessibility('Route saved. Find it in Saved.');
  };

  return (
    <Button
      variant="secondary"
      symbol={alreadySaved ? 'star.fill' : 'star'}
      label={alreadySaved ? 'Route saved' : 'Save route'}
      disabled={alreadySaved}
      accessibilityHint={alreadySaved ? undefined : 'Adds this route to Saved for one-tap planning'}
      onPress={save}
    />
  );
}

function TripShortcuts({ trip }: { trip: DisplayedTrip }) {
  const { itinerary } = trip;
  return (
    <View style={styles.shortcuts}>
      <SaveRouteButton trip={trip} />
      {itinerary.strategy === 'park-and-ride' ? (
        <Button
          variant="secondary"
          symbol="parkingsign.circle"
          label="I parked here"
          accessibilityHint="Confirms where you left the car, for the trip home"
          onPress={() =>
            router.push({
              pathname: '/parked-car/confirm',
              params: { itineraryId: itinerary.id },
            })
          }
        />
      ) : null}
      {itinerary.strategy === 'drop-off' ? (
        <Button
          variant="secondary"
          symbol="figure.wave"
          label="I was dropped off"
          accessibilityHint="Records that someone else drove, so the trip home uses public transport"
          onPress={() =>
            router.push({
              pathname: '/parked-car/confirm',
              params: { itineraryId: itinerary.id, choice: 'dropped-off' },
            })
          }
        />
      ) : null}
    </View>
  );
}

export function ItineraryScreen({ itineraryId }: { itineraryId: string }) {
  const trip = useDisplayedTrip(itineraryId);
  const nowMs = useCurrentMinute();
  const startDriving = useStartDriving();
  const { height } = useWindowDimensions();

  if (!trip) return <TripNotFound />;

  const { itinerary } = trip;
  const lastLeg = itinerary.legs[itinerary.legs.length - 1];
  const legAlertIds = new Set(
    itinerary.legs
      .flatMap((leg) => (leg.kind === 'transit' ? leg.alerts : []))
      .map((alert) => alert.id),
  );
  const tripAlerts = itinerary.alerts.filter((alert) => !legAlertIds.has(alert.id));
  // Changes are set against the buffer this trip was planned with, as its parking and drop-off
  // steps are, not whatever Settings say now.
  const stepNotes = describeStepNotes(
    itinerary.legs,
    trip.request?.preferences.transferBufferMinutes ?? null,
  );
  const mapHeight = Math.round(
    Math.min(MAP_MAX_HEIGHT, Math.max(MAP_MIN_HEIGHT, height * MAP_SHARE_OF_WINDOW)),
  );

  return (
    <Screen footer={<TripFooter trip={trip} />} testID="itinerary-screen">
      <ActiveTripStatus trip={trip} nowMs={nowMs} />
      <TripSummaryCard itinerary={itinerary} />
      {itinerary.notes.map((note, index) => (
        <Banner key={`${index}:${note}`} tone="info" message={note} />
      ))}
      <TripMap
        itinerary={itinerary}
        interactive={false}
        style={[styles.map, { height: mapHeight }]}
      />
      <TripShortcuts trip={trip} />
      <AppText variant="title3" accessibilityRole="header" style={styles.heading}>
        Steps
      </AppText>
      {itinerary.legs.map((leg, index) => (
        // Leg ids come from providers and may repeat, so the position is part of the key.
        <LegRow
          key={`${index}:${leg.id}`}
          leg={leg}
          notes={stepNotes[index]}
          nowMs={nowMs}
          onStartDriving={(destination) => {
            void startDriving(destination);
          }}
        />
      ))}
      {lastLeg ? <ArrivalRow leg={lastLeg} /> : null}
      {tripAlerts.length > 0 ? (
        <>
          <AppText variant="title3" accessibilityRole="header" style={styles.heading}>
            Service alerts
          </AppText>
          {tripAlerts.map((alert) => (
            <AlertBanner key={alert.id} alert={alert} />
          ))}
        </>
      ) : null}
      <DataAttribution mode={trip.mode} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: {
    borderRadius: RADII.lg,
  },
  heading: {
    paddingTop: SPACING.md,
  },
  shortcuts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  following: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  followingText: {
    flexShrink: 1,
  },
});
