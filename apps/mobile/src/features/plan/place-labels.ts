import type { Place, PlanRequest } from '@hopready/core';
import type { SFSymbol } from 'expo-symbols';

import { CURRENT_LOCATION_LABEL } from '@/location';
import { type FavouriteRoute, isSamePlace, type SavedPlaces } from '@/storage';

// The name a person gave a place (Home, Work, a favourite), when the place is one they saved.
export function savedLabelFor(place: Place, saved: SavedPlaces): string | null {
  if (saved.home && isSamePlace(place, saved.home)) return 'Home';
  if (saved.work && isSamePlace(place, saved.work)) return 'Work';
  return saved.favourites.find((favourite) => isSamePlace(place, favourite.place))?.label ?? null;
}

export interface PlaceTitle {
  title: string;
  // The address or stop name, when the title is a saved label that does not say where it is.
  detail: string | null;
}

export function placeTitle(place: Place, saved: SavedPlaces): PlaceTitle {
  if (place.kind === 'current-location') {
    return {
      title: CURRENT_LOCATION_LABEL,
      detail: place.name === CURRENT_LOCATION_LABEL ? null : place.name,
    };
  }
  const label = savedLabelFor(place, saved);
  return label && label !== place.name
    ? { title: label, detail: place.name }
    : { title: place.name, detail: null };
}

export type QuickPick =
  | { key: 'current-location'; kind: 'current-location'; label: string; symbol: SFSymbol }
  | { key: string; kind: 'place'; label: string; symbol: SFSymbol; place: Place };

const MAX_FAVOURITE_PICKS = 3;
const MAX_RECENT_PICKS = 3;
// Planner-internal kinds (car parks, a parked car) are never typed in by a person.
const PICKABLE_KINDS: ReadonlySet<Place['kind']> = new Set(['address', 'stop', 'poi']);

// Places from recent trips, newest first, that are not already saved under a name.
export function recentPlaces(
  recents: readonly PlanRequest[],
  saved: SavedPlaces,
  limit: number,
): Place[] {
  const places: Place[] = [];
  for (const request of recents) {
    for (const place of [request.destination, request.origin]) {
      if (places.length >= limit) return places;
      if (!PICKABLE_KINDS.has(place.kind)) continue;
      if (savedLabelFor(place, saved) !== null) continue;
      if (places.some((existing) => isSamePlace(existing, place))) continue;
      places.push(place);
    }
  }
  return places;
}

export function buildQuickPicks(
  saved: SavedPlaces,
  recents: readonly PlanRequest[],
  options: { includeCurrentLocation: boolean },
): QuickPick[] {
  const picks: QuickPick[] = [];
  if (options.includeCurrentLocation) {
    picks.push({
      key: 'current-location',
      kind: 'current-location',
      label: CURRENT_LOCATION_LABEL,
      symbol: 'location.fill',
    });
  }
  if (saved.home) {
    picks.push({
      key: 'home',
      kind: 'place',
      label: 'Home',
      symbol: 'house.fill',
      place: saved.home,
    });
  }
  if (saved.work) {
    picks.push({
      key: 'work',
      kind: 'place',
      label: 'Work',
      symbol: 'briefcase.fill',
      place: saved.work,
    });
  }
  for (const favourite of saved.favourites.slice(0, MAX_FAVOURITE_PICKS)) {
    picks.push({
      key: `favourite:${favourite.id}`,
      kind: 'place',
      label: favourite.label,
      symbol: 'star.fill',
      place: favourite.place,
    });
  }
  recentPlaces(recents, saved, MAX_RECENT_PICKS).forEach((place, index) => {
    picks.push({
      key: `recent:${index}:${place.name}`,
      kind: 'place',
      label: place.name,
      symbol: 'clock.arrow.circlepath',
      place,
    });
  });
  return picks;
}

export interface RouteShortcut {
  key: string;
  title: string;
  subtitle: string;
  origin: Place;
  destination: Place;
  // Only a recent trip carries how the person chose to travel last time.
  access: PlanRequest['access'] | null;
}

function routeTitle(origin: Place, destination: Place, saved: SavedPlaces) {
  const from = placeTitle(origin, saved).title;
  const to = placeTitle(destination, saved).title;
  return { title: `To ${to}`, subtitle: `From ${from}` };
}

export function favouriteRouteShortcuts(
  routes: readonly FavouriteRoute[],
  saved: SavedPlaces,
): RouteShortcut[] {
  return routes.map((route) => ({
    key: `favourite-route:${route.id}`,
    title: route.label,
    subtitle: `${placeTitle(route.origin, saved).title} to ${placeTitle(route.destination, saved).title}`,
    origin: route.origin,
    destination: route.destination,
    access: null,
  }));
}

// Recent trips from the Plan tab. Trips home through a parked car belong to the Car tab: their
// car position may be out of date, so they are not offered for one-tap planning here.
export function recentTripShortcuts(
  recents: readonly PlanRequest[],
  saved: SavedPlaces,
  limit: number,
): RouteShortcut[] {
  return recents
    .filter((request) => request.trip.kind === 'outbound')
    .slice(0, limit)
    .map((request, index) => ({
      key: `recent-trip:${index}`,
      ...routeTitle(request.origin, request.destination, saved),
      origin: request.origin,
      destination: request.destination,
      access: request.access,
    }));
}
