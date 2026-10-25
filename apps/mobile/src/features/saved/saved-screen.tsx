import type { Place, PlanRequest } from '@hopready/core';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText, Banner, type BannerTone, Button, Screen } from '@/components';
import { CURRENT_LOCATION_LABEL } from '@/location';
import {
  type AddResult,
  appStorage,
  recentRequestKey,
  useFavouriteRoutes,
  useRecentRequests,
  useSavedParkingSpots,
  useSavedPlaces,
} from '@/storage';
import { SPACING } from '@/theme';

import {
  asFixedPlace,
  favouriteLabelFor,
  parkingSpotNameFor,
  shortPlaceName,
} from './place-labels';
import { PlacePickerSheet } from './place-picker-sheet';
import { SavedItemRow } from './saved-item-row';
import { writeOrAlert } from './storage-writes';
import { useShortcutPlanner } from './use-shortcut-planner';

type PickerPurpose = 'home' | 'work' | 'favourite' | 'parking-spot';

const PICKER_TITLES: Readonly<Record<PickerPurpose, string>> = {
  home: 'Set Home',
  work: 'Set Work',
  favourite: 'Add a favourite place',
  'parking-spot': 'Add a parking spot',
};

interface Notice {
  tone: BannerTone;
  message: string;
}

function placeLabel(place: Place): string {
  return place.kind === 'current-location' ? CURRENT_LOCATION_LABEL : shortPlaceName(place);
}

export function describeRecentRequest(request: PlanRequest): { title: string; subtitle: string } {
  const title = `${placeLabel(request.origin)} to ${placeLabel(request.destination)}`;
  switch (request.trip.kind) {
    case 'return-via-car':
      return { title, subtitle: 'Back via your car' };
    case 'return-without-car':
      return { title, subtitle: 'Back by public transport' };
    case 'outbound': {
      const { transit, drive, dropOff } = request.access;
      const ways = [
        transit ? 'public transport' : null,
        drive ? 'driving' : null,
        dropOff ? 'drop-off' : null,
      ].filter((way): way is string => way !== null);
      return { title, subtitle: `By ${ways.join(', ')}` };
    }
  }
}

