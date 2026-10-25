import type { Coordinate, Itinerary, Leg } from '@hopready/core';

import { LEG_VISUALS, type LegVisualKind, legVisualKind } from '@/theme';

export type MapMarkerKind =
  'origin' | 'destination' | 'car-park' | 'parked-car' | 'drop-off' | 'transfer' | 'place';

export interface MapPoint {
  id: string;
  coordinate: Coordinate;
  kind: MapMarkerKind;
  label: string;
}

export interface MapMarkerModel {
  id: string;
  kind: MapMarkerKind;
  coordinate: Coordinate;
  title: string;
  accessibilityLabel: string;
}

export interface MapLineModel {
  id: string;
  mode: LegVisualKind;
  coordinates: Coordinate[];
  // Walking is dashed. A leg without a provider path is drawn as a dotted straight line, so it never
  // passes for a real route.
  pattern: 'solid' | 'dashed' | 'dotted';
  // Unselected options are drawn thinner and fainter behind the selected one.
  emphasis: 'selected' | 'muted';
}

export interface MapModel {
  lines: MapLineModel[];
  markers: MapMarkerModel[];
  // Everything the camera should show.
  coordinates: Coordinate[];
  // What VoiceOver reads for the map; the timeline beside it carries the full detail.
  summary: string;
}

export type TripMapContent =
  | { itinerary: Itinerary }
  | { itineraries: readonly Itinerary[]; selectedItineraryId?: string | null }
  | { points: readonly MapPoint[] };

const MOVING_LEG_KINDS: ReadonlySet<Leg['kind']> = new Set(['drive', 'ride', 'walk', 'transit']);

const MARKER_TITLES: Readonly<Record<MapMarkerKind, string>> = {
  origin: 'Start',
  destination: 'Destination',
  'car-park': 'Car park',
  'parked-car': 'Your car',
  'drop-off': 'Drop-off',
  transfer: 'Change',
  place: 'Place',
};

function marker(id: string, kind: MapMarkerKind, coordinate: Coordinate, name: string) {
  return {
    id,
    kind,
    coordinate,
    title: name,
    accessibilityLabel: `${MARKER_TITLES[kind]}: ${name}`,
  };
}

function lineFor(leg: Leg, key: string, emphasis: MapLineModel['emphasis']): MapLineModel {
  const hasPath = leg.path !== undefined && leg.path.length >= 2;
  const coordinates = hasPath ? [...(leg.path ?? [])] : [leg.from.coordinate, leg.to.coordinate];
  const pattern = leg.kind === 'walk' ? 'dashed' : hasPath ? 'solid' : 'dotted';
  return {
    id: key,
    mode: legVisualKind(leg),
    coordinates,
    pattern,
    emphasis,
  };
}

function linesFor(itinerary: Itinerary, emphasis: MapLineModel['emphasis']): MapLineModel[] {
  // Leg ids come from providers and are not promised to be unique, so the position is part of
  // the key.
  return itinerary.legs.flatMap((leg, index) =>
    MOVING_LEG_KINDS.has(leg.kind)
      ? [lineFor(leg, `${itinerary.id}:${index}:${leg.id}`, emphasis)]
      : [],
  );
}

function markersFor(itinerary: Itinerary): MapMarkerModel[] {
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  if (!first || !last) return [];
  const markers: MapMarkerModel[] = [
    marker('origin', 'origin', first.from.coordinate, first.from.name),
  ];
  let seenTransit = false;
  for (const leg of itinerary.legs) {
    if (leg.kind === 'park') {
      const carPark = leg.parking.carPark;
      markers.push(marker(`car-park:${carPark.id}`, 'car-park', leg.to.coordinate, carPark.name));
    } else if (leg.kind === 'drop-off') {
      markers.push(marker(`drop-off:${leg.id}`, 'drop-off', leg.to.coordinate, leg.to.name));
    } else if (leg.kind === 'car-retrieval') {
      markers.push(marker(`parked-car:${leg.id}`, 'parked-car', leg.to.coordinate, leg.to.name));
    } else if (leg.kind === 'transit') {
      if (seenTransit) {
        markers.push(marker(`transfer:${leg.id}`, 'transfer', leg.from.coordinate, leg.from.name));
      }
      seenTransit = true;
    }
  }
  markers.push(marker('destination', 'destination', last.to.coordinate, last.to.name));
  return markers;
}

function legPhrase(leg: Leg): string | null {
  switch (leg.kind) {
    case 'transit': {
      const mode = LEG_VISUALS[leg.mode].label;
      return `${mode} ${leg.service.name} to ${leg.to.name}`;
    }
    case 'drive':
      return `drive to ${leg.to.name}`;
    case 'ride':
      return `get a lift to ${leg.to.name}`;
    case 'walk':
      return `walk to ${leg.to.name}`;
    case 'park':
    case 'drop-off':
    case 'wait':
    case 'car-retrieval':
      return null;
  }
}

export function describeItineraryRoute(itinerary: Itinerary): string {
  const first = itinerary.legs[0];
  const last = itinerary.legs[itinerary.legs.length - 1];
  if (!first || !last) return 'Map of the trip.';
  const steps = itinerary.legs.flatMap((leg) => legPhrase(leg) ?? []);
  return `Map of the trip from ${first.from.name} to ${last.to.name}: ${steps.join(', then ')}.`;
}

function uniqueById(markers: readonly MapMarkerModel[]): MapMarkerModel[] {
  const seen = new Set<string>();
  return markers.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function collectCoordinates(lines: readonly MapLineModel[], markers: readonly MapMarkerModel[]) {
  return [...lines.flatMap((line) => line.coordinates), ...markers.map((item) => item.coordinate)];
}

export function buildMapModel(content: TripMapContent): MapModel {
  if ('itinerary' in content) {
    const lines = linesFor(content.itinerary, 'selected');
    const markers = markersFor(content.itinerary);
    return {
      lines,
      markers,
      coordinates: collectCoordinates(lines, markers),
      summary: describeItineraryRoute(content.itinerary),
    };
  }

  if ('itineraries' in content) {
    const selected =
      content.itineraries.find((itinerary) => itinerary.id === content.selectedItineraryId) ??
      content.itineraries[0];
    const others = content.itineraries.filter((itinerary) => itinerary !== selected);
    // Muted options first, so the selected one is drawn on top.
    const lines = [
      ...others.flatMap((itinerary) => linesFor(itinerary, 'muted')),
      ...(selected ? linesFor(selected, 'selected') : []),
    ];
    const markers = uniqueById([
      ...(selected ? markersFor(selected) : []),
      ...others.flatMap((itinerary) =>
        markersFor(itinerary).filter((item) => item.kind === 'car-park'),
      ),
    ]);
    const count = content.itineraries.length;
    const summary = selected
      ? `Map of ${count} trip ${count === 1 ? 'option' : 'options'}. Highlighted: ${describeItineraryRoute(selected)}`
      : 'Map with no trip options.';
    return { lines, markers, coordinates: collectCoordinates(lines, markers), summary };
  }

  const markers = content.points.map((point) =>
    marker(point.id, point.kind, point.coordinate, point.label),
  );
  const names = content.points.map((point) => point.label);
  return {
    lines: [],
    markers,
    coordinates: markers.map((item) => item.coordinate),
    summary:
      names.length === 0
        ? 'Map.'
        : `Map showing ${names.length === 1 ? '' : `${names.length} places: `}${names.join(', ')}.`,
  };
}
