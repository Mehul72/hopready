import {
  type CarParkFacility,
  carParkSchema,
  type Occupancy,
  occupancySchema,
  parkingRulesSchema,
  placeSchema,
} from '@hopready/core';
import { z } from 'zod';

// Response shapes for the HopReady API. They mirror the core types, so the server can build them
// straight from its providers and the app checks every field before using it.

export const placeSuggestionSchema = z.object({
  place: placeSchema,
  // A second line such as the suburb or "Train station", when the provider gives one.
  detail: z.string().nullable(),
});

// POST /v1/places/search with { query, near: { lat, lon } | null }
export const placeSearchResponseSchema = z.object({
  results: z.array(placeSuggestionSchema),
  // Search sources that did not answer (provider names such as 'apple-maps'), so the screen can
  // say that some results may be missing.
  unavailable: z.array(z.string()),
});
export type PlaceSearchResults = z.infer<typeof placeSearchResponseSchema>;

export const carParkFacilitySchema = carParkSchema.extend({
  rules: parkingRulesSchema,
  station: placeSchema.nullable(),
});

export const carParkStatusSchema = carParkFacilitySchema.extend({
  occupancy: occupancySchema,
});
export type CarParkStatus = CarParkFacility & { occupancy: Occupancy };

// GET /v1/carparks
export const carParksResponseSchema = z.object({
  carParks: z.array(carParkStatusSchema),
  // Plain-language notes, for example that occupancy figures are unavailable right now.
  notices: z.array(z.string()).default([]),
});
export interface CarParkListing {
  carParks: CarParkStatus[];
  notices: string[];
}

// Error bodies: `{ "code": "not-configured" }` or `{ "error": { "code": "not-configured" } }`.
// Only the code is read; the server's message is never shown, the app has its own wording.
export const apiErrorBodySchema = z.union([
  z.object({ code: z.string() }),
  z.object({ error: z.object({ code: z.string() }) }),
]);

export function errorCodeOf(body: unknown): string | null {
  const parsed = apiErrorBodySchema.safeParse(body);
  if (!parsed.success) return null;
  return 'code' in parsed.data ? parsed.data.code : parsed.data.error.code;
}
