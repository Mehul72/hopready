import type { Place } from '@hopready/core';
import { type SFSymbol, SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Card, IconButton } from '@/components';
import type { SavedPlaces } from '@/storage';
import { MIN_TOUCH_TARGET, SPACING, STACKED_LAYOUT_FONT_SCALE, useTheme } from '@/theme';

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
  const { fontScale } = useWindowDimensions();
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
      {fontScale < STACKED_LAYOUT_FONT_SCALE ? (
        <View
          style={[
            styles.symbol,
            { backgroundColor: field === 'destination' ? colours.brandSoft : colours.surfaceMuted },
          ]}>
          <SymbolView
            name={FIELD_SYMBOLS[field]}
            tintColor={field === 'destination' ? colours.brand : colours.textSecondary}
            size={FIELD_SYMBOL_SIZE}
          />
        </View>
      ) : null}
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
          <AppText
            tone={field === 'destination' ? 'primary' : 'secondary'}
            weight={field === 'destination' ? 'semibold' : 'regular'}>
            {PLACEHOLDERS[field]}
          </AppText>
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
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACKED_LAYOUT_FONT_SCALE;
  return (
    <Card padded={false}>
      <View style={[styles.container, stacked ? styles.stackedContainer : null]}>
        <View style={[styles.fields, stacked ? styles.stackedFields : null]}>
          <PlaceFieldRow
            field="origin"
            place={origin}
            saved={saved}
            onPress={() => onOpenField('origin')}
          />
          <View
            style={[
              styles.separator,
              stacked ? { marginLeft: SPACING.lg } : null,
              { backgroundColor: colours.separator },
            ]}
          />
          <PlaceFieldRow
            field="destination"
            place={destination}
            saved={saved}
            onPress={() => onOpenField('destination')}
          />
        </View>
        <View style={stacked ? styles.stackedSwap : undefined}>
          <IconButton
            symbol="arrow.up.arrow.down"
            accessibilityLabel="Swap From and To"
            onPress={onSwap}
            disabled={!origin && !destination}
            testID="swap-places"
          />
        </View>
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
  stackedContainer: {
    flexDirection: 'column',
    paddingRight: 0,
  },
  stackedFields: {
    flex: 0,
    width: '100%',
  },
  stackedSwap: {
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  row: {
    minHeight: MIN_TOUCH_TARGET + SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  symbol: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    gap: SPACING.xxs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    // Lines up with the text, past the field's icon.
    marginLeft: SPACING.lg + 34 + SPACING.md,
  },
});
