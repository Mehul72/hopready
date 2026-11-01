import type { Coordinate, TransitMode } from '@hopready/core';
import { type SFSymbol, SymbolView } from 'expo-symbols';
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import MapView, { type LatLng, Marker, Polyline, type Region } from 'react-native-maps';

import { useHasLocationPermission } from '@/location';
import { LEG_VISUALS, useTheme } from '@/theme';

import { AppText } from './app-text';
import {
  buildMapModel,
  type MapLineModel,
  type MapMarkerKind,
  type TripMapContent,
} from './trip-map-model';

// A vehicle running one of the trip's services, where TfNSW's live feed last put it.
export interface VehicleMarker {
  key: string;
  mode: TransitMode;
  coordinate: Coordinate;
  bearingDegrees: number | null;
  // Spoken by VoiceOver: the service and how old the position is.
  accessibilityLabel: string;
  // Still finishing the trip before this one; drawn fainter.
  onPreviousTrip: boolean;
}

export interface TripMapHandle {
  // Moves the camera to a point, such as a vehicle the traveller asked to see.
  showCoordinate: (coordinate: Coordinate) => void;
}

export type TripMapProps = TripMapContent & {
  // Drawn over the trip but left out of its framing: the camera would otherwise move on every
  // update and fight the traveller's panning.
  vehicles?: readonly VehicleMarker[];
  ref?: Ref<TripMapHandle>;
  style?: StyleProp<ViewStyle>;
  // Height of a sheet or panel covering the bottom of the map. The route is framed above it and
  // Apple's logo and legal link move up with it: they must stay visible (Apple DPLA Attachment 6).
  bottomInset?: number;
  // Replaces the generated route summary that VoiceOver reads.
  accessibilityLabel?: string;
  // False for a map inside a scrolling page: a swipe across it then scrolls the page instead of
  // panning the map, which frames its content by itself. Apple's legal link stays tappable.
  interactive?: boolean;
  testID?: string;
};

const FRAME_PADDING = 48;
const SINGLE_POINT_SPAN_DEGREES = 0.01;
const SPAN_MARGIN = 1.4;
const DASH_PATTERNS: Readonly<Record<MapLineModel['pattern'], number[] | undefined>> = {
  solid: undefined,
  dashed: [6, 6],
  dotted: [1, 7],
};
const MARKER_SYMBOLS: Readonly<Record<Exclude<MapMarkerKind, 'car-park'>, SFSymbol>> = {
  origin: 'smallcircle.filled.circle',
  destination: 'flag.fill',
  'parked-car': 'car.fill',
  'drop-off': 'figure.wave',
  transfer: 'arrow.triangle.swap',
  place: 'mappin',
};
// Australian parking signs are white on blue; the badge borrows that, with a ring for dark maps.
const PARKING_BLUE = '#1F4FB5';

function toLatLng(coordinate: Coordinate): LatLng {
  return { latitude: coordinate.lat, longitude: coordinate.lon };
}

// A first camera position, so the map does not flash the whole world before it is framed.
export function regionFor(coordinates: readonly Coordinate[]): Region | undefined {
  if (coordinates.length === 0) return undefined;
  const lats = coordinates.map((coordinate) => coordinate.lat);
  const lons = coordinates.map((coordinate) => coordinate.lon);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * SPAN_MARGIN, SINGLE_POINT_SPAN_DEGREES),
    longitudeDelta: Math.max((maxLon - minLon) * SPAN_MARGIN, SINGLE_POINT_SPAN_DEGREES),
  };
}

// The vehicle in its mode's colour with the mode's symbol, and a small arrow pointing the way it is
// heading when the feed says. The symbol, not the colour, tells the modes apart, and the symbol's
// colour on the mode colour is held to WCAG AA by the theme's contrast tests. Apple Maps markers
// do not turn with the map, so the arrow takes off the map's own heading.
function VehicleBadge({
  vehicle,
  mapHeadingDegrees,
}: {
  vehicle: VehicleMarker;
  mapHeadingDegrees: number;
}) {
  const { modeColours, onModeColour } = useTheme();
  const fill = modeColours[vehicle.mode];
  return (
    <View style={[styles.vehicle, vehicle.onPreviousTrip && styles.previousTrip]}>
      {vehicle.bearingDegrees === null ? null : (
        <View
          testID={`vehicle-heading-${vehicle.key}`}
          style={[
            StyleSheet.absoluteFill,
            styles.headingTrack,
            {
              transform: [
                {
                  rotate: `${(((vehicle.bearingDegrees - mapHeadingDegrees) % 360) + 360) % 360}deg`,
                },
              ],
            },
          ]}>
          <SymbolView name="arrowtriangle.up.fill" tintColor={fill} size={10} />
        </View>
      )}
      <View style={[styles.badge, { backgroundColor: fill, borderColor: onModeColour }]}>
        <SymbolView name={LEG_VISUALS[vehicle.mode].symbol} tintColor={onModeColour} size={14} />
      </View>
    </View>
  );
}

