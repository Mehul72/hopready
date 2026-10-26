import { toIso } from '@hopready/core';
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
  itineraryFollowedToday,
  parkedCarFrom,
  parkedCarName,
  type ParkingChoice,
  type PlacedPin,
  pinStartOf,
  suggestedCarParkOf,
  type TripPinStart,
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

// What a dimmed Save waits for, as VoiceOver says it. With "Somewhere else" chosen, the pin has to
// be moved off the trip's car park, or with no trip, a street searched for.
function saveHint(pinWaiting: boolean, pinStart: TripPinStart | null): string {
  if (!pinWaiting) return 'Choose where you parked first';
  return pinStart ? 'Move the pin to where you parked first' : 'Search for where you parked first';
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
  // A pin for a spot in none of the lists starts where the trip expected the car to be left.
  const pinStart = pinStartOf(itinerary);
  const [arrival, setArrival] = useState<ArrivalKind>(initialArrival);
  const [choice, setChoice] = useState<ParkingChoice | null>(null);
  // "Somewhere else" is chosen, but its pin waits to be moved, or a street searched for.
  const [pinWaiting, setPinWaiting] = useState(false);
  const [placedPin, setPlacedPin] = useState<PlacedPin | null>(null);
  const canSave = arrival === 'dropped-off' || choice !== null;

  const select = (next: ParkingChoice | null) => {
    setChoice(next);
    // The picker chooses nothing only for "Somewhere else" with nothing to save yet.
    setPinWaiting(next === null);
  };

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
          accessibilityHint={canSave ? undefined : saveHint(pinWaiting, pinStart)}
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
            pin={{ start: pinStart, placed: placedPin, waiting: pinWaiting, onPlace: setPlacedPin }}
            selected={choice}
            onSelect={select}
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
