import { ActionSheetIOS } from 'react-native';

import { Button } from '@/components';

import { RESULT_ORDER_LABELS, type ResultOrder } from './itinerary-order';

export interface SortMenuProps {
  orders: readonly ResultOrder[];
  value: ResultOrder;
  onChange: (order: ResultOrder) => void;
}

export const SORT_MENU_TITLE = 'Sort by';

// One small button naming the current order, which opens the system sheet to change it. The list
// itself stays free of controls, the way Apple Maps and Google Maps keep theirs.
export function SortMenu({ orders, value, onChange }: SortMenuProps) {
  function open() {
    const labels = orders.map((order) => RESULT_ORDER_LABELS[order]);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: SORT_MENU_TITLE,
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
        // The current order is already in force, so choosing it again does nothing.
        disabledButtonIndices: [orders.indexOf(value)],
      },
      (index) => {
        const order = orders[index];
        if (order !== undefined && order !== value) onChange(order);
      },
    );
  }

  return (
    <Button
      variant="plain"
      symbol="arrow.up.arrow.down"
      label={RESULT_ORDER_LABELS[value]}
      onPress={open}
      accessibilityLabel={`${SORT_MENU_TITLE}: ${RESULT_ORDER_LABELS[value]}`}
      accessibilityHint="Changes the order of the options"
      testID="sort-menu"
    />
  );
}
