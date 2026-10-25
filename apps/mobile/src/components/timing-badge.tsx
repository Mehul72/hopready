import type { Timing } from '@hopready/core';
import { type SFSymbol, SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { COMPACT_MAX_FONT_SCALE, type ColourTokens, RADII, SPACING, useTheme } from '@/theme';

import { AppText, colourForTone, type TextTone } from './app-text';

export interface TimingBadgeProps {
  timing: Timing;
  // A demo-mode time: a "realtime" one is shown as sample data, never as "Live".
  sample?: boolean;
  testID?: string;
}

interface TimingStyle {
  label: string;
  spoken: string;
  symbol: SFSymbol;
  background: keyof ColourTokens;
  tone: TextTone;
}

// Says how much to trust a time. Only TfNSW realtime legs are "Live"; everything else is
// labelled for what it is.
export const TIMING_STYLES: Readonly<Record<Timing, TimingStyle>> = {
  realtime: {
    label: 'Live',
    spoken: 'Live time from the operator',
    symbol: 'dot.radiowaves.left.and.right',
    background: 'successSoft',
    tone: 'onSuccessSoft',
  },
  scheduled: {
    label: 'Timetable',
    spoken: 'Timetable time, not live',
    symbol: 'calendar',
    background: 'surfaceMuted',
    tone: 'secondary',
  },
  estimated: {
    label: 'Estimate',
    spoken: 'Estimated time',
    symbol: 'speedometer',
    background: 'infoSoft',
    tone: 'onInfoSoft',
  },
  buffer: {
    label: 'Your buffer',
    spoken: 'Buffer time you set in preferences',
    symbol: 'hourglass',
    background: 'surfaceMuted',
    tone: 'secondary',
  },
};

// Demo mode replays a made-up live feed. It wears the demo colours so it cannot pass for the real one.
export const SAMPLE_REALTIME_STYLE: TimingStyle = {
  label: 'Sample live',
  spoken: 'Sample time, not live',
  symbol: 'testtube.2',
  background: 'demo',
  tone: 'onDemo',
};

export function timingStyleFor(timing: Timing, sample = false): TimingStyle {
  return sample && timing === 'realtime' ? SAMPLE_REALTIME_STYLE : TIMING_STYLES[timing];
}

export function TimingBadge({ timing, sample = false, testID }: TimingBadgeProps) {
  const { colours } = useTheme();
  const style = timingStyleFor(timing, sample);
  const foreground = colourForTone(colours, style.tone);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={style.spoken}
      testID={testID}
      style={[styles.badge, { backgroundColor: colours[style.background] }]}>
      <SymbolView name={style.symbol} tintColor={foreground} size={12} />
      <AppText
        variant="caption"
        tone={style.tone}
        weight="semibold"
        maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
        {style.label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xxs,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
  },
});
