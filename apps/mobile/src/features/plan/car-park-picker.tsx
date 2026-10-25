import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import type { CarParkStatus } from '@/api';
import { Card, EmptyState, ErrorState, ListRow, LoadingState } from '@/components';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';
import { useCarParks } from '@/trip';

import { turnOnDemoMode } from './demo-mode';
import type { PreferredCarPark } from './plan-choices';

export interface CarParkPickerProps {
  selectedId: string | null;
  onSelect: (carPark: PreferredCarPark | null) => void;
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

// The documented Transport Park&Ride car parks, to pick one the planner tries first.
export function CarParkPicker({ selectedId, onSelect }: CarParkPickerProps) {
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
    <View style={styles.container} testID="car-park-picker">
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
      <Card padded={false} style={styles.card}>
        <ListRow
          title="No preferred car park"
          leadingSymbol={selectedId === null ? 'checkmark.circle.fill' : 'circle'}
          onPress={() => onSelect(null)}
          accessibilityLabel={`No preferred car park${selectedId === null ? ', selected' : ''}`}
        />
        {listed.map((carPark) => {
          const selected = carPark.id === selectedId;
          return (
            <View key={carPark.id}>
              <View style={[styles.separator, { backgroundColor: colours.separator }]} />
              <ListRow
                title={carPark.name}
                subtitle={carPark.stationName ?? undefined}
                leadingSymbol={selected ? 'checkmark.circle.fill' : 'circle'}
                onPress={() => onSelect({ id: carPark.id, name: carPark.name })}
                accessibilityLabel={[
                  carPark.name,
                  carPark.stationName,
                  selected ? 'selected' : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
              />
            </View>
          );
        })}
      </Card>
      {listed.length === 0 ? (
        <EmptyState
          title="No car parks match"
          message="Try part of the car park or station name."
          symbol="magnifyingglass"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
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
