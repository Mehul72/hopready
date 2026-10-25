import {
  DEFAULT_PREFERENCES,
  itinerarySchema,
  parkedCarSchema,
  placeSchema,
  planRequestSchema,
  preferencesSchema,
  savedParkingSpotSchema,
} from '@hopready/core';
import { z } from 'zod';

const isoInstant = z.iso.datetime({ offset: true });
const itemId = z.string().min(1).max(64);
const label = z.string().trim().min(1).max(60);

export const MAX_FAVOURITE_PLACES = 30;
export const MAX_FAVOURITE_ROUTES = 30;
export const MAX_RECENT_REQUESTS = 20;
// A plan request carries at most this many saved spots (core planRequestSchema), so storage
// never holds more than a request can use.
export const MAX_SAVED_PARKING_SPOTS = 10;

export const NAVIGATION_APPS = ['ask', 'apple', 'google', 'waze'] as const;
export type NavigationApp = (typeof NAVIGATION_APPS)[number];

export const appPreferencesSchema = preferencesSchema.extend({
  navigationApp: z.enum(NAVIGATION_APPS),
});
export type AppPreferences = z.infer<typeof appPreferencesSchema>;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  ...DEFAULT_PREFERENCES,
  navigationApp: 'ask',
};

export const favouritePlaceSchema = z.object({
  id: itemId,
  label,
  place: placeSchema,
});
export type FavouritePlace = z.infer<typeof favouritePlaceSchema>;

export const savedPlacesSchema = z.object({
  home: placeSchema.nullable(),
  work: placeSchema.nullable(),
  favourites: z.array(favouritePlaceSchema).max(MAX_FAVOURITE_PLACES),
});
export type SavedPlaces = z.infer<typeof savedPlacesSchema>;

export const favouriteRouteSchema = z.object({
  id: itemId,
  label,
  origin: placeSchema,
  destination: placeSchema,
});
export type FavouriteRoute = z.infer<typeof favouriteRouteSchema>;

export const favouriteRoutesSchema = z.array(favouriteRouteSchema).max(MAX_FAVOURITE_ROUTES);

export const recentRequestsSchema = z.array(planRequestSchema).max(MAX_RECENT_REQUESTS);

export const parkedCarStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: z.literal('parked'),
    parkedCar: parkedCarSchema,
    carParkName: z.string().trim().min(1).max(200).nullable(),
  }),
  // Someone else drove: going home must never route back to a car.
  z.object({ status: z.literal('dropped-off'), at: isoInstant }),
]);
export type ParkedCarState = z.infer<typeof parkedCarStateSchema>;

export const savedParkingSpotsSchema = z.array(savedParkingSpotSchema).max(MAX_SAVED_PARKING_SPOTS);

export const activeTripSchema = z
  .object({
    request: planRequestSchema,
    itinerary: itinerarySchema,
    plannedAt: isoInstant,
    // A trip planned with sample data stays labelled as such, and is never refreshed as live.
    mode: z.enum(['live', 'demo']),
  })
  .nullable();
export type ActiveTrip = NonNullable<z.infer<typeof activeTripSchema>>;
