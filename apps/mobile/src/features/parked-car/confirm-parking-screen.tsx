import { type Coordinate, toIso } from '@hopready/core';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, Screen, SegmentedControl } from '@/components';
import { appStorage, useActiveTrip, useParkedCar } from '@/storage';
import { SPACING } from '@/theme';

import { useCurrentMinute } from '../itinerary/use-current-minute';
import { useDisplayedTrip } from '../itinerary/use-displayed-trip';
import { writeOrAlert } from '../saved/storage-writes';
import { closeParkingSheet } from './close-sheet';
import {
  driveEndOf,
  itineraryFollowedToday,
  parkedCarFrom,
  parkedCarName,
  type ParkingChoice,
  suggestedCarParkOf,
} from './parking-choice';
import { ParkingLocationPicker } from './parking-location-picker';

export type ArrivalKind = 'parked' | 'dropped-off';

const ARRIVAL_OPTIONS = [
  { value: 'parked', label: 'I parked my car' },
  { value: 'dropped-off', label: 'I was dropped off' },
] as const;

export interface ConfirmParkingScreenProps {
  // The trip the person followed, for its car park suggestion.
  itineraryId: string | null;
  initialArrival: ArrivalKind;
}

function ReplacesEarlierNotice() {
  const parkedCar = useParkedCar();
  if (parkedCar.status === 'none') return null;
  const earlier =
    parkedCar.status === 'parked'
      ? `your car at ${parkedCarName(parkedCar)}`
      : 'that you were dropped off';
  return <Banner tone="info" message={`This replaces what you saved before: ${earlier}.`} />;
}

// Where the car really is, as the person says. "Take me home" routes back through exactly this.
export function ConfirmParkingScreen({ itineraryId, initialArrival }: ConfirmParkingScreenProps) {
  const trip = useDisplayedTrip(itineraryId ?? '');
  const followedToday = itineraryFollowedToday(useActiveTrip(), useCurrentMinute());
  // Opened without a trip (from the Car tab), the trip followed today is the best guess.
  const itinerary = trip?.itinerary ?? followedToday;
  const suggestion = suggestedCarParkOf(itinerary);
  // A pin for a spot in none of the lists starts where the trip expected to leave the car.
  const pinStart = suggestion?.coordinate ?? driveEndOf(itinerary);
  const [arrival, setArrival] = useState<ArrivalKind>(initialArrival);
  const [choice, setChoice] = useState<ParkingChoice | null>(null);
  const [placedPin, setPlacedPin] = useState<Coordinate | null>(null);
  const canSave = arrival === 'dropped-off' || choice !== null;

  const save = () => {
    const confirmedAt = toIso(new Date());
    if (arrival === 'dropped-off') {
      const saved = writeOrAlert(
        () => appStorage.parkedCar.markDroppedOff(confirmedAt),
        "Couldn't save that you were dropped off",
      );
      if (!saved.ok) return;
      AccessibilityInfo.announceForAccessibility(
        'Saved. Take me home will use public transport only.',
      );
      closeParkingSheet();
      return;
    }
    if (!choice) return;
    const record = parkedCarFrom(choice, confirmedAt);
    const saved = writeOrAlert(
      () => appStorage.parkedCar.markParked(record.parkedCar, record.carParkName),
      "Couldn't save where you parked",
    );
    if (!saved.ok) return;
    AccessibilityInfo.announceForAccessibility('Saved where you parked.');
    closeParkingSheet();
  };

  return (
    <Screen
      testID="confirm-parking"
      footer={
        <Button
          label={arrival === 'parked' ? 'Save where I parked' : 'Save that I was dropped off'}
          fullWidth
          disabled={!canSave}
          accessibilityHint={canSave ? undefined : 'Choose where you parked first'}
          onPress={save}
        />
      }>
      <SegmentedControl
        accessibilityLabel="How you got here"
        options={ARRIVAL_OPTIONS}
        value={arrival}
        onChange={setArrival}
      />
      <ReplacesEarlierNotice />
      {arrival === 'parked' ? (
        <View style={styles.section}>
          <AppText variant="title3" accessibilityRole="header">
            Where is your car?
          </AppText>
          <AppText tone="secondary">
            Take me home plans your way back to the spot you choose here.
          </AppText>
          <ParkingLocationPicker
            suggestion={suggestion}
            pin={
              pinStart ? { start: pinStart, placed: placedPin, onPlace: setPlacedPin } : undefined
            }
            selected={choice}
            onSelect={setChoice}
          />
        </View>
      ) : (
        <View style={styles.section}>
          <AppText variant="title3" accessibilityRole="header">
            Someone else drove
          </AppText>
          <AppText tone="secondary">
            Take me home will plan public transport only, because your car isn&apos;t with you.
          </AppText>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
  },
});