function MarkerBadge({ kind }: { kind: MapMarkerKind }) {
  const { colours } = useTheme();
  if (kind === 'car-park') {
    return (
      <View style={[styles.badge, { backgroundColor: PARKING_BLUE, borderColor: '#FFFFFF' }]}>
        <AppText variant="headline" colour="#FFFFFF" maxFontSizeMultiplier={1}>
          P
        </AppText>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colours.markerFill, borderColor: colours.markerRing },
      ]}>
      <SymbolView name={MARKER_SYMBOLS[kind]} tintColor={colours.onMarker} size={14} />
    </View>
  );
}

// Apple Maps (react-native-maps' default provider, no key needed) showing one trip, several
// options, or a set of places. Show it on every screen that shows Apple drive times or Apple
// search results: Apple's terms only allow that data next to an Apple map.
export function TripMap(props: TripMapProps) {
  const {
    style,
    bottomInset = 0,
    accessibilityLabel,
    interactive = true,
    testID,
    vehicles = [],
    ref,
  } = props;
  const theme = useTheme();
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  // Degrees the traveller has turned the map from north; vehicle arrows are drawn against it.
  const [mapHeadingDegrees, setMapHeadingDegrees] = useState(0);
  const showsUserLocation = useHasLocationPermission();

  const itinerary = 'itinerary' in props ? props.itinerary : undefined;
  const itineraries = 'itineraries' in props ? props.itineraries : undefined;
  const selectedItineraryId = 'itineraries' in props ? props.selectedItineraryId : undefined;
  const points = 'points' in props ? props.points : undefined;
  const model = useMemo(() => {
    if (itinerary) return buildMapModel({ itinerary });
    if (itineraries) return buildMapModel({ itineraries, selectedItineraryId });
    return buildMapModel({ points: points ?? [] });
  }, [itinerary, itineraries, selectedItineraryId, points]);

  useImperativeHandle(ref, () => ({
    showCoordinate: (coordinate) => {
      const region = regionFor([coordinate]);
      if (region) mapRef.current?.animateToRegion(region);
    },
  }));

  // Re-frame whenever the content or the covered area changes; the map is a native view, so
  // this is synchronising with it rather than deriving React state.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || model.coordinates.length === 0) return;
    const [only] = model.coordinates;
    // Fitting one point zooms in as far as MapKit goes; a fixed span reads better.
    if (model.coordinates.length === 1 && only) {
      const region = regionFor([only]);
      if (region) map.animateToRegion(region);
      return;
    }
    map.fitToCoordinates(model.coordinates.map(toLatLng), {
      edgePadding: {
        top: FRAME_PADDING,
        right: FRAME_PADDING,
        bottom: FRAME_PADDING + bottomInset,
        left: FRAME_PADDING,
      },
      animated: true,
    });
  }, [mapReady, model, bottomInset]);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={regionFor(model.coordinates)}
        mapType="mutedStandard"
        userInterfaceStyle={theme.scheme}
        showsUserLocation={showsUserLocation}
        mapPadding={{ top: 0, right: 0, bottom: bottomInset, left: 0 }}
        pitchEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={() => {
          // Read after every move, with or without vehicles, so an arrow first drawn after the map
          // was turned points true. A camera that cannot be read leaves the arrows as they were;
          // they are a hint, and the markers themselves stay in the right places.
          mapRef.current
            ?.getCamera()
            .then((camera) => setMapHeadingDegrees(camera.heading ?? 0))
            .catch(() => undefined);
        }}>
        {model.lines.map((line) => (
          <Polyline
            key={line.id}
            coordinates={line.coordinates.map(toLatLng)}
            strokeColor={
              line.emphasis === 'selected'
                ? theme.modeColours[line.mode]
                : `${theme.modeColours[line.mode]}66`
            }
            strokeWidth={line.emphasis === 'selected' ? 5 : 3}
            lineDashPattern={DASH_PATTERNS[line.pattern]}
            lineCap="round"
            lineJoin="round"
          />
        ))}
        {model.markers.map((item) => (
          <Marker
            key={item.id}
            coordinate={toLatLng(item.coordinate)}
            title={item.title}
            accessibilityLabel={item.accessibilityLabel}>
            <MarkerBadge kind={item.kind} />
          </Marker>
        ))}
        {vehicles.map((vehicle) => (
          <Marker
            // A stable key lets MapKit move the marker to its new position instead of redrawing it.
            key={vehicle.key}
            coordinate={toLatLng(vehicle.coordinate)}
            anchor={{ x: 0.5, y: 0.5 }}
            accessibilityLabel={vehicle.accessibilityLabel}
            testID={`vehicle-${vehicle.key}`}>
            <VehicleBadge vehicle={vehicle} mapHeadingDegrees={mapHeadingDegrees} />
          </Marker>
        ))}
      </MapView>
      {/* VoiceOver cannot describe drawn routes, so a summary sits over the map. It does not
          take touches, and the markers and Apple's legal link stay reachable by swiping. */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? model.summary}
        style={[StyleSheet.absoluteFill, styles.passThrough]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  passThrough: {
    pointerEvents: 'none',
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previousTrip: {
    opacity: 0.6,
  },
  headingTrack: {
    alignItems: 'center',
  },
});
