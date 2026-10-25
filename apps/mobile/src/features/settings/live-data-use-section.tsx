import { router } from 'expo-router';

import { isLivePlanningConfigured } from '@/api';
import { ListRow } from '@/components';
import { hasLiveDataConsent, useSettings } from '@/storage';

import { SettingsSection } from './settings-section';

// The explanation of what live mode sends, and the place to withdraw agreement (the data-use
// screen). A build without a live API sends nothing, so it has nothing to explain.
export function LiveDataUseSection({
  livePlanningConfigured = isLivePlanningConfigured,
}: {
  livePlanningConfigured?: boolean;
}) {
  const settings = useSettings();
  if (!livePlanningConfigured) return null;
  const agreed = hasLiveDataConsent(settings);

  return (
    <SettingsSection title="Privacy" testID="live-data-use">
      <ListRow
        title="Live data use"
        subtitle={
          agreed
            ? 'You agreed to how live mode uses the places you plan between.'
            : 'Not agreed yet. Live mode asks before it sends anything.'
        }
        leadingSymbol="hand.raised.fill"
        accessibilityHint="Explains what live mode sends and to whom, and lets you withdraw"
        onPress={() => router.push('/data-use')}
      />
    </SettingsSection>
  );
}