function confirmDelete(name: string, onConfirm: () => void) {
  Alert.alert(`Delete ${name}?`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

function SectionTitle({ children }: { children: string }) {
  return (
    <AppText variant="title3" accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </AppText>
  );
}

function addedNotice<T>(result: AddResult<T>, what: string): Notice {
  switch (result.status) {
    case 'added':
      return { tone: 'info', message: `${what} saved.` };
    case 'already-saved':
      return { tone: 'info', message: `${what} is already saved.` };
    case 'limit-reached':
      return {
        tone: 'warning',
        message: `You can save up to ${result.limit}. Delete one to add another.`,
      };
  }
}

export function SavedScreen() {
  const places = useSavedPlaces();
  const routes = useFavouriteRoutes();
  const recents = useRecentRequests();
  const spots = useSavedParkingSpots();
  const planner = useShortcutPlanner();
  const [picker, setPicker] = useState<PickerPurpose | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Feedback shows on the screen rather than in an alert, which iOS cannot show while the sheet
  // is still closing.
  const savePicked = (purpose: PickerPurpose, picked: Place) => {
    const place = asFixedPlace(picked);
    switch (purpose) {
      case 'home': {
        const saved = writeOrAlert(() => appStorage.places.setHome(place), "Couldn't save Home");
        if (saved.ok) setNotice({ tone: 'info', message: `Home set to ${place.name}.` });
        return;
      }
      case 'work': {
        const saved = writeOrAlert(() => appStorage.places.setWork(place), "Couldn't save Work");
        if (saved.ok) setNotice({ tone: 'info', message: `Work set to ${place.name}.` });
        return;
      }
      case 'favourite': {
        const saved = writeOrAlert(
          () => appStorage.places.addFavourite(favouriteLabelFor(place), place),
          "Couldn't save this favourite",
        );
        if (saved.ok) setNotice(addedNotice(saved.value, place.name));
        return;
      }
      case 'parking-spot': {
        const saved = writeOrAlert(
          () => appStorage.parkingSpots.add(parkingSpotNameFor(place), place.coordinate),
          "Couldn't save this parking spot",
        );
        if (saved.ok) setNotice(addedNotice(saved.value, 'This parking spot'));
        return;
      }
    }
  };

  const deleteRecent = (request: PlanRequest) => {
    const key = recentRequestKey(request);
    writeOrAlert(
      () =>
        appStorage.recentRequests.update((current) =>
          current.filter((recent) => recentRequestKey(recent) !== key),
        ),
      "Couldn't delete this search",
    );
  };

  const clearRecents = () => {
    Alert.alert('Clear all recent searches?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          writeOrAlert(() => appStorage.recentRequests.clear(), "Couldn't clear recent searches");
        },
      },
    ]);
  };

  return (
    <Screen testID="saved-screen">
      <AppText variant="largeTitle" accessibilityRole="header">
        Saved
      </AppText>
      {notice ? (
        <Banner
          tone={notice.tone}
          message={notice.message}
          announce
          action={{ label: 'Dismiss', onPress: () => setNotice(null) }}
        />
      ) : null}
      {planner.locating ? <Banner tone="info" message="Finding your location…" /> : null}

      <SectionTitle>Home and work</SectionTitle>
      {(['home', 'work'] as const).map((which) => {
        const place = places[which];
        const name = which === 'home' ? 'Home' : 'Work';
        return (
          <SavedItemRow
            key={which}
            testID={`saved-${which}`}
            title={name}
            subtitle={place ? place.name : 'Not set'}
            symbol={which === 'home' ? 'house.fill' : 'briefcase.fill'}
            accessibilityHint={
              place ? `Changes your ${name} address` : `Choose your ${name} address`
            }
            onPress={() => setPicker(which)}
            onDelete={
              place
                ? () =>
                    confirmDelete(name, () => {
                      writeOrAlert(
                        () =>
                          which === 'home'
                            ? appStorage.places.setHome(null)
                            : appStorage.places.setWork(null),
                        `Couldn't remove ${name}`,
                      );
                    })
                : undefined
            }
            deleteLabel={`Remove ${name}`}
          />
        );
      })}

      <SectionTitle>Favourite places</SectionTitle>
      {places.favourites.length === 0 ? (
        <AppText tone="secondary">Add places you go often to plan trips there in one tap.</AppText>
      ) : (
        places.favourites.map((favourite) => (
          <SavedItemRow
            key={favourite.id}
            title={favourite.label}
            subtitle={favourite.label === favourite.place.name ? undefined : favourite.place.name}
            symbol="star.fill"
            accessibilityHint="Plans a trip there from where you are, leaving now"
            disabled={planner.locating}
            onPress={() => {
              void planner.planToPlace(favourite.place);
            }}
            onDelete={() =>
              confirmDelete(favourite.label, () => {
                writeOrAlert(
                  () => appStorage.places.removeFavourite(favourite.id),
                  "Couldn't delete this favourite",
                );
              })
            }
          />
        ))
      )}
      <Button
        variant="secondary"
        symbol="plus"
        label="Add a favourite place"
        onPress={() => setPicker('favourite')}
      />

      <SectionTitle>Favourite routes</SectionTitle>
      {routes.length === 0 ? (
        <AppText tone="secondary">
          Tap Save route on a trip to plan it again from here in one tap.
        </AppText>
      ) : (
        routes.map((route) => (
          <SavedItemRow
            key={route.id}
            title={route.label}
            subtitle={`${placeLabel(route.origin)} to ${placeLabel(route.destination)}`}
            symbol="arrow.triangle.turn.up.right.diamond.fill"
            accessibilityHint="Plans this route, leaving now"
            disabled={planner.locating}
            onPress={() => {
              void planner.planRoute(route);
            }}
            onDelete={() =>
              confirmDelete(route.label, () => {
                writeOrAlert(
                  () => appStorage.favouriteRoutes.remove(route.id),
                  "Couldn't delete this route",
                );
              })
            }
          />
        ))
      )}

      <View style={styles.sectionWithAction}>
        <SectionTitle>Recent searches</SectionTitle>
        {recents.length > 0 ? (
          <Button variant="plain" label="Clear all" onPress={clearRecents} />
        ) : null}
      </View>
      {recents.length === 0 ? (
        <AppText tone="secondary">Trips you plan appear here.</AppText>
      ) : (
        recents.map((recent) => {
          const { title, subtitle } = describeRecentRequest(recent);
          return (
            <SavedItemRow
              key={recentRequestKey(recent)}
              title={title}
              subtitle={subtitle}
              symbol="clock.arrow.circlepath"
              accessibilityHint="Plans this trip again, leaving now"
              disabled={planner.locating}
              onPress={() => {
                void planner.planRecent(recent);
              }}
              onDelete={() => confirmDelete(title, () => deleteRecent(recent))}
            />
          );
        })
      )}

      <SectionTitle>Parking spots</SectionTitle>
      <AppText tone="secondary">
        Places you park that aren&apos;t Park&amp;Ride car parks. HopReady considers them when you
        drive and park, but can&apos;t know their rules or free spaces, so check the signs.
      </AppText>
      {spots.map((spot) => (
        <SavedItemRow
          key={spot.id}
          title={spot.name}
          symbol="parkingsign"
          onDelete={() =>
            confirmDelete(spot.name, () => {
              writeOrAlert(
                () => appStorage.parkingSpots.remove(spot.id),
                "Couldn't delete this parking spot",
              );
            })
          }
        />
      ))}
      <Button
        variant="secondary"
        symbol="plus"
        label="Add a parking spot"
        onPress={() => setPicker('parking-spot')}
      />

      <PlacePickerSheet
        visible={picker !== null}
        title={picker ? PICKER_TITLES[picker] : ''}
        allowCurrentLocation
        onPick={(place) => {
          const purpose = picker;
          setPicker(null);
          if (purpose) savePicked(purpose, place);
        }}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    paddingTop: SPACING.lg,
  },
  sectionWithAction: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
});
