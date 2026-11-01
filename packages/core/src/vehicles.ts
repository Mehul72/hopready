import { z } from 'zod';

import { coordinateSchema, transitModeSchema, type TransitMode } from './model';

// Where the vehicles running a trip's services are now (POST /v1/vehicles). Shared by the API, which
// answers it, and the app, which asks it while a trip's map is open.

// Modes with a live position feed HopReady reads. Any other mode answers 'not-tracked'.
export const TRACKED_VEHICLE_MODES = [
  'bus',
  'train',
  'metro',
] as const satisfies readonly TransitMode[];

export function isTrackedVehicleMode(mode: TransitMode): boolean {
  return (TRACKED_VEHICLE_MODES as readonly TransitMode[]).includes(mode);
}

// A trip has a handful of services; more than this in one request is not a trip.
export const MAX_TRACKED_SERVICES = 8;

// TfNSW trip ids are printable ASCII such as "814P.1417.150.2.A.8.91974280" or "2703224".
const realtimeTripIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\x21-\x7e]+$/);

export const trackedServiceSchema = z.object({
  mode: transitModeSchema,
  realtimeTripId: realtimeTripIdSchema,
});
export type TrackedService = z.infer<typeof trackedServiceSchema>;

export const vehiclesRequestSchema = z.object({
  services: z.array(trackedServiceSchema).min(1).max(MAX_TRACKED_SERVICES),
});
export type VehiclesRequest = z.infer<typeof vehiclesRequestSchema>;

// 'previous-trip' means the vehicle that will run this service is still finishing the one before,
// so it may be far away or heading the other way.
export const SERVING_TRIPS = ['this-trip', 'previous-trip'] as const;

export const VEHICLE_STATUSES = ['located', 'not-located', 'not-tracked', 'unavailable'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

const serviceKey = {
  mode: transitModeSchema,
  realtimeTripId: realtimeTripIdSchema,
};

export const vehicleLookupSchema = z.discriminatedUnion('status', [
  z.object({
    ...serviceKey,
    status: z.literal('located'),
    position: coordinateSchema,
    // Degrees clockwise from north, or null when the feed gives none (Sydney Trains does not).
    bearingDegrees: z.number().min(0).lt(360).nullable(),
    // When the vehicle reported this position, which can be minutes before the feed was read.
    observedAt: z.iso.datetime({ offset: true }),
    servingTrip: z.enum(SERVING_TRIPS),
  }),
  // The feed was read and has no vehicle for this trip now: not started, finished or not reporting.
  z.object({ ...serviceKey, status: z.literal('not-located') }),
  // HopReady has no live position feed for this mode.
  z.object({ ...serviceKey, status: z.literal('not-tracked') }),
  // The feed could not be read just now.
  z.object({ ...serviceKey, status: z.literal('unavailable') }),
]);
export type VehicleLookup = z.infer<typeof vehicleLookupSchema>;
export type LocatedVehicle = Extract<VehicleLookup, { status: 'located' }>;

export const vehiclesResponseSchema = z.object({
  mode: z.enum(['live', 'demo']),
  checkedAt: z.iso.datetime({ offset: true }),
  // One per requested service, in the order asked, with duplicates removed.
  vehicles: z.array(vehicleLookupSchema),
});
export type VehiclesResponse = z.infer<typeof vehiclesResponseSchema>;

export function trackedServiceKey(service: TrackedService): string {
  return `${service.mode}|${service.realtimeTripId}`;
}

// The services in the order asked, each once.
export function uniqueTrackedServices(services: readonly TrackedService[]): TrackedService[] {
  const seen = new Set<string>();
  return services.filter((service) => {
    const key = trackedServiceKey(service);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
