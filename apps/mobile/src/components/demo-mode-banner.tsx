import { SymbolView } from 'expo-symbols';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useShowsDemoData } from '@/state';
import { SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';
import { Banner } from './banner';

export const DEMO_BANNER_TITLE = 'Demo mode';
export const DEMO_BANNER_MESSAGE =
  'Trips, times and car park spaces are sample data, not live information.';

export interface DemoModeBannerProps {
  // 'window-top': the strip above every screen, drawn by the root layout under the status bar.
  // 'inline': a banner inside a modal sheet, which covers the strip.
  placement: 'window-top' | 'inline';
  // Spacing around the inline banner; it disappears with the banner in live mode.
  style?: StyleProp<ViewStyle>;
}

// Shown whenever sample data could be on screen. It renders nothing in live mode.
export function DemoModeBanner({ placement, style }: DemoModeBannerProps) {
  const showsDemoData = useShowsDemoData();
  const { colours } = useTheme();
  const insets = useSafeAreaInsets();
  if (!showsDemoData) return null;

  if (placement === 'inline') {
    return (
      <Banner tone="demo" title={DEMO_BANNER_TITLE} message={DEMO_BANNER_MESSAGE} style={style} />
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`}
      style={[styles.strip, { backgroundColor: colours.demo, paddingTop: insets.top }]}>
      <View style={styles.row}>
        <SymbolView name="testtube.2" tintColor={colours.onDemo} size={14} />
        <AppText variant="footnote" tone="onDemo" weight="semibold">
          {DEMO_BANNER_TITLE}
        </AppText>
        <AppText variant="footnote" tone="onDemo" style={styles.message}>
          Sample data, not live
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingBottom: SPACING.xs,
    paddingHorizontal: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: SPACING.xs,
    paddingTop: SPACING.xs,
  },
  message: {
    flexShrink: 1,
  },
});
