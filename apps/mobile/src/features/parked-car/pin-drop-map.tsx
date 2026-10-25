import type { Coordinate } from '@hopready/core';
import { StyleSheet, View } from 'react-native';
import MapView, {
  type LatLng,
  type MapPressEvent,
  Marker,
  type MarkerDragStartEndEvent,
} from 'react-native-maps';

import { AppText, IconButton, regionFor } from '@/components';
import { RADII, SPACING, useTheme } from '@/theme';

// One press of an arrow moves the pin about this far: a few car spaces.
export const NUDGE_METRES = 10;
const METRES_PER_DEGREE_LATITUDE = 111_320;
const MAP_HEIGHT = 240;

type Direction = 'north' | 'south' | 'east' | 'west';

const NUDGE_BUTTONS: readonly {
  direction: Direction;
  symbol: 'arrow.up' | 'arrow.down' | 'arrow.left' | 'arrow.right';
}[] = [
  { direction: 'north', symbol: 'arrow.up' },
  { direction: 'west', symbol: 'arrow.left' },
  { direction: 'east', symbol: 'arrow.right' },
  { direction: 'south', symbol: 'arrow.down' },
];

export function nudge(
  coordinate: Coordinate,
  direction: Direction,
  metres = NUDGE_METRES,
): Coordinate {
  const latitudeStep = metres / METRES_PER_DEGREE_LATITUDE;
  const longitudeStep =
    metres / (METRES_PER_DEGREE_LATITUDE * Math.cos((coordinate.lat * Math.PI) / 180));
  switch (direction) {
    case 'north':
      return { lat: coordinate.lat + latitudeStep, lon: coordinate.lon };
    case 'south':
      return { lat: coordinate.lat - latitudeStep, lon: coordinate.lon };
    case 'east':
      return { lat: coordinate.lat, lon: coordinate.lon + longitudeStep };
    case 'west':
      return { lat: coordinate.lat, lon: coordinate.lon - longitudeStep };
  }
}

function toCoordinate(point: LatLng): Coordinate {
  return { lat: point.latitude, lon: point.longitude };
}

export interface PinDropMapProps {
  coordinate: Coordinate;
  onMove: (coordinate: Coordinate) => void;
}

// An Apple map with the car's pin. The pin can be dragged, or moved by tapping the map, and the
// arrow buttons do the same without dragging, for VoiceOver and Switch Control.
export function PinDropMap({ coordinate, onMove }: PinDropMapProps) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <View style={styles.mapFrame}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={regionFor([coordinate])}
          mapType="mutedStandard"
          userInterfaceStyle={theme.scheme}
          pitchEnabled={false}
          rotateEnabled={false}
          accessibilityLabel="Map with your car's pin. Use the arrow buttons below to move it."
          onPress={(event: MapPressEvent) => onMove(toCoordinate(event.nativeEvent.coordinate))}>
          <Marker
            coordinate={{ latitude: coordinate.lat, longitude: coordinate.lon }}
            draggable
            title="Your car"
            accessibilityLabel="Your car"
            onDragEnd={(event: MarkerDragStartEndEvent) =>
              onMove(toCoordinate(event.nativeEvent.coordinate))
            }
          />
        </MapView>
      </View>
      <AppText variant="subheadline" tone="secondary">
        Drag the pin or tap the map where your car is. The arrows move it about {NUDGE_METRES} m.
      </AppText>
      <View style={styles.nudges}>
        {NUDGE_BUTTONS.map(({ direction, symbol }) => (
          <IconButton
            key={direction}
            symbol={symbol}
            variant="filled"
            tone="neutral"
            accessibilityLabel={`Move pin ${direction}`}
            onPress={() => onMove(nudge(coordinate, direction))}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  mapFrame: {
    height: MAP_HEIGHT,
    borderRadius: RADII.lg,
    overflow: 'hidden',
  },
  nudges: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
  },
});
