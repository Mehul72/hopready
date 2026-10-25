import type { Place } from '@hopready/core';
import { type SFSymbol, SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, IconButton } from '@/components';
import type { SavedPlaces } from '@/storage';
import { MIN_TOUCH_TARGET, SPACING, useTheme } from '@/theme';

import type { PlaceField } from './plan-draft';
import { placeTitle } from './place-labels';

export const FIELD_NAMES: Readonly<Record<PlaceField, string>> = {
  origin: 'From',
  destination: 'To',
};

const PLACEHOLDERS: Readonly<Record<PlaceField, string>> = {
  origin: 'Choose a starting point',
  destination: 'Choose a destination',
};

const FIELD_SYMBOL_SIZE = 18;
const FIELD_SYMBOLS: Readonly<Record<PlaceField, SFSymbol>> = {
  origin: 'smallcircle.filled.circle',
  destination: 'mappin.circle.fill',
};

interface PlaceFieldRowProps {
  field: PlaceField;
  place: Place | null;
  saved: SavedPlaces;
  onPress: () => void;
}

function PlaceFieldRow({ field, place, saved, onPress }: PlaceFieldRowProps) {
  const { colours } = useTheme();
  const name = FIELD_NAMES[field];
  const title = place ? placeTitle(place, saved) : null;
  const spoken = title
    ? `${name}: ${[title.title, title.detail].filter(Boolean).join(', ')}`
    : `${name}: not chosen`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={`Opens search to choose the ${field === 'origin' ? 'starting point' : 'destination'}`}
      onPress={onPress}
      testID={`place-field-${field}`}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: colours.surfaceMuted } : null,
      ]}>
      <SymbolView name={FIELD_SYMBOLS[field]} tintColor={colours.brand} size={FIELD_SYMBOL_SIZE} />
      <View style={styles.texts}>
        <AppText variant="caption" tone="secondary">
          {name}
        </AppText>
        {title ? (
          <>
            <AppText weight="semibold">{title.title}</AppText>
            {title.detail ? (
              <AppText variant="footnote" tone="secondary">
                {title.detail}
              </AppText>
            ) : null}
          </>
        ) : (
          <AppText tone="secondary">{PLACEHOLDERS[field]}</AppText>
        )}
      </View>
    </Pressable>
  );
}

export interface PlaceFieldsProps {
  origin: Place | null;
  destination: Place | null;
  saved: SavedPlaces;
  onOpenField: (field: PlaceField) => void;
  onSwap: () => void;
}

export function PlaceFields({ origin, destination, saved, onOpenField, onSwap }: PlaceFieldsProps) {
  const { colours } = useTheme();
  return (
    <Card padded={false}>
      <View style={styles.container}>
        <View style={styles.fields}>
          <PlaceFieldRow
            field="origin"
            place={origin}
            saved={saved}
            onPress={() => onOpenField('origin')}
          />
          <View style={[styles.separator, { backgroundColor: colours.separator }]} />
          <PlaceFieldRow
            field="destination"
            place={destination}
            saved={saved}
            onPress={() => onOpenField('destination')}
          />
        </View>
        <IconButton
          symbol="arrow.up.arrow.down"
          accessibilityLabel="Swap From and To"
          onPress={onSwap}
          disabled={!origin && !destination}
          testID="swap-places"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: SPACING.sm,
  },
  fields: {
    flex: 1,
  },
  row: {
    minHeight: MIN_TOUCH_TARGET + SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  texts: {
    flex: 1,
    gap: SPACING.xxs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    // Lines up with the text, past the field's icon.
    marginLeft: SPACING.lg + FIELD_SYMBOL_SIZE + SPACING.md,
  },
});
