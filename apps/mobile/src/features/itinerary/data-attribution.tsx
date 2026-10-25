import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { SPACING } from '@/theme';

export const TFNSW_ATTRIBUTION =
  'Public transport and car park data © Transport for NSW, CC BY 4.0';
export const APPLE_ATTRIBUTION = 'Maps and drive times © Apple Maps';
// Demo trips use real stop and car park details but made-up times, drives and space counts.
export const DEMO_ATTRIBUTION =
  'Sample times, drives and car park spaces for demo mode. Stop and car park details © Transport for NSW, CC BY 4.0. Map © Apple Maps';

// Data sources for a screen that shows a trip. Transport for NSW's licence (CC BY 4.0) requires the
// attribution, and Apple's terms require credit wherever Apple drive data appears.
export function DataAttribution({ mode }: { mode: 'live' | 'demo' }) {
  const lines = mode === 'demo' ? [DEMO_ATTRIBUTION] : [TFNSW_ATTRIBUTION, APPLE_ATTRIBUTION];
  return (
    <View style={styles.container} testID="data-attribution">
      {lines.map((line) => (
        <AppText key={line} variant="footnote" tone="secondary">
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.xxs,
    paddingTop: SPACING.md,
  },
});
