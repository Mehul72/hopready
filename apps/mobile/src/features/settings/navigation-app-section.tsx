import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { appStorage, type NavigationApp, usePreferences } from '@/storage';

import {
  findInstalledNavigationApps,
  NAVIGATION_APP_NAMES,
  type NavigationAppId,
} from '../itinerary/navigation-apps';
import { errorName, writeOrAlert } from '../saved/storage-writes';
import { ChoiceRow } from './choice-row';
import { SettingsSection } from './settings-section';

const CHOICES: readonly { value: NavigationApp; title: string }[] = [
  { value: 'ask', title: 'Ask every time' },
  { value: 'apple', title: NAVIGATION_APP_NAMES.apple },
  { value: 'google', title: NAVIGATION_APP_NAMES.google },
  { value: 'waze', title: NAVIGATION_APP_NAMES.waze },
];

// Which navigation apps are on this iPhone, checked again when HopReady comes back to the
// foreground in case one was installed or removed meanwhile. Null until the first check ends.
export function useInstalledNavigationApps(): readonly NavigationAppId[] | null {
  const [installed, setInstalled] = useState<readonly NavigationAppId[] | null>(null);

  useEffect(() => {
    let active = true;
    const check = () => {
      findInstalledNavigationApps((url) => Linking.canOpenURL(url)).then(
        (apps) => {
          if (active) setInstalled(apps);
        },
        (error: unknown) => {
          console.warn(`HopReady: could not list navigation apps (${errorName(error)}).`);
          if (active) setInstalled(['apple']);
        },
      );
    };
    check();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return installed;
}

function subtitleFor(value: NavigationApp, installed: readonly NavigationAppId[] | null) {
  if (value === 'ask') return 'Choose from your installed apps each time you start driving.';
  if (value === 'apple' || installed === null || installed.includes(value)) return undefined;
  return 'Not installed on this iPhone. HopReady will ask instead.';
}

export function NavigationAppSection() {
  const { navigationApp } = usePreferences();
  const installed = useInstalledNavigationApps();

  return (
    <SettingsSection
      title="Navigation app"
      description="Start driving on a trip hands the drive to this app for turn-by-turn directions."
      testID="navigation-app">
      {CHOICES.map((choice) => (
        <ChoiceRow
          key={choice.value}
          title={choice.title}
          subtitle={subtitleFor(choice.value, installed)}
          selected={navigationApp === choice.value}
          onPress={() => {
            writeOrAlert(
              () => appStorage.preferences.change({ navigationApp: choice.value }),
              "Couldn't save your navigation app",
            );
          }}
        />
      ))}
    </SettingsSection>
  );
}
