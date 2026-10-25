import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme';

// Native iOS tab bar. Selected tabs switch to the filled symbol, so selection is not shown by
// colour alone.
export default function TabsLayout() {
  const { colours } = useTheme();
  return (
    <NativeTabs tintColor={colours.brand}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="car">
        <NativeTabs.Trigger.Label>Car</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="car.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'star', selected: 'star.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
