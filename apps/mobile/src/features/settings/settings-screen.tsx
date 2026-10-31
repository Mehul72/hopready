import { AppText, Screen } from '@/components';

import { AboutSection } from './about-section';
import { DeleteDataSection } from './delete-data-section';
import { DemoModeSection } from './demo-mode-section';
import { LiveDataUseSection } from './live-data-use-section';
import { NavigationAppSection } from './navigation-app-section';
import { TripOptionsSection } from './trip-options-section';

export function SettingsScreen() {
  return (
    <Screen testID="settings-screen">
      <AppText variant="largeTitle" accessibilityRole="header">
        Settings
      </AppText>
      <TripOptionsSection />
      <NavigationAppSection />
      <DemoModeSection />
      <LiveDataUseSection />
      <AboutSection />
      <DeleteDataSection />
    </Screen>
  );
}
