import type { Place } from '@hopready/core';
import { type ReactNode, useState } from 'react';
import { Modal, StyleSheet, TextInput, View } from 'react-native';

import { PLACE_QUERY_MAX_LENGTH, PLACE_QUERY_MIN_LENGTH } from '@/api';
import {
  AppText,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  ScreenPresentationProvider,
  TripMap,
} from '@/components';
import { appStorage } from '@/storage';
import { MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';
import { useDataMode, usePlaceSearch } from '@/trip';

import { findCurrentPlace, openLocationSettingsOrExplain } from './current-location';
import { writeOrAlert } from './storage-writes';

export const LIVE_SEARCH_ATTRIBUTION = 'Stops: Transport for NSW · Places: Apple Maps';
export const DEMO_SEARCH_ATTRIBUTION = 'Sample places and stops for demo mode';
const MAP_HEIGHT = 160;

export interface PlacePickerSheetProps {
  visible: boolean;
  title: string;
  // Why the sheet opened, such as "HopReady couldn't find your location", shown at the top.
  notice?: string | null;
  allowCurrentLocation: boolean;
  onPick: (place: Place) => void;
  onClose: () => void;
  // An extra control under the title, such as "Also save as Home".
  accessory?: ReactNode;
  // Changing it starts a fresh search, for a sheet that stays open while its question changes.
  resetKey?: string;
}

function SearchResults({ query, onPick }: { query: string; onPick: (place: Place) => void }) {
  const search = usePlaceSearch(query, null);
  const mode = useDataMode();
  const trimmed = query.trim();

  if (trimmed.length < PLACE_QUERY_MIN_LENGTH) {
    return (
      <AppText tone="secondary">
        Type at least {PLACE_QUERY_MIN_LENGTH} letters of a street, place or station.
      </AppText>
    );
  }
  if (search.isError) {
    return (
      <ErrorState
        title="Couldn't search"
        message={search.error.message}
        onRetry={() => {
          void search.refetch();
        }}
        retrying={search.isFetching}
        secondaryAction={
          search.error.suggestsDemoMode
            ? {
                label: 'Turn on demo mode',
                onPress: () => {
                  writeOrAlert(
                    () => appStorage.settings.setDemoMode(true),
                    "Couldn't turn on demo mode",
                  );
                },
              }
            : undefined
        }
      />
    );
  }
  if (!search.data) {
    return <LoadingState rows={3} accessibilityLabel="Searching for places" />;
  }

  const { results, unavailable } = search.data;
  return (
    <View style={styles.results}>
      {unavailable.length > 0 ? (
        <Banner
          tone="warning"
          title="Some results may be missing"
          message="Part of the search isn't answering right now. Try again shortly if you can't find the place."
        />
      ) : null}
      {results.length === 0 ? (
        <EmptyState
          symbol="magnifyingglass"
          title="No places found"
          message="Check the spelling, or try a nearby street or station."
        />
      ) : (
        <>
          {/* Apple's terms allow its search results only next to an Apple map. */}
          <TripMap
            points={results.map((result, index) => ({
              id: `result-${index}`,
              coordinate: result.place.coordinate,
              kind: 'place' as const,
              label: result.place.name,
            }))}
            style={styles.map}
          />
          {results.map((result, index) => (
            <ListRow
              key={`${index}:${result.place.name}`}
              title={result.place.name}
              subtitle={result.detail ?? undefined}
              leadingSymbol={result.place.kind === 'stop' ? 'tram.fill' : 'mappin.and.ellipse'}
              onPress={() => onPick(result.place)}
            />
          ))}
        </>
      )}
      <AppText variant="footnote" tone="secondary">
        {mode === 'demo' ? DEMO_SEARCH_ATTRIBUTION : LIVE_SEARCH_ATTRIBUTION}
      </AppText>
    </View>
  );
}

function PlacePickerContent({
  title,
  notice,
  allowCurrentLocation,
  onPick,
  onClose,
  accessory,
}: Omit<PlacePickerSheetProps, 'visible' | 'resetKey'>) {
  const { colours } = useTheme();
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<{
    message: string;
    canOpenSettings: boolean;
  } | null>(null);

  const pickCurrentLocation = async () => {
    setLocating(true);
    setLocationProblem(null);
    const outcome = await findCurrentPlace();
    setLocating(false);
    if (outcome.status === 'found') {
      onPick(outcome.place);
      return;
    }
    setLocationProblem({
      message: `${outcome.message} Search for the place instead.`,
      canOpenSettings: outcome.canOpenSettings,
    });
  };

  return (
    <Screen testID="place-picker">
      <View style={styles.header}>
        <AppText variant="title2" accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        <Button variant="plain" label="Cancel" onPress={onClose} />
      </View>
      {notice ? <Banner tone="warning" message={notice} /> : null}
      {accessory}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Street, place or station"
        placeholderTextColor={colours.textSecondary}
        accessibilityLabel="Search for a place"
        autoFocus
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        maxLength={PLACE_QUERY_MAX_LENGTH}
        style={[
          styles.input,
          { color: colours.text, borderColor: colours.border, backgroundColor: colours.surface },
        ]}
      />
      {allowCurrentLocation ? (
        <ListRow
          title={locating ? 'Finding your location…' : 'Use my current location'}
          leadingSymbol="location.fill"
          disabled={locating}
          onPress={() => {
            void pickCurrentLocation();
          }}
        />
      ) : null}
      {locationProblem ? (
        <Banner
          tone="warning"
          message={locationProblem.message}
          announce
          action={
            locationProblem.canOpenSettings
              ? {
                  label: 'Open Settings',
                  onPress: openLocationSettingsOrExplain,
                }
              : undefined
          }
        />
      ) : null}
      <SearchResults query={query} onPick={onPick} />
    </Screen>
  );
}

// A sheet for choosing one place: Home, Work, a favourite, or where to start a trip from. It
// searches the same way as the Plan tab, with an Apple map beside Apple results.
export function PlacePickerSheet({ visible, resetKey, ...contentProps }: PlacePickerSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={contentProps.onClose}>
      <ScreenPresentationProvider presentation="modal">
        {visible ? <PlacePickerContent key={resetKey} {...contentProps} /> : null}
      </ScreenPresentationProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  title: {
    flexShrink: 1,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.md,
    fontSize: 17,
  },
  results: {
    gap: SPACING.sm,
  },
  map: {
    height: MAP_HEIGHT,
    borderRadius: RADII.lg,
  },
});
