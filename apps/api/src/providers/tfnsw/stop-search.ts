import {
  haversineMetres,
  isWithinGreaterSydney,
  placeSchema,
  type Coordinate,
  type Place,
  type PlaceSearchProvider,
  type PlaceSuggestion,
} from '@hopready/core';

import type { TfnswClient } from './client';
import type { DiagnosticSink, TfnswDiagnostic } from './diagnostics';
import { coordinateFromLatLon, nonEmptyText } from './fields';
import {
  stopFinderLocationSchema,
  stopFinderResponseSchema,
  type StopFinderLocation,
} from './schemas';

const PROVIDER = 'tfnsw-trip-planner';
// Shorter queries match too much to be useful and would spend the shared TfNSW quota on keystrokes.
export const MIN_QUERY_LENGTH = 3;
export const MAX_SUGGESTIONS = 8;
const STOP_TYPES: ReadonlySet<string> = new Set(['stop', 'platform']);
const AREA_TYPES: ReadonlySet<string> = new Set(['locality', 'suburb']);

export function stopFinderParams(query: string): Record<string, string> {
  return {
    outputFormat: 'rapidJSON',
    type_sf: 'any',
    name_sf: query,
    coordOutputFormat: 'EPSG:4326',
    TfNSWSF: 'true',
  };
}

interface Candidate {
  suggestion: PlaceSuggestion;
  isStop: boolean;
  matchQuality: number;
  distanceMetres: number;
  position: number;
}

export interface StopSearchMapping {
  suggestions: PlaceSuggestion[];
  diagnostics: TfnswDiagnostic[];
}

export function mapStopFinderResponse(
  locations: readonly unknown[],
  near: Coordinate | null,
): StopSearchMapping {
  const candidates: Candidate[] = [];
  let unreadable = 0;

  locations.forEach((raw, position) => {
    const parsed = stopFinderLocationSchema.safeParse(raw);
    if (!parsed.success) {
      unreadable += 1;
      return;
    }
    const location = parsed.data;
    const isStop = STOP_TYPES.has(location.type);
    if (!isStop && location.type !== 'poi') return;

    const coordinate = coordinateFromLatLon(location.coord);
    if (!coordinate) {
      unreadable += 1;
      return;
    }
    if (!isWithinGreaterSydney(coordinate)) return;

    const place = placeFrom(location, coordinate, isStop);
    if (!place) {
      unreadable += 1;
      return;
    }
    candidates.push({
      suggestion: { place, detail: areaName(location) },
      isStop,
      matchQuality: location.matchQuality ?? Number.NEGATIVE_INFINITY,
      distanceMetres: near ? haversineMetres(near, coordinate) : 0,
      position,
    });
  });

  // Stops first, then TfNSW's match quality, then distance from the traveller, then TfNSW's order.
  candidates.sort(
    (a, b) =>
      Number(b.isStop) - Number(a.isStop) ||
      b.matchQuality - a.matchQuality ||
      a.distanceMetres - b.distanceMetres ||
      a.position - b.position,
  );

  const seen = new Set<string>();
  const suggestions: PlaceSuggestion[] = [];
  for (const { suggestion } of candidates) {
    const { place } = suggestion;
    const key = place.stopId
      ? `stop:${place.stopId}`
      : `poi:${place.name}:${place.coordinate.lat}:${place.coordinate.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(suggestion);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }

  const diagnostics: TfnswDiagnostic[] =
    unreadable > 0 ? [{ kind: 'stops-dropped', reason: 'unreadable', count: unreadable }] : [];
  return { suggestions, diagnostics };
}

function placeFrom(
  location: StopFinderLocation,
  coordinate: Coordinate,
  isStop: boolean,
): Place | null {
  const name = nonEmptyText(location.disassembledName, location.name);
  const parsed = placeSchema.safeParse(
    isStop
      ? { name, coordinate, kind: 'stop', stopId: location.id }
      : { name, coordinate, kind: 'poi' },
  );
  return parsed.success ? parsed.data : null;
}

// The suburb a result is in, from its parent (stops) or grandparent (platforms inside a station).
function areaName(location: StopFinderLocation): string | null {
  const parent = location.parent;
  if (parent && AREA_TYPES.has(parent.type ?? '')) return nonEmptyText(parent.name);
  const grandparent = parent?.parent;
  if (grandparent && AREA_TYPES.has(grandparent.type ?? '')) return nonEmptyText(grandparent.name);
  return null;
}

export function createStopSearchProvider(
  client: TfnswClient,
  report: DiagnosticSink,
): PlaceSearchProvider {
  return {
    name: PROVIDER,
    async search(
      query: string,
      near: Coordinate | null,
      signal: AbortSignal,
    ): Promise<PlaceSuggestion[]> {
      const text = query.trim();
      if (text.length < MIN_QUERY_LENGTH) return [];
      const response = await client.get({
        provider: PROVIDER,
        path: '/v1/tp/stop_finder',
        params: stopFinderParams(text),
        parse: (body) => stopFinderResponseSchema.parse(body),
        signal,
      });
      const mapping = mapStopFinderResponse(response.locations ?? [], near);
      mapping.diagnostics.forEach(report);
      return mapping.suggestions;
    },
  };
}
