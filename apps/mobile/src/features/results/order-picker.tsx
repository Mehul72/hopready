import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';

import { RESULT_ORDER_LABELS, type ResultOrder } from './itinerary-order';

export interface OrderPickerProps {
  orders: readonly ResultOrder[];
  value: ResultOrder;
  onChange: (order: ResultOrder) => void;
}

const GROUP_LABEL = 'Sort by';

// Radio buttons that wrap onto more lines at large text sizes, where a segmented control would
// squeeze four labels into unreadable slivers. Selection shows a tick and a thicker outline.
export function OrderPicker({ orders, value, onChange }: OrderPickerProps) {
  const { colours } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={GROUP_LABEL} style={styles.group}>
      <AppText variant="footnote" tone="secondary" importantForAccessibility="no">
        {GROUP_LABEL}
      </AppText>
      <View style={styles.options}>
        {orders.map((order, index) => {
          const selected = order === value;
          return (
            <Pressable
              key={order}
              accessibilityRole="radio"
              accessibilityLabel={RESULT_ORDER_LABELS[order]}
              accessibilityHint={`${GROUP_LABEL}, ${index + 1} of ${orders.length}`}
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (!selected) onChange(order);
              }}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: selected ? colours.brandSoft : colours.surface,
                  borderColor: selected ? colours.brand : colours.border,
                  borderWidth: selected ? 2 : 1,
                },
                pressed && !selected ? styles.pressed : null,
              ]}>
              {selected ? (
                <SymbolView name="checkmark" tintColor={colours.onBrandSoft} size={14} />
              ) : null}
              <AppText
                variant="subheadline"
                tone={selected ? 'onBrandSoft' : 'primary'}
                weight={selected ? 'semibold' : 'regular'}>
                {RESULT_ORDER_LABELS[order]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: SPACING.xs,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.md,
  },
  pressed: {
    opacity: 0.6,
  },
});
