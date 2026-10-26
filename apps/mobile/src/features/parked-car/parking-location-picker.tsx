import type { Coordinate } from '@hopready/core';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Banner, Button, ErrorState, LoadingState } from '@/components';
import { appStorage, useSavedParkingSpots } from '@/storage';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';
import { useCarParks } from '@/trip';

import type { Wording } from '../itinerary/trip-text';
import { ChoiceRow } from '../settings/choice-row';
import { findCurrentPlace } from '../saved/current-location';
import { PlacePickerSheet } from '../saved/place-picker-sheet';
import { writeOrAlert } from '../saved/storage-writes';
import {
  choiceKey,
  type ParkingChoice,
  PINNED_LOCATION_NAME,
  type PlacedPin,
  pinPosition,
  type SuggestedCarPark,
  type TripPinStart,
} from './parking-choice';
import { PinDropMap } from './pin-drop-map';

// Lists longer than this get a filter field.
const FILTER_FROM_COUNT = 8;

export interface PinOption {
  // Where the trip expected the car to be left. Null when no trip says, so the person searches for
  // the street first.
  start: TripPinStart | null;
  // Where the person last put the pin. The screen keeps it, so trying another choice, or switching
  // to "I was dropped off" and back, never loses it.
  placed: PlacedPin | null;
  onPlace: (pin: PlacedPin) => void;
  // "Somewhere else" is chosen, but its pin waits to be moved, or a street searched for. The screen
  // keeps this, setting it when `onSelect` gets null, so the choice survives switching to "I was
  // dropped off" and back, and Save can say what it waits for.
  waiting: boolean;
}

export interface ParkingLocationPickerProps {
  // The car park the trip planned to use. A suggestion only: the person still has to choose it.
  suggestion: SuggestedCarPark | null;
  // Offers "Somewhere else", a pin on a map for a spot in none of the lists, such as a street near
  // a full car park. Without it, that choice is left out.
  pin?: PinOption;
  selected: ParkingChoice | null;
  // Null only while "Somewhere else" is chosen but its pin waits to be moved or searched for, so
  // there is nothing to save.
  onSelect: (choice: ParkingChoice | null) => void;
  // Goes up each time the place is chosen outside this list, such as by moving a pin, so a
  // location lookup still running is dropped instead of overriding that choice.
  choicesMadeElsewhere?: number;
  // How to use a pin the screen shows outside this picker, such as "Move the pin on the map".
  // Offered first when the location cannot be used, since a pin is then the only way left to give
  // a spot in none of the lists.
  pinElsewhere?: string;
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

function pinAt(coordinate: Coordinate): ParkingChoice {
  return { kind: 'pin', name: PINNED_LOCATION_NAME, coordinate };
}

// What choosing "Somewhere else" selects. A pin already put somewhere comes back where it was left.
// Unmoved at the trip's car park it is not saved: it would only repeat the suggestion under another
// name. Where a drive or ride ends, no other choice offers the spot, so the pin is saved as it is.
function somewhereElseChoice(pin: PinOption): ParkingChoice | null {
  if (pin.placed) return pinAt(pin.placed.coordinate);
  if (pin.start && !pin.start.atCarPark) return pinAt(pin.start.coordinate);
  return null;
}

// Before the pin is put anywhere: what "Somewhere else" offers, and once chosen, what to do next.
function unplacedPinText(pin: PinOption, chosen: boolean): string {
  if (!chosen) return 'Put a pin on a map where you parked.';
  if (!pin.start) return 'Search for where you parked, then move the pin to your car.';
  const next = pin.start.atCarPark
    ? 'Move it to where you parked.'
    : 'Move it if you parked elsewhere.';
  return `Pin at ${pin.start.name}. ${next}`;
}

// What "Somewhere else" says: where the pin is once the person has put it somewhere, or else what
// to do.
function somewhereElseWording(pin: PinOption, chosen: boolean): Wording {
  if (pin.placed) {
    const position = pinPosition(pin.placed.coordinate, pin.placed.from);
    return { text: `${position.text}.`, spoken: `${position.spoken}.` };
  }
  const text = unplacedPinText(pin, chosen);
  return { text, spoken: text };
}

interface SomewhereElseProps {
  pin: PinOption;
  chosen: boolean;
  onChoose: () => void;
  onPlace: (placed: PlacedPin) => void;
}

// "Somewhere else": a pin the person puts where the car is, moving it from where the trip expected
// the car, or from a street they search for when no trip says or the guess is far off.
function SomewhereElse({ pin, chosen, onChoose, onPlace }: SomewhereElseProps) {
  const [searching, setSearching] = useState(false);
  const [placesPicked, setPlacesPicked] = useState(0);
  const wording = somewhereElseWording(pin, chosen);
  const shown =
    pin.placed ?? (pin.start ? { coordinate: pin.start.coordinate, from: pin.start } : null);
  return (
    <>
      <ChoiceRow
        title="Somewhere else"
        subtitle={wording.text}
        accessibilityLabel={`Somewhere else, ${wording.spoken}`}
        selected={chosen}
        onPress={onChoose}
      />
      {chosen && shown ? (
        <PinDropMap
          // A place picked from the search re-centres the map; moving the pin by hand never does.
          key={placesPicked}
          coordinate={shown.coordinate}
          onMove={(coordinate) => onPlace({ coordinate, from: shown.from })}
        />
      ) : null}
      {chosen ? (
        <Button
          variant="secondary"
          label="Search for a street or place"
          symbol="magnifyingglass"
          accessibilityHint="Puts the pin at the place you choose"
          onPress={() => setSearching(true)}
        />
      ) : null}
      <PlacePickerSheet
        visible={searching}
        title="Where did you park?"
        allowCurrentLocation={false}
        onPick={(place) => {
          setSearching(false);
          setPlacesPicked((count) => count + 1);
          const from = { name: place.name, coordinate: place.coordinate };
          onPlace({ coordinate: place.coordinate, from });
        }}
        onClose={() => setSearching(false)}
      />
    </>
  );
}

function DocumentedCarParks({
  selectedKey,
  excludeId,
  onSelect,
}: {
  selectedKey: string | null;
  excludeId: string | null;
  onSelect: (choice: ParkingChoice) => void;
}) {
  const { colours } = useTheme();
  const carParks = useCarParks();
  const [filter, setFilter] = useState('');

  if (carParks.isPending) {
    return <LoadingState rows={3} accessibilityLabel="Loading Park&Ride car parks" />;
  }
  if (carParks.isError) {
    return (
      <ErrorState
        title="Couldn't load car parks"
        message={carParks.error.message}
        onRetry={() => {
          void carParks.refetch();
        }}
        retrying={carParks.isFetching}
        secondaryAction={
          carParks.error.suggestsDemoMode
            ? {
                label: 'Turn on demo mode',
                onPress: () => {
                  writeOrAlert(
                    () => appStorage.settings.setDemoMode(true),
                    "Couldn't turn on demo mode",
                  );
                },
              }
            : undefined
        }
      />
    );
  }

  const wanted = normalise(filter);
  const listed = carParks.data.carParks
    .filter((carPark) => carPark.id !== excludeId)
    .filter(
      (carPark) =>
        wanted === '' ||
        normalise(carPark.name).includes(wanted) ||
        normalise(carPark.stationName ?? '').includes(wanted),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'en-AU'));

