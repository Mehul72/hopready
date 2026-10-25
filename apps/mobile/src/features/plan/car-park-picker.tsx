import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import type { CarParkStatus } from '@/api';
import { AppText, Card, EmptyState, ErrorState, ListRow, LoadingState } from '@/components';
import { useSavedParkingSpots } from '@/storage';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';
import { useCarParks } from '@/trip';

import { turnOnDemoMode } from './demo-mode';
import type { PreferredCarPark } from './plan-choices';

export interface CarParkPickerProps {
  selectedId: string | null;
  onSelect: (carPark: PreferredCarPark | null) => void;
}

interface Option {
  key: string;
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

function matches(carPark: CarParkStatus, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [carPark.name, carPark.stationName ?? ''].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

function byName(a: CarParkStatus, b: CarParkStatus): number {
  return a.name.localeCompare(b.name, 'en-AU');
}

// The chosen row shows a tick, and VoiceOver reads "selected" after its name.
function OptionsCard({ options }: { options: Option[] }) {
  const { colours } = useTheme();
  return (
    <Card padded={false} style={styles.card}>
      {options.map((option, index) => (
        <View key={option.key}>
          {index > 0 ? (
            <View style={[styles.separator, { backgroundColor: colours.separator }]} />
          ) : null}
          <ListRow
            title={option.title}
            subtitle={option.subtitle}
            leadingSymbol={option.selected ? 'checkmark.circle.fill' : 'circle'}
            onPress={option.onPress}
            accessibilityLabel={[option.title, option.subtitle, option.selected ? 'selected' : null]
              .filter(Boolean)
              .join(', ')}
          />
        </View>
      ))}
    </Card>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <AppText
      variant="subheadline"
      weight="semibold"
      tone="secondary"
      accessibilityRole="header"
      style={styles.heading}>
      {children}
    </AppText>
  );
}

function ParkAndRideCarParks({ selectedId, onSelect }: CarParkPickerProps) {
  const { colours } = useTheme();
  const carParks = useCarParks();
  const [filter, setFilter] = useState('');

  if (carParks.isError) {
    return (
      <ErrorState
        title="Couldn't load car parks"
        message={carParks.error.message}
        onRetry={
          carParks.error.kind === 'not-configured' ? undefined : () => void carParks.refetch()
        }
        retrying={carParks.isFetching}
        secondaryAction={
          carParks.error.suggestsDemoMode
            ? {
                label: 'Turn on demo mode',
                onPress: () => void turnOnDemoMode(),
                accessibilityHint: 'Lists sample car parks instead, labelled as demo',
              }
            : undefined
        }
        testID="car-parks-error"
      />
    );
  }
  if (!carParks.data) {
    return <LoadingState rows={3} accessibilityLabel="Loading car parks" />;
  }

  const listed = carParks.data.carParks.filter((carPark) => matches(carPark, filter)).sort(byName);
  return (
    <>
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Car park or station name"
        placeholderTextColor={colours.textSecondary}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Filter car parks"
        style={[
          styles.input,
          { color: colours.text, backgroundColor: colours.surface, borderColor: colours.border },
        ]}
        testID="car-park-filter"
      />
      {listed.length > 0 ? (
        <OptionsCard
          options={listed.map((carPark) => ({
            key: carPark.id,
            title: carPark.name,
            subtitle: carPark.stationName ?? undefined,
            selected: carPark.id === selectedId,
            onPress: () => onSelect({ id: carPark.id, name: carPark.name, kind: 'car-park' }),
          }))}
        />
      ) : (
        <EmptyState
          title="No car parks match"
          message="Try part of the car park or station name."
          symbol="magnifyingglass"
        />
      )}
    </>
  );
}

// Where the planner tries to park first: a spot the person saved, or a documented Transport
// Park&Ride car park. Saved spots are on the phone, so they stay listed when car parks cannot load.
export function CarParkPicker({ selectedId, onSelect }: CarParkPickerProps) {
  const spots = useSavedParkingSpots();
  return (
    <View style={styles.container} testID="car-park-picker">
      <OptionsCard
        options={[
          {
            key: 'none',
            title: 'No preferred car park',
            selected: selectedId === null,
            onPress: () => onSelect(null),
          },
        ]}
      />
      <Heading>Your parking spots</Heading>
      {spots.length > 0 ? (
        <OptionsCard
          options={spots.map((spot) => ({
            key: spot.id,
            title: spot.name,
            subtitle: 'Saved by you. Rules and spaces unknown.',
            selected: spot.id === selectedId,
            onPress: () => onSelect({ id: spot.id, name: spot.name, kind: 'saved-spot' }),
          }))}
        />
      ) : (
        <AppText variant="footnote" tone="secondary">
          Parking spots you add in Saved appear here.
        </AppText>
      )}
      <Heading>Park&Ride car parks</Heading>
      <ParkAndRideCarParks selectedId={selectedId} onSelect={onSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  heading: {
    paddingTop: SPACING.md,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 17,
  },
  card: {
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg,
  },
});
