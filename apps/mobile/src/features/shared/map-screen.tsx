import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { z } from 'zod';

import { Button, EmptyState, Screen, TripMap } from '@/components';
import { usePlanSession } from '@/state';

import { useDisplayedTrip } from '../itinerary/use-displayed-trip';
import { closeSheet } from '../plan/close-sheet';

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
  return <TripMap itinerary={trip.itinerary} style={styles.fill} testID="full-map" />;
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
