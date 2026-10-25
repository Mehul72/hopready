import type { Place } from '@hopready/core';
import { DEMO_PLACES } from '@hopready/core/fixtures';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { type ComponentRef, type ReactNode, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { z } from 'zod';

import { type ApiError, PLACE_QUERY_MAX_LENGTH } from '@/api';
import {
  AppText,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  type MapPoint,
  Screen,
  TripMap,
} from '@/components';
import { type SavedPlaces, useRecentRequests, useSavedPlaces } from '@/storage';
import { MAX_CONTENT_WIDTH, MIN_TOUCH_TARGET, RADII, SPACING, useTheme } from '@/theme';
import { type DataMode, useDataMode, usePlaceSearch } from '@/trip';

import { closeSheet } from './close-sheet';
import { turnOnDemoMode } from './demo-mode';
import { useAnnounceSearchOutcome } from '../shared/announce-search-outcome';
import { LocationNotice } from './location-notice';
import { useNearHint } from './near-hint';
import { recentPlaces } from './place-labels';
import { planChoices } from './plan-choices';
import { planDraft } from './plan-draft';
import { useCurrentPlace } from './use-current-place';

// Three characters before searching keeps the shared Apple and Transport for NSW allowances for
// searches that can find something.
export const MIN_SEARCH_CHARACTERS = 3;
const MAP_STRIP_HEIGHT = 128;
const MAX_RECENT_PLACES = 5;

const searchTargetSchema = z.enum(['origin', 'destination', 'preferred-station']);
export type SearchTarget = z.infer<typeof searchTargetSchema>;

const TITLES: Readonly<Record<SearchTarget, string>> = {
  origin: 'Choose a starting point',
  destination: 'Choose a destination',
  'preferred-station': 'Choose a station',
};

const SEARCH_SOURCE_NAMES: Readonly<Record<string, string>> = {
  'apple-maps': 'Apple Maps places',
  'tfnsw-trip-planner': 'Transport for NSW stops',
};

export const LIVE_ATTRIBUTION = 'Stops: Transport for NSW · Places: Apple Maps';
export const DEMO_ATTRIBUTION = 'Demo search: sample places, and stops from Transport for NSW data';

function attributionFor(mode: DataMode): string {
  return mode === 'live' ? LIVE_ATTRIBUTION : DEMO_ATTRIBUTION;
}

function searchErrorTitle(error: ApiError): string {
  switch (error.kind) {
    case 'offline':
      return "You're offline";
    case 'not-configured':
      return "Search isn't set up";
    case 'rate-limited':
      return 'Search is busy';
    default:
      return "Couldn't search";
  }
}

function missingSourcesMessage(unavailable: readonly string[]): string {
  const names = unavailable.map((source) => SEARCH_SOURCE_NAMES[source] ?? 'One search source');
  return `${[...new Set(names)].join(' and ')} didn't answer, so some results may be missing.`;
}

interface PlaceListEntry {
  key: string;
  place: Place;
  title: string;
  detail: string | null;
}

interface PlaceListProps {
  title: string;
  places: readonly PlaceListEntry[];
  onChoose: (place: Place) => void;
  leadingSymbol: SFSymbol;
}

function PlaceList({ title, places, onChoose, leadingSymbol }: PlaceListProps) {
  const { colours } = useTheme();
  if (places.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText variant="headline" accessibilityRole="header">
        {title}
      </AppText>
      <Card padded={false} style={styles.listCard}>
        {places.map((entry, index) => (
          <View key={entry.key}>
            {index > 0 ? (
              <View style={[styles.separator, { backgroundColor: colours.separator }]} />
            ) : null}
            <ListRow
              title={entry.title}
              subtitle={entry.detail ?? undefined}
              leadingSymbol={leadingSymbol}
              onPress={() => onChoose(entry.place)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

// Demo mode plans only around its sample world, so its places are offered without typing.
const SAMPLE_PLACE_ENTRIES: readonly PlaceListEntry[] = Object.entries(DEMO_PLACES).map(
  ([id, place]) => ({ key: `sample:${id}`, place, title: place.name, detail: null }),
);

function savedEntries(saved: SavedPlaces): PlaceListEntry[] {
  const entries: PlaceListEntry[] = [];
  if (saved.home) {
    entries.push({ key: 'home', place: saved.home, title: 'Home', detail: saved.home.name });
  }
  if (saved.work) {
    entries.push({ key: 'work', place: saved.work, title: 'Work', detail: saved.work.name });
  }
  for (const favourite of saved.favourites) {
    entries.push({
      key: `favourite:${favourite.id}`,
      place: favourite.place,
      title: favourite.label,
      detail: favourite.label === favourite.place.name ? null : favourite.place.name,
    });
  }
  return entries;
}

export function PlaceSearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Route parameters can come from any link, so they are checked like any other outside input.
  const target = searchTargetSchema.catch('destination').parse(params.field);
  const { colours } = useTheme();
  const mode = useDataMode();
  const saved = useSavedPlaces();
  const recents = useRecentRequests();
  const near = useNearHint();
  const location = useCurrentPlace();
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  const trimmed = text.trim();
  const searchable = trimmed.length >= MIN_SEARCH_CHARACTERS;
  // Held back until the location hint is settled, so each search is sent once.
  const search = usePlaceSearch(
    searchable && near.status === 'ready' ? trimmed : '',
    near.status === 'ready' ? near.coordinate : null,
  );
  const stationsOnly = target === 'preferred-station';
  // The map re-frames whenever its points change, so they keep their identity while typing.
  const results = useMemo(
    () =>
      (search.data?.results ?? []).filter(
        (result) => !stationsOnly || (result.place.kind === 'stop' && result.place.stopId),
      ),
    [search.data, stationsOnly],
  );
  const mapPoints = useMemo(
    (): MapPoint[] =>
      results.map((result, index) => ({
        id: `${index}:${result.place.name}`,
        coordinate: result.place.coordinate,
        kind: 'place',
        label: result.place.name,
      })),
    [results],
  );
  const stops = results.filter((result) => result.place.kind === 'stop');
  const places = results.filter((result) => result.place.kind !== 'stop');
  useAnnounceSearchOutcome(searchable ? search.data : undefined, results.length);

  function choose(place: Place) {
    // A location lookup still running must not replace this choice when it finishes.
    location.dismiss();
    try {
      if (target === 'preferred-station') planChoices.setPreferredStation(place);
      else planDraft.setPlace(target, place);
    } catch (error) {
      console.warn(
        `HopReady: could not save the chosen place (${error instanceof Error ? error.name : 'unknown'}).`,
      );
      setSaveFailed(true);
      return;
    }
    closeSheet(router);
  }

  async function chooseCurrentLocation() {
    const place = await location.locate();
    if (place) choose(place);
  }

  const resultEntries = (list: typeof results) =>
    list.map((result, index) => ({
      key: `${index}:${result.place.name}`,
      place: result.place,
      title: result.place.name,
      detail: result.detail,
    }));

  const showsResults = searchable && !search.isError && results.length > 0;
  let body: ReactNode;
  if (trimmed.length === 0) {
    body = stationsOnly ? (
      <AppText tone="secondary">Search for a station or stop by name.</AppText>
    ) : (
      <>
        <Card padded={false} style={styles.listCard}>
          <ListRow
            title={
              location.attempt.status === 'locating'
                ? 'Finding your location'
                : 'Use current location'
            }
            leadingSymbol="location.fill"
            onPress={() => void chooseCurrentLocation()}
            disabled={location.attempt.status === 'locating'}
            accessibilityHint="Uses where you are now. iOS may ask for permission first."
            testID="use-current-location"
          />
        </Card>
        <LocationNotice
          attempt={location.attempt}
          enterPlaceLabel="Type the place instead"
          onEnterPlace={() => {
            location.dismiss();
            inputRef.current?.focus();
          }}
          onTryAgain={() => void chooseCurrentLocation()}
        />
        <PlaceList
          title="Saved places"
          places={savedEntries(saved)}
          onChoose={choose}
          leadingSymbol="star.fill"
        />
        <PlaceList
          title="Recent places"
          places={recentPlaces(recents, saved, MAX_RECENT_PLACES).map((place, index) => ({
            key: `recent:${index}:${place.name}`,
            place,
            title: place.name,
            detail: null,
          }))}
          onChoose={choose}
          leadingSymbol="clock.arrow.circlepath"
        />
        {mode === 'demo' ? (
          <PlaceList
            title="Sample places"
            places={SAMPLE_PLACE_ENTRIES}
            onChoose={choose}
            leadingSymbol="testtube.2"
          />
        ) : null}
      </>
    );
  } else if (!searchable) {
    body = (
      <AppText tone="secondary" testID="search-hint">
        {`Type at least ${MIN_SEARCH_CHARACTERS} characters to search.`}
      </AppText>
    );
  } else if (search.isError) {
    body = (
      <ErrorState
        title={searchErrorTitle(search.error)}
        message={search.error.message}
        onRetry={search.error.kind === 'not-configured' ? undefined : () => void search.refetch()}
        retrying={search.isFetching}
        secondaryAction={
          search.error.suggestsDemoMode
            ? {
                label: 'Turn on demo mode',
                onPress: () => void turnOnDemoMode(),
                accessibilityHint: 'Searches sample places instead, labelled as demo',
              }
            : undefined
        }
        testID="search-error"
      />
    );
  } else if (!search.data) {
    body = <LoadingState rows={3} accessibilityLabel="Searching" testID="search-loading" />;
  } else if (results.length === 0) {
    body = (
      <EmptyState
        title="No matches"
        message={
          stationsOnly
            ? 'Check the spelling, or try the station or stop name.'
            : 'Check the spelling, or try a street, suburb, station or landmark.'
        }
        symbol="magnifyingglass"
        testID="search-empty"
      />
    );
  } else {
    body = (
      <>
        {search.data.unavailable.length > 0 ? (
          <Banner
            tone="info"
            title="Some results may be missing"
            message={missingSourcesMessage(search.data.unavailable)}
          />
        ) : null}
        <PlaceList
          title="Stops"
          places={resultEntries(stops)}
          onChoose={choose}
          leadingSymbol="tram.fill"
        />
        <PlaceList
          title="Places"
          places={resultEntries(places)}
          onChoose={choose}
          leadingSymbol="mappin.and.ellipse"
        />
        {/* Credits what answered, not the setting: an API serving sample data says 'demo' even
            while the app is in live mode. */}
        <AppText variant="footnote" tone="secondary" testID="search-attribution">
          {attributionFor(search.data.mode)}
        </AppText>
      </>
    );
  }

  return (
    <Screen scroll={false} testID="place-search-screen">
      <Stack.Screen
        options={{
          title: TITLES[target],
          headerLeft: () => (
            <Button variant="plain" label="Cancel" onPress={() => closeSheet(router)} />
          ),
        }}
      />
      <View style={styles.top}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={stationsOnly ? 'Station or stop name' : 'Address, place or stop'}
          placeholderTextColor={colours.textSecondary}
          autoFocus
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          clearButtonMode="while-editing"
          maxLength={PLACE_QUERY_MAX_LENGTH}
          accessibilityLabel={stationsOnly ? 'Search for a station' : 'Search for a place or stop'}
          accessibilityHint={`Results appear after ${MIN_SEARCH_CHARACTERS} characters`}
          style={[
            styles.input,
            { color: colours.text, backgroundColor: colours.surface, borderColor: colours.border },
          ]}
          testID="place-search-input"
        />
        {saveFailed ? (
          <Banner tone="error" message="Couldn't save that choice. Try again." announce />
        ) : null}
      </View>
      {showsResults ? (
        // Apple's terms require an Apple map wherever its search results are shown.
        <TripMap points={mapPoints} style={styles.map} testID="search-map" />
      ) : null}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.readableWidth}>{body}</View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  top: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 17,
  },
  map: {
    height: MAP_STRIP_HEIGHT,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  readableWidth: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: SPACING.md,
  },
  section: {
    gap: SPACING.xs,
  },
  listCard: {
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg,
  },
});
