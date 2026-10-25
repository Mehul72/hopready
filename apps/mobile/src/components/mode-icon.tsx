import { SymbolView } from 'expo-symbols';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { LEG_VISUALS, type LegVisualKind, SPACING, type TextVariant, useTheme } from '@/theme';

import { AppText } from './app-text';

export interface ModeIconProps {
  mode: LegVisualKind;
  size?: number;
  // Shows the mode's name next to the icon. Without it the name is still spoken by VoiceOver.
  showLabel?: boolean;
  labelVariant?: TextVariant;
  // A more specific spoken name, such as "Metro M1", in place of the plain mode name.
  accessibilityLabel?: string;
  testID?: string;
}

// Icons scale with Dynamic Type alongside the text they sit next to.
const MAX_ICON_SCALE = 2;

// A transport mode as an SF Symbol in its mode colour. The colour is never the only cue: the
// symbol differs per mode and the name is always spoken.
export function ModeIcon({
  mode,
  size = 20,
  showLabel = false,
  labelVariant = 'subheadline',
  accessibilityLabel,
  testID,
}: ModeIconProps) {
  const { modeColours } = useTheme();
  const { fontScale } = useWindowDimensions();
  const visual = LEG_VISUALS[mode];
  const colour = modeColours[mode];
  const scaledSize = size * Math.min(Math.max(fontScale, 1), MAX_ICON_SCALE);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? visual.label}
      testID={testID}
      style={styles.row}>
      <SymbolView name={visual.symbol} tintColor={colour} size={scaledSize} />
      {showLabel ? (
        <AppText variant={labelVariant} colour={colour} weight="semibold">
          {visual.label}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
});
