import { StyleSheet, View } from 'react-native';

import { Banner, Button } from '@/components';
import { openLocationSettings } from '@/location';
import { SPACING } from '@/theme';

import type { LocationAttempt } from './use-current-place';

export interface LocationNoticeProps {
  attempt: LocationAttempt;
  // Opens place search, so the person can type the place instead.
  onEnterPlace: () => void;
  enterPlaceLabel: string;
  onTryAgain?: () => void;
}

interface NoticeCopy {
  title: string;
  message: string;
  offersSettings: boolean;
  offersRetry: boolean;
}

function copyFor(attempt: LocationAttempt): NoticeCopy | null {
  switch (attempt.status) {
    case 'idle':
    case 'locating':
      return null;
    case 'denied':
      return {
        title: 'Location is off for HopReady',
        message: attempt.canAskAgain
          ? 'You can still plan: enter the place instead.'
          : 'You can still plan: enter the place instead, or allow location in Settings.',
        offersSettings: !attempt.canAskAgain,
        offersRetry: false,
      };
    case 'outside-coverage':
      return {
        title: "You're outside Greater Sydney",
        message: 'HopReady plans trips within Greater Sydney only. Enter a place there instead.',
        offersSettings: false,
        offersRetry: false,
      };
    case 'unavailable':
      return attempt.reason === 'services-disabled'
        ? {
            title: 'Location Services are off',
            message: 'Turn them on in Settings, or enter the place instead.',
            offersSettings: true,
            offersRetry: false,
          }
        : {
            title: "Couldn't find your location",
            message: 'Try again, or enter the place instead.',
            offersSettings: false,
            offersRetry: true,
          };
  }
}

function openSettings() {
  openLocationSettings().catch((error: unknown) => {
    console.warn(
      `HopReady: could not open Settings (${error instanceof Error ? error.name : 'unknown'}).`,
    );
  });
}

// Location is optional. When it cannot be used, this says why and keeps manual entry one tap away.
export function LocationNotice({
  attempt,
  onEnterPlace,
  enterPlaceLabel,
  onTryAgain,
}: LocationNoticeProps) {
  const copy = copyFor(attempt);
  if (!copy) return null;
  return (
    <View style={styles.container} testID="location-notice">
      <Banner tone="warning" title={copy.title} message={copy.message} announce />
      <View style={styles.actions}>
        <Button variant="secondary" label={enterPlaceLabel} onPress={onEnterPlace} />
        {copy.offersSettings ? (
          <Button
            variant="plain"
            label="Open Settings"
            onPress={openSettings}
            accessibilityHint="Opens HopReady's page in the Settings app"
          />
        ) : null}
        {copy.offersRetry && onTryAgain ? (
          <Button variant="plain" label="Try again" onPress={onTryAgain} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});
