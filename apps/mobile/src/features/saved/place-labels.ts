import type { Place } from '@hopready/core';

// Storage accepts labels up to 60 characters (src/storage/schemas.ts).
const LABEL_MAX_LENGTH = 60;
const PARKING_SPOT_NAME_MAX_LENGTH = 120;
const STARTS_WITH_STREET_NUMBER = /^\d/;

// "Rouse Hill" for "12 Example Street, Rouse Hill", so a route label stays short; stops and named
// places keep their first part, such as "Chatswood Station".
export function shortPlaceName(place: Place): string {
  const parts = place.name
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const [first] = parts;
  const last = parts[parts.length - 1];
  if (!first || !last) return place.name.trim();
  return STARTS_WITH_STREET_NUMBER.test(first) ? last : first;
}

export function favouriteLabelFor(place: Place): string {
  return place.name.trim().slice(0, LABEL_MAX_LENGTH);
}

export function routeLabelFor(origin: Place, destination: Place): string {
  return `${shortPlaceName(origin)} to ${shortPlaceName(destination)}`.slice(0, LABEL_MAX_LENGTH);
}

export function parkingSpotNameFor(place: Place): string {
  return place.name.trim().slice(0, PARKING_SPOT_NAME_MAX_LENGTH);
}

// A saved place is a fixed spot. Kept as "current location" it would be re-located every time it
// is used, so it becomes an address with the label found for it.
export function asFixedPlace(place: Place): Place {
  return place.kind === 'current-location' ? { ...place, kind: 'address' } : place;
}
