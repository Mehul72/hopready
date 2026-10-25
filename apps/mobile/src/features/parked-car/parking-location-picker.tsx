import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText, Banner, Button, ErrorState, LoadingState } from '@/components';
import { appStorage, useSavedParkingSpots } from '@/storage';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';
import { useCarParks } from '@/trip';

import { ChoiceRow } from '../settings/choice-row';
import { findCurrentPlace } from '../saved/current-location';
import { writeOrAlert } from '../saved/storage-writes';
import { choiceKey, type ParkingChoice, type SuggestedCarPark } from './parking-choice';

// Lists longer than this get a filter field.
const FILTER_FROM_COUNT = 8;

export interface ParkingLocationPickerProps {
  // The car park the trip planned to use. A suggestion only: the person still has to choose it.
  suggestion: SuggestedCarPark | null;
  selected: ParkingChoice | null;
  onSelect: (choice: ParkingChoice) => void;
  // Goes up each time the place is chosen outside this list, such as by moving a pin, so a
  // location lookup still running is dropped instead of overriding that choice.
  choicesMadeElsewhere?: number;
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
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

// The ways to say where the car is: the trip's suggestion, the current location, a spot the
// person saved, or any documented Park&Ride car park.
export function ParkingLocationPicker({
  suggestion,
  selected,
  onSelect,
  choicesMadeElsewhere = 0,
}: ParkingLocationPickerProps) {
  const spots = useSavedParkingSpots();
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [showsAllCarParks, setShowsAllCarParks] = useState(false);
  const selectedKey = selected ? choiceKey(selected) : null;
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

  const choose = (choice: ParkingChoice) => {
    locateRun.current += 1;
    setLocating(false);
    onSelect(choice);
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
    setLocationProblem(`${outcome.message} Choose a car park or saved spot instead.`);
  };

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
      {locationProblem ? <Banner tone="warning" message={locationProblem} announce /> : null}

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
      {showsAllCarParks ? (
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