  return (
    <View style={styles.group}>
      {carParks.data.carParks.length > FILTER_FROM_COUNT ? (
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter by car park or station"
          placeholderTextColor={colours.textSecondary}
          accessibilityLabel="Filter car parks"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[
            styles.input,
            { color: colours.text, borderColor: colours.border, backgroundColor: colours.surface },
          ]}
        />
      ) : null}
      {carParks.data.notices.map((notice) => (
        <Banner key={notice} tone="info" message={notice} />
      ))}
      {listed.length === 0 ? (
        <AppText tone="secondary">No car parks match that name.</AppText>
      ) : (
        listed.map((carPark) => (
          <ChoiceRow
            key={carPark.id}
            title={carPark.name}
            subtitle={carPark.stationName ?? undefined}
            selected={selectedKey === `car-park:${carPark.id}`}
            onPress={() =>
              onSelect({
                kind: 'car-park',
                carParkId: carPark.id,
                name: carPark.name,
                coordinate: carPark.coordinate,
                suggested: false,
              })
            }
          />
        ))
      )}
    </View>
  );
}

// The ways to say where the car is: the trip's suggestion, the current location, a pin, a spot
// the person saved, or any documented Park&Ride car park.
export function ParkingLocationPicker({
  suggestion,
  pin,
  selected,
  onSelect,
  choicesMadeElsewhere = 0,
  pinElsewhere,
}: ParkingLocationPickerProps) {
  const spots = useSavedParkingSpots();
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [showsAllCarParks, setShowsAllCarParks] = useState(false);
  const selectedKey = selected ? choiceKey(selected) : null;
  // A car park chosen from the full list keeps the list open, even when the picker comes back
  // after "I was dropped off", so what Save would store is always on screen and checked.
  const chosenFromList =
    selected?.kind === 'car-park' && selected.carParkId !== suggestion?.carParkId;
  // A position fix can take several seconds. A choice made meanwhile, or leaving the screen, makes
  // a late answer stale: it must never replace where the person said the car is.
  const locateRun = useRef(0);
  const latestLookup = useRef(0);

  useEffect(() => {
    const runs = locateRun;
    return () => {
      runs.current += 1;
    };
  }, []);

  useEffect(() => {
    locateRun.current += 1;
  }, [choicesMadeElsewhere]);

  const choose = (choice: ParkingChoice | null) => {
    locateRun.current += 1;
    setLocating(false);
    onSelect(choice);
  };

  const placePin = (option: PinOption, placed: PlacedPin) => {
    option.onPlace(placed);
    choose(pinAt(placed.coordinate));
    // The row's text changes as the pin moves, but VoiceOver does not read it again by itself.
    AccessibilityInfo.announceForAccessibility(
      `${pinPosition(placed.coordinate, placed.from).spoken}.`,
    );
  };

  const chooseCurrentLocation = async () => {
    locateRun.current += 1;
    const run = locateRun.current;
    latestLookup.current = run;
    setLocating(true);
    setLocationProblem(null);
    const outcome = await findCurrentPlace();
    if (run === latestLookup.current) setLocating(false);
    if (run !== locateRun.current) return;
    if (outcome.status === 'found') {
      onSelect({ kind: 'current-location', place: outcome.place });
      return;
    }
    setLocationProblem(outcome.message);
  };

  // Without the location, a pin is the only way left to give a spot in none of the lists, such as
  // a street near a full car park. Saved spots are offered only when the person has some.
  const lists = spots.length > 0 ? 'a car park or saved spot' : 'a car park';
  const pinWay = pin ? 'Choose Somewhere else to put a pin where you parked' : pinElsewhere;
  const otherWays = pinWay ? `${pinWay}, or choose ${lists}.` : `Choose ${lists} instead.`;

  return (
    <View style={styles.group}>
      {suggestion ? (
        <ChoiceRow
          title={suggestion.name}
          badge="Suggested by your trip"
          subtitle="Choose it only if this is where you parked."
          selected={selectedKey === `car-park:${suggestion.carParkId}`}
          onPress={() =>
            choose({
              kind: 'car-park',
              carParkId: suggestion.carParkId,
              name: suggestion.name,
              coordinate: suggestion.coordinate,
              suggested: true,
            })
          }
        />
      ) : null}

      <ChoiceRow
        title={locating ? 'Finding your location…' : 'Where I am now'}
        subtitle={
          selected?.kind === 'current-location'
            ? selected.place.name
            : 'Uses your location once, when you tap.'
        }
        selected={selectedKey === 'current-location'}
        disabled={locating}
        onPress={() => {
          void chooseCurrentLocation();
        }}
      />
      {locationProblem ? (
        <Banner tone="warning" message={`${locationProblem} ${otherWays}`} announce />
      ) : null}

      {pin ? (
        <SomewhereElse
          pin={pin}
          chosen={selectedKey === 'pin' || (pin.waiting && selected === null)}
          onChoose={() => choose(somewhereElseChoice(pin))}
          onPlace={(placed) => placePin(pin, placed)}
        />
      ) : null}

      {spots.length > 0 ? (
        <>
          <AppText variant="headline" accessibilityRole="header" style={styles.heading}>
            Your parking spots
          </AppText>
          {spots.map((spot) => (
            <ChoiceRow
              key={spot.id}
              title={spot.name}
              subtitle="Saved by you. Rules and spaces unknown."
              selected={selectedKey === `saved-spot:${spot.id}`}
              onPress={() => choose({ kind: 'saved-spot', spot })}
            />
          ))}
        </>
      ) : null}

      <AppText variant="headline" accessibilityRole="header" style={styles.heading}>
        Park&Ride car parks
      </AppText>
      {showsAllCarParks || chosenFromList ? (
        <DocumentedCarParks
          selectedKey={selectedKey}
          excludeId={suggestion?.carParkId ?? null}
          onSelect={choose}
        />
      ) : (
        <Button
          variant="secondary"
          label="Choose another car park"
          symbol="list.bullet"
          onPress={() => setShowsAllCarParks(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: SPACING.sm,
  },
  heading: {
    paddingTop: SPACING.md,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.md,
    fontSize: 17,
  },
});
