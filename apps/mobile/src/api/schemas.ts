import {
  CAR_PARK_OUTCOMES,
  type CarParkFacility,
  carParkSchema,
  type Occupancy,
  occupancySchema,
  parkingRulesSchema,
  placeSchema,
  planResponseSchema,
  REJECTION_REASONS,
  SERVING_TRIPS,
  VEHICLE_STATUSES,
  vehiclesResponseSchema,
} from '@hopready/core';
import { z } from 'zod';

// Response shapes for the HopReady API. They mirror the core types, so the server can build them
// straight from its providers and the app checks every field before using it.

// 'demo' when the API serves its labelled sample data (HOPREADY_MODE=demo, for local end-to-end
// runs). The app labels those answers as demo even while it is in live mode.
export const apiModeSchema = z.enum(['live', 'demo']);
export type ApiMode = z.infer<typeof apiModeSchema>;

export const placeSuggestionSchema = z.object({
  place: placeSchema,
  // A second line such as the suburb or "Train station", when the provider gives one.
  detail: z.string().nullable(),
});

// POST /v1/places/search with { query, near: { lat, lon } | null }
export const placeSearchResponseSchema = z.object({
  mode: apiModeSchema,
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
  mode: apiModeSchema,
  carParks: z.array(carParkStatusSchema),
  // Plain-language notes, for example that occupancy figures are unavailable right now.
  notices: z.array(z.string()).default([]),
});
export interface CarParkListing {
  mode: ApiMode;
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

const KNOWN_CAR_PARK_OUTCOMES = new Set<string>(CAR_PARK_OUTCOMES);
const KNOWN_REJECTION_REASONS = new Set<string>(REJECTION_REASONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The server gains car park outcomes and rejection reasons before every phone has the update.
// Build 2 rejected a whole plan over one unknown outcome. Now an unknown outcome reads as
// 'not-understood', and an unknown reason is left out of the explanations; the rest is checked as
// strictly as before.
export const planResponseForThisAppSchema = z.preprocess((raw) => {
  if (!isRecord(raw)) return raw;
  const { checkedCarParks, rejected } = raw;
  return {
    ...raw,
    checkedCarParks: Array.isArray(checkedCarParks)
      ? checkedCarParks.map((carPark) =>
          isRecord(carPark) &&
          typeof carPark.outcome === 'string' &&
          !KNOWN_CAR_PARK_OUTCOMES.has(carPark.outcome)
            ? { ...carPark, outcome: 'not-understood' }
            : carPark,
        )
      : checkedCarParks,
    rejected: Array.isArray(rejected)
      ? rejected.filter(
          (rejection) =>
            !isRecord(rejection) ||
            typeof rejection.reason !== 'string' ||
            KNOWN_REJECTION_REASONS.has(rejection.reason),
        )
      : rejected,
  };
}, planResponseSchema);

const KNOWN_VEHICLE_STATUSES = new Set<string>(VEHICLE_STATUSES);
const KNOWN_SERVING_TRIPS = new Set<string>(SERVING_TRIPS);

// POST /v1/vehicles. The server can gain vehicle statuses before every phone has the update, so an
// unknown status reads as 'unavailable' (no position, no claim about why), and an unknown
// servingTrip as 'this-trip'. Everything else is checked as strictly as the server's schema.
export const vehiclesResponseForThisAppSchema = z.preprocess((raw) => {
  if (!isRecord(raw) || !Array.isArray(raw.vehicles)) return raw;
  return {
    ...raw,
    vehicles: raw.vehicles.map((vehicle) => {
      if (!isRecord(vehicle) || typeof vehicle.status !== 'string') return vehicle;
      if (!KNOWN_VEHICLE_STATUSES.has(vehicle.status)) {
        return {
          mode: vehicle.mode,
          realtimeTripId: vehicle.realtimeTripId,
          status: 'unavailable',
        };
      }
      if (
        vehicle.status === 'located' &&
        typeof vehicle.servingTrip === 'string' &&
        !KNOWN_SERVING_TRIPS.has(vehicle.servingTrip)
      ) {
        return { ...vehicle, servingTrip: 'this-trip' };
      }
      return vehicle;
    }),
  };
}, vehiclesResponseSchema);
