import type { SFSymbol } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { AppText, Chip } from '@/components';
import { SPACING } from '@/theme';

import type { TravelAccess } from './plan-choices';

export interface AccessChoicesProps {
  access: TravelAccess;
  onChange: (change: Partial<TravelAccess>) => void;
}

interface AccessOption {
  key: keyof TravelAccess;
  label: string;
  symbol: SFSymbol;
  hint: string;
}

const ACCESS_OPTIONS: readonly AccessOption[] = [
  {
    key: 'transit',
    label: 'Public transport',
    symbol: 'tram.fill',
    hint: 'Includes trains, metro, buses, ferries and light rail',
  },
  {
    key: 'drive',
    label: "I'll drive and park",
    symbol: 'car.fill',
    hint: 'Includes driving to a Park&Ride car park, or driving all the way',
  },
  {
    key: 'dropOff',
    label: 'Someone will drop me off',
    symbol: 'figure.wave',
    hint: 'Includes a lift to a station, then public transport',
  },
];

export function AccessChoices({ access, onChange }: AccessChoicesProps) {
  return (
    <View style={styles.container}>
      <AppText variant="footnote" tone="secondary">
        Ways to travel
      </AppText>
      <View style={styles.chips}>
        {ACCESS_OPTIONS.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            symbol={option.symbol}
            selected={access[option.key]}
            onToggle={(selected) => onChange({ [option.key]: selected })}
            accessibilityHint={option.hint}
            testID={`access-${option.key}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
});
