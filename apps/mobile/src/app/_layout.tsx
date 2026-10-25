import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createQueryClient, useQueryFocusFollowsAppState } from '@/api';
import { DemoModeBanner, ScreenPresentationProvider } from '@/components';
import { useShowsDemoData } from '@/state';
import { appStorage } from '@/storage';
import { NAVIGATION_THEMES, useColourScheme, useTheme } from '@/theme';
import { useRefreshActiveTripOnResume } from '@/trip';

const SHEET_PRESENTATIONS: ReadonlySet<string> = new Set([
  'modal',
  'transparentModal',
  'containedModal',
  'containedTransparentModal',
  'fullScreenModal',
  'formSheet',
  'pageSheet',
]);

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const scheme = useColourScheme();
  const { colours } = useTheme();
  const showsDemoData = useShowsDemoData();
  useQueryFocusFollowsAppState();
  useRefreshActiveTripOnResume();

  // Cached searches and car parks are data too: "delete all data" removes them with the rest.
  useEffect(() => appStorage.onDataDeleted(() => queryClient.clear()), [queryClient]);

  // The demo strip sits under the status bar, dark in light mode and light in dark mode.
  const statusBarStyle = showsDemoData ? (scheme === 'dark' ? 'dark' : 'light') : 'auto';

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={NAVIGATION_THEMES[scheme]}>
        <View style={[styles.fill, { backgroundColor: colours.background }]}>
          <DemoModeBanner placement="window-top" />
          {/* A nested provider measures insets from below the demo strip, so screens do not pad
              for a status bar the strip already covers. */}
          <SafeAreaProvider style={styles.fill}>
            <Stack
              screenOptions={{ contentStyle: { backgroundColor: colours.background } }}
              screenLayout={({ children, options }) => (
                <ScreenPresentationProvider
                  presentation={
                    options.presentation && SHEET_PRESENTATIONS.has(options.presentation)
                      ? 'modal'
                      : 'card'
                  }>
                  {children}
                </ScreenPresentationProvider>
              )}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="results" options={{ title: 'Options' }} />
              <Stack.Screen name="itinerary/[id]" options={{ title: 'Trip' }} />
              <Stack.Screen
                name="place-search"
                options={{ presentation: 'modal', title: 'Choose a place' }}
              />
              <Stack.Screen
                name="trip-options"
                options={{ presentation: 'modal', title: 'Trip options' }}
              />
              <Stack.Screen
                name="parked-car/confirm"
                options={{ presentation: 'modal', title: 'Where you parked' }}
              />
              <Stack.Screen
                name="parked-car/correct"
                options={{ presentation: 'modal', title: 'Move the car pin' }}
              />
            </Stack>
          </SafeAreaProvider>
        </View>
        <StatusBar style={statusBarStyle} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
