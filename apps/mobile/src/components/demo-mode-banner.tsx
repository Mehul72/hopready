import { SymbolView } from 'expo-symbols';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useShowsDemoData } from '@/state';
import { COMPACT_MAX_FONT_SCALE, RADII, SPACING, useTheme } from '@/theme';

import { AppText } from './app-text';
import { Banner } from './banner';

export const DEMO_BANNER_TITLE = 'Demo mode';
export const DEMO_BANNER_MESSAGE =
  'Trips, times and car park spaces are sample data, not live information.';

export interface DemoModeBannerProps {
  // 'window-top': the strip above every screen, drawn by the root layout under the status bar.
  // 'inline': a banner inside a modal sheet, which covers the strip.
  // 'compact': the strip's one line, for sheets with a fixed layout such as place search, where a
  // full banner at large text sizes would push the search field under the keyboard.
  placement: 'window-top' | 'inline' | 'compact';
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

  const compact = placement === 'compact';
  return (
    <View
      accessible
      accessibilityLabel={`${DEMO_BANNER_TITLE}. ${DEMO_BANNER_MESSAGE}`}
      style={[
        styles.strip,
        compact ? styles.compact : { paddingTop: insets.top },
        { backgroundColor: colours.demo },
        style,
      ]}>
      <View style={styles.row}>
        <SymbolView name="testtube.2" tintColor={colours.onDemo} size={14} />
        {/* Capped like a status bar: at the largest text sizes it would otherwise fill the screen. */}
        <AppText
          variant="footnote"
          tone="onDemo"
          weight="semibold"
          maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
          {DEMO_BANNER_TITLE}
        </AppText>
        <AppText
          variant="footnote"
          tone="onDemo"
          maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}
          style={styles.message}>
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
  compact: {
    borderRadius: RADII.md,
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
