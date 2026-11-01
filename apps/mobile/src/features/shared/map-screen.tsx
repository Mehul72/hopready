import type { Itinerary } from '@hopready/core';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { Button, EmptyState, Screen, TripMap } from '@/components';
import type { TripMapHandle, VehicleMarker } from '@/components/trip-map';
import { usePlanSession } from '@/state';
import { trackedLegsOf, useVehiclePositions } from '@/trip/vehicle-positions';

import { useCurrentMinute } from '../itinerary/use-current-minute';
import { useDisplayedTrip } from '../itinerary/use-displayed-trip';
import { vehicleMarkerLabel, vehicleRows } from '../itinerary/vehicle-text';
import { closeSheet } from '../plan/close-sheet';
import { LivePositionsPanel } from './live-positions-panel';

// Route parameters can come from any link, so they are checked like any other outside input.
const paramsSchema = z.object({
  for: z.enum(['results', 'trip']).catch('results'),
  id: z.string().optional(),
});

function ResultsMap() {
  const { response, selectedItineraryId } = usePlanSession();
  const itineraries = response?.itineraries ?? [];
  if (itineraries.length === 0) return <NothingToShow />;
  return (
    <TripMap
      itineraries={itineraries}
      selectedItineraryId={selectedItineraryId}
      style={styles.fill}
      testID="full-map"
    />
  );
}

function TripOnMap({ id }: { id: string }) {
  const trip = useDisplayedTrip(id);
  if (!trip) return <NothingToShow />;
  return <TripWithVehicles itinerary={trip.itinerary} />;
}

// The trip's map with where its services' vehicles are, refreshed while the map is on screen.
function TripWithVehicles({ itinerary }: { itinerary: Itinerary }) {
  const nowMs = useCurrentMinute();
  const isFocused = useIsFocused();
  const mapRef = useRef<TripMapHandle>(null);
  const trackedLegs = trackedLegsOf(itinerary, nowMs);
  const positions = useVehiclePositions(trackedLegs, { active: isFocused });
  const rows = vehicleRows(trackedLegs, positions, nowMs);
  const vehicles = rows.flatMap((row): VehicleMarker[] =>
    row.place
      ? [
          {
            key: row.key,
            mode: row.place.mode,
            coordinate: row.place.coordinate,
            bearingDegrees: row.place.bearingDegrees,
            onPreviousTrip: row.place.onPreviousTrip,
            accessibilityLabel: vehicleMarkerLabel(row),
          },
        ]
      : [],
  );

  return (
    <View style={styles.fill}>
      <TripMap
        ref={mapRef}
        itinerary={itinerary}
        vehicles={vehicles}
        style={styles.fill}
        testID="full-map"
      />
      {rows.length > 0 ? (
        <LivePositionsPanel
          rows={rows}
          checkedAt={positions.checkedAt}
          demo={positions.mode === 'demo'}
          onShow={(row) => {
            if (row.place) mapRef.current?.showCoordinate(row.place.coordinate);
          }}
        />
      ) : null}
    </View>
  );
}

function NothingToShow() {
  return (
    <EmptyState
      title="No map to show"
      message="Plan a trip first, then open the map from its options or timeline."
      symbol="map"
      testID="map-empty"
    />
  );
}

// The results or trip map, full screen, where it can be panned and zoomed.
export function MapScreen() {
  const router = useRouter();
  const params = paramsSchema.parse(useLocalSearchParams());
  return (
    <Screen scroll={false} testID="map-screen">
      <Stack.Screen
        options={{
          title: 'Map',
          headerLeft: () => (
            <Button variant="plain" label="Done" onPress={() => closeSheet(router)} />
          ),
        }}
      />
      {params.for === 'trip' && params.id ? <TripOnMap id={params.id} /> : <ResultsMap />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
