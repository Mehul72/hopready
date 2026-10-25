import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, EmptyState, Screen, TripMap } from '@/components';
import { appStorage, type ParkedCarState, useParkedCar } from '@/storage';
import { RADII, SPACING } from '@/theme';

import { useCurrentMinute } from '../itinerary/use-current-minute';
import { writeOrAlert } from '../saved/storage-writes';
import { removeParkedCar } from './correct-parking-screen';
import { describeWhen, parkedCarName } from './parking-choice';
import { TakeMeHomeButton } from './take-me-home-button';

const MAP_HEIGHT = 220;

function ParkedCarView({ state }: { state: Extract<ParkedCarState, { status: 'parked' }> }) {
  const nowMs = useCurrentMinute();
  const name = parkedCarName(state);
  const confirmed = `Confirmed ${describeWhen(state.parkedCar.confirmedAt, nowMs)}`;
  return (
    <>
      <TripMap
        points={[
          {
            id: 'parked-car',
            kind: 'parked-car',
            coordinate: state.parkedCar.location.coordinate,
            label: name,
          },
        ]}
        accessibilityLabel={`Map showing your car at ${name}.`}
        style={styles.map}
      />
      <Card testID="parked-car">
        <View
          accessible
          accessibilityLabel={`Your car is at ${name}. ${confirmed}.`}
          style={styles.texts}>
          <AppText variant="footnote" tone="secondary" weight="semibold">
            Your car
          </AppText>
          <AppText variant="title2">{name}</AppText>
          <AppText tone="secondary">{confirmed}</AppText>
        </View>
      </Card>
      <TakeMeHomeButton parkedCar={state} />
      <View style={styles.secondaryActions}>
        <Button
          variant="secondary"
          symbol="mappin.and.ellipse"
          label="Correct location"
          onPress={() => router.push('/parked-car/correct')}
        />
        <Button
          variant="plain"
          label="Remove"
          accessibilityLabel="Remove parked car"
          onPress={() => removeParkedCar()}
        />
      </View>
    </>
  );
}

function clearDropOff() {
  Alert.alert('Clear the drop-off?', 'Take me home will no longer assume your car is elsewhere.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Clear',
      style: 'destructive',
      onPress: () => {
        writeOrAlert(() => appStorage.parkedCar.clear(), "Couldn't clear the drop-off");
      },
    },
  ]);
}

function DroppedOffView({ state }: { state: Extract<ParkedCarState, { status: 'dropped-off' }> }) {
  const nowMs = useCurrentMinute();
  const when = describeWhen(state.at, nowMs);
  const note = "Take me home plans public transport only, because your car isn't with you.";
  return (
    <>
      <Card testID="dropped-off">
        <View
          accessible
          accessibilityLabel={`You were dropped off, ${when}. ${note}`}
          style={styles.texts}>
          <AppText variant="title2">You were dropped off</AppText>
          <AppText tone="secondary">{`Saved ${when}`}</AppText>
          <AppText>{note}</AppText>
        </View>
      </Card>
      <TakeMeHomeButton parkedCar={state} />
      <View style={styles.secondaryActions}>
        <Button
          variant="secondary"
          label="I drove after all"
          onPress={() => router.push('/parked-car/confirm')}
        />
        <Button
          variant="plain"
          label="Clear"
          accessibilityLabel="Clear the drop-off"
          onPress={clearDropOff}
        />
      </View>
    </>
  );
}

// Where the car is, and the way home through it.
export function CarScreen() {
  const parkedCar = useParkedCar();
  return (
    <Screen testID="car-screen">
      <AppText variant="largeTitle" accessibilityRole="header">
        Car
      </AppText>
      {parkedCar.status === 'parked' ? <ParkedCarView state={parkedCar} /> : null}
      {parkedCar.status === 'dropped-off' ? <DroppedOffView state={parkedCar} /> : null}
      {parkedCar.status === 'none' ? (
        <EmptyState
          symbol="car"
          title="No parked car saved"
          message="After you park, tap I parked here on your trip, or tell HopReady where you left the car. Take me home then plans your way back through it."
          action={{
            label: 'Tell HopReady where you parked',
            onPress: () => router.push('/parked-car/confirm'),
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: {
    height: MAP_HEIGHT,
    borderRadius: RADII.lg,
  },
  texts: {
    gap: SPACING.xs,
  },
  secondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});
