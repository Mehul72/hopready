import { Image, StyleSheet, View } from 'react-native';

import { SPACING } from '@/theme';

import { AppText } from './app-text';

export function BrandSignature() {
  return (
    <View style={styles.row} accessible accessibilityLabel="HopReady, Greater Sydney">
      <Image
        source={require('../../assets/brand/icon-1024.png')}
        style={styles.mark}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
      <AppText variant="headline" style={styles.name}>
        HopReady
      </AppText>
      <AppText variant="footnote" tone="secondary" style={styles.region}>
        Greater Sydney
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm },
  mark: { width: 32, height: 32, borderRadius: 10 },
  name: { letterSpacing: -0.4 },
  region: { marginLeft: 'auto' },
});
