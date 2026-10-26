import { type Coordinate, haversineMetres } from '@hopready/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState, Screen } from '@/components';
import { appStorage, type ParkedCarState, useActiveTrip, useParkedCar } from '@/storage';
import { SPACING } from '@/theme';

import { useCurrentMinute } from '../itinerary/use-current-minute';
import { writeOrAlert } from '../saved/storage-writes';
import { closeParkingSheet } from './close-sheet';
import {
  choiceCoordinate,
  choiceKey,
  itineraryFollowedToday,
  parkedCarFrom,
  parkedCarName,
  type ParkingChoice,
  PINNED_LOCATION_NAME,
  pinOriginOf,
  pinPosition,
  suggestedCarParkOf,
} from './parking-choice';
import { ParkingLocationPicker } from './parking-location-picker';
import { PinDropMap } from './pin-drop-map';

type ParkedState = Extract<ParkedCarState, { status: 'parked' }>;

// A pin moved this little is a nudge within the same car park or street, so it keeps its name.
const SAME_SPOT_METRES = 300;

// `onRemoved` runs after a successful removal, for screens that should then close.
export function removeParkedCar(onRemoved?: () => void): void {
  Alert.alert('Remove your parked car?', 'Take me home will no longer route you back to it.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: () => {
        const removed = writeOrAlert(
          () => appStorage.parkedCar.clear(),
          "Couldn't remove your parked car",
        );
        if (!removed.ok) return;
        AccessibilityInfo.announceForAccessibility('Parked car removed.');
        onRemoved?.();
      },
    },
  ]);
}

function CorrectParkedCar({ state }: { state: ParkedState }) {
  const original = state.parkedCar.location.coordinate;
  // The car park of the trip followed today, unless that is already where the car is saved.
  const tripCarPark = suggestedCarParkOf(
    itineraryFollowedToday(useActiveTrip(), useCurrentMinute()),
  );
  const suggestion = tripCarPark?.carParkId === state.parkedCar.carParkId ? null : tripCarPark;
  const [choice, setChoice] = useState<ParkingChoice | null>(null);
  // The place last chosen from the list. A pin moved by hand afterwards started there, not where
  // the car is saved.
  const [lastListed, setLastListed] = useState<ParkingChoice | null>(null);
  const [pinMoves, setPinMoves] = useState(0);
  const pin = choice ? choiceCoordinate(choice) : original;
  const pinOrigin = pinOriginOf(lastListed, state);
  const pinWording = choice?.kind === 'pin' ? pinPosition(choice.coordinate, pinOrigin) : null;
  // Choosing a listed place re-centres the map on it; moving the pin by hand never does.
  const mapKey = choice && choice.kind !== 'pin' ? choiceKey(choice) : 'pin';

  const chooseListed = (listed: ParkingChoice | null) => {
    setChoice(listed);
    if (listed) setLastListed(listed);
  };

  const movePin = (coordinate: Coordinate) => {
    const nearOrigin = haversineMetres(coordinate, pinOrigin.coordinate) <= SAME_SPOT_METRES;
    setPinMoves((count) => count + 1);
    setChoice({
      kind: 'pin',
      coordinate,
      name: nearOrigin ? pinOrigin.keptName : PINNED_LOCATION_NAME,
    });
    // VoiceOver hears where the pin went after every move, without having to find the text under
    // the map.
    AccessibilityInfo.announceForAccessibility(`${pinPosition(coordinate, pinOrigin).spoken}.`);
  };

  const save = () => {
    if (!choice) return;
    // The car has been there since it was first confirmed; only the place changes.
    const record = parkedCarFrom(choice, state.parkedCar.confirmedAt);
    const saved = writeOrAlert(
      () => appStorage.parkedCar.markParked(record.parkedCar, record.carParkName),
      "Couldn't save the new location",
    );
    if (!saved.ok) return;
    AccessibilityInfo.announceForAccessibility('Saved the new location of your car.');
    closeParkingSheet();
  };

  return (
    <Screen
      testID="correct-parking"
      footer={
        <Button
          label="Save new location"
          fullWidth
          disabled={!choice}
          accessibilityHint={choice ? undefined : 'Move the pin or choose a place first'}
          onPress={save}
        />
      }>
      <AppText tone="secondary">{`Saved now: ${parkedCarName(state)}`}</AppText>
      <PinDropMap key={mapKey} coordinate={pin} onMove={movePin} />
      {pinWording ? (
        <AppText accessibilityLabel={`${pinWording.spoken}.`}>{`${pinWording.text}.`}</AppText>
      ) : null}
      <View style={styles.section}>
        <AppText variant="title3" accessibilityRole="header">
          Or choose a place
        </AppText>
        <ParkingLocationPicker
          suggestion={suggestion}
          selected={choice?.kind === 'pin' ? null : choice}
          onSelect={chooseListed}
          choicesMadeElsewhere={pinMoves}
          pinElsewhere="Move the pin on the map"
        />
      </View>
      <View style={styles.remove}>
        <Button
          variant="destructive"
          label="Remove parked car"
          onPress={() => removeParkedCar(closeParkingSheet)}
        />
      </View>
    </Screen>
  );
}

// Change where the car is, or forget it.
export function CorrectParkingScreen() {
  const parkedCar = useParkedCar();
  if (parkedCar.status === 'parked') {
    return <CorrectParkedCar key={parkedCar.parkedCar.confirmedAt} state={parkedCar} />;
  }
  return (
    <Screen testID="correct-parking">
      {parkedCar.status === 'dropped-off' ? (
        <EmptyState
          symbol="figure.wave"
          title="You were dropped off"
          message="There's no car to move. If you drove after all, tell HopReady where you parked."
          action={{
            label: 'I parked my car',
            onPress: () => router.replace('/parked-car/confirm'),
          }}
        />
      ) : (
        <EmptyState
          symbol="car"
          title="No parked car"
          message="There's nothing to correct yet. Tell HopReady where you parked instead."
          action={{
            label: 'Tell HopReady where you parked',
            onPress: () => router.replace('/parked-car/confirm'),
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
  },
  remove: {
    paddingTop: SPACING.xl,
    alignItems: 'flex-start',
  },
});
