import { z } from 'zod';

// One shared model for every provider. Unknown values are explicit ("unknown" states or null),
// never zero or a default that could read as real data.

export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const PLACE_KINDS = [
  'address',
  'stop',
  'poi',
  'current-location',
  'car-park',
  'saved-parking',
  'parked-car',
] as const;

export const placeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  coordinate: coordinateSchema,
  kind: z.enum(PLACE_KINDS),
  stopId: z.string().max(64).optional(),
  carParkId: z.string().max(64).optional(),
});
export type Place = z.infer<typeof placeSchema>;

const isoInstant = z.iso.datetime({ offset: true });

export const TRANSIT_MODES = [
  'train',
  'metro',
  'light-rail',
  'bus',
  'coach',
  'ferry',
  'school-bus',
  'on-demand',
  'other',
] as const;
export const transitModeSchema = z.enum(TRANSIT_MODES);
export type TransitMode = z.infer<typeof transitModeSchema>;

export const DATA_SOURCES = [
  'tfnsw-trip-planner',
  'tfnsw-car-park',
  'apple-maps',
  'google-routes',
  'hopready',
  'user',
  'demo-fixture',
] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

// realtime: live prediction from the operator; scheduled: timetable only;
// estimated: a model estimate such as a traffic-aware drive; buffer: time the user asked us to allow.
export const TIMING_KINDS = ['realtime', 'scheduled', 'estimated', 'buffer'] as const;
export type Timing = (typeof TIMING_KINDS)[number];

export const alertSchema = z.object({
  id: z.string(),
  severity: z.enum(['info', 'warning', 'severe']),
  title: z.string(),
  detail: z.string().optional(),
  url: z.url().optional(),
});
export type ServiceAlert = z.infer<typeof alertSchema>;

export const occupancySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('known'),
    spacesAvailable: z.number().int().nonnegative(),
    totalSpaces: z.number().int().positive(),
    observedAt: isoInstant,
  }),
  z.object({
    status: z.literal('stale'),
    spacesAvailable: z.number().int().nonnegative(),
    totalSpaces: z.number().int().positive(),
    observedAt: isoInstant,
  }),
  z.object({ status: z.literal('unknown'), reason: z.string() }),
]);
export type Occupancy = z.infer<typeof occupancySchema>;

// Rules are about whether and how long you may park. They are kept apart from occupancy on purpose:
// a free space says nothing about whether parking there is allowed.
export const parkingRulesSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('documented'),
    summary: z.string(),
    sourceUrl: z.url(),
    checkedOn: z.iso.date(),
  }),
  z.object({ status: z.literal('unknown') }),
]);
export type ParkingRules = z.infer<typeof parkingRulesSchema>;

export const CAR_PARK_KINDS = ['transport-park-and-ride', 'user-saved'] as const;
export const carParkSchema = z.object({
  id: z.string().max(64),
  name: z.string(),
  coordinate: coordinateSchema,
  kind: z.enum(CAR_PARK_KINDS),
  stationName: z.string().nullable(),
  totalSpaces: z.number().int().positive().nullable(),
});
export type CarPark = z.infer<typeof carParkSchema>;

export const parkingSchema = z.object({
  carPark: carParkSchema,
  occupancy: occupancySchema,
  rules: parkingRulesSchema,
});
export type Parking = z.infer<typeof parkingSchema>;

export const fareSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('known'),
    adultCents: z.number().int().nonnegative(),
    currency: z.literal('AUD'),
    source: z.enum(DATA_SOURCES),
  }),
  z.object({ status: z.literal('unknown') }),
]);
export type Fare = z.infer<typeof fareSchema>;

const legBase = {
  id: z.string(),
  from: placeSchema,
  to: placeSchema,
  start: isoInstant,
  end: isoInstant,
  source: z.enum(DATA_SOURCES),
  timing: z.enum(TIMING_KINDS),
  path: z.array(coordinateSchema).optional(),
};

export const driveLegSchema = z.object({
  ...legBase,
  kind: z.literal('drive'),
  distanceMetres: z.number().nonnegative(),
  trafficAware: z.boolean(),
});

// Someone else drives (drop-off). Modelled apart from 'drive' so a return trip never sends this
// traveller back for a car they do not have.
export const rideLegSchema = z.object({
  ...legBase,
  kind: z.literal('ride'),
  distanceMetres: z.number().nonnegative(),
  trafficAware: z.boolean(),
});

export const walkLegSchema = z.object({
  ...legBase,
  kind: z.literal('walk'),
  distanceMetres: z.number().nonnegative().nullable(),
});

export const transitServiceSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  headsign: z.string().nullable(),
  operator: z.string().nullable(),
});

export const transitLegSchema = z.object({
  ...legBase,
  kind: z.literal('transit'),
  mode: transitModeSchema,
  service: transitServiceSchema,
  scheduledStart: isoInstant,
  scheduledEnd: isoInstant,
  // Only what the provider states, and null when it states none. The app says a departure platform
  // is not provided, and leaves out an arrival platform it was not given.
  departurePlatform: z.string().nullable(),
  arrivalPlatform: z.string().nullable(),
  stopCount: z.number().int().nonnegative().nullable(),
  cancelled: z.boolean(),
  alerts: z.array(alertSchema),
  realtimeTripId: z.string().nullable(),
});

export const parkLegSchema = z.object({
  ...legBase,
  kind: z.literal('park'),
  parking: parkingSchema,
});
export const dropOffLegSchema = z.object({ ...legBase, kind: z.literal('drop-off') });
export const waitLegSchema = z.object({ ...legBase, kind: z.literal('wait') });
export const carRetrievalLegSchema = z.object({ ...legBase, kind: z.literal('car-retrieval') });

export const legSchema = z.discriminatedUnion('kind', [
  driveLegSchema,
  rideLegSchema,
  walkLegSchema,
  transitLegSchema,
  parkLegSchema,
  dropOffLegSchema,
  waitLegSchema,
  carRetrievalLegSchema,
]);
export type Leg = z.infer<typeof legSchema>;
export type LegKind = Leg['kind'];
export type DriveLeg = z.infer<typeof driveLegSchema>;
export type RideLeg = z.infer<typeof rideLegSchema>;
export type WalkLeg = z.infer<typeof walkLegSchema>;
export type TransitLeg = z.infer<typeof transitLegSchema>;
export type ParkLeg = z.infer<typeof parkLegSchema>;

export const STRATEGIES = [
  'transit-only',
  'park-and-ride',
  'drop-off',
  'drive-only',
  'return-via-car',
  'transit-home',
] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const itinerarySchema = z.object({
  id: z.string(),
  strategy: z.enum(STRATEGIES),
  legs: z.array(legSchema).min(1),
  departAt: isoInstant,
  arriveAt: isoInstant,
  durationSeconds: z.number().int().nonnegative(),
  driveSeconds: z.number().int().nonnegative(),
  walkSeconds: z.number().int().nonnegative(),
  waitSeconds: z.number().int().nonnegative(),
  transfers: z.number().int().nonnegative(),
  parking: parkingSchema.nullable(),
  fare: fareSchema,
  accessibility: z.enum(['step-free', 'not-step-free', 'unknown']),
  realtime: z.enum(['full', 'partial', 'none']),
  alerts: z.array(alertSchema),
  notes: z.array(z.string()),
});
export type Itinerary = z.infer<typeof itinerarySchema>;

export const WALKING_SPEEDS = ['slow', 'normal', 'fast'] as const;

export const preferencesSchema = z.object({
  maxDriveMinutes: z.number().int().min(5).max(120),
  maxWalkMinutes: z.number().int().min(1).max(60),
  parkingBufferMinutes: z.number().int().min(0).max(30),
  dropOffBufferMinutes: z.number().int().min(0).max(15),
  transferBufferMinutes: z.number().int().min(0).max(20),
  carRetrievalBufferMinutes: z.number().int().min(0).max(30),
  walkingSpeed: z.enum(WALKING_SPEEDS),
  excludedTransitModes: z.array(transitModeSchema).max(TRANSIT_MODES.length),
});
export type Preferences = z.infer<typeof preferencesSchema>;

// Defaults are explained in the app's settings screen and in docs/design/routing.md.
export const DEFAULT_PREFERENCES: Preferences = {
  maxDriveMinutes: 30,
  maxWalkMinutes: 15,
  parkingBufferMinutes: 8,
  dropOffBufferMinutes: 2,
  transferBufferMinutes: 3,
  carRetrievalBufferMinutes: 5,
  walkingSpeed: 'normal',
  excludedTransitModes: [],
};

export const parkedCarSchema = z.object({
  location: placeSchema,
  carParkId: z.string().max(64).nullable(),
  confirmedAt: isoInstant,
});
export type ParkedCar = z.infer<typeof parkedCarSchema>;

export const savedParkingSpotSchema = z.object({
  id: z.string().max(64),
  name: z.string().trim().min(1).max(120),
  coordinate: coordinateSchema,
});
export type SavedParkingSpot = z.infer<typeof savedParkingSpotSchema>;

export const tripSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('outbound') }),
  z.object({ kind: z.literal('return-via-car'), parkedCar: parkedCarSchema }),
  z.object({ kind: z.literal('return-without-car') }),
]);
export type TripKind = z.infer<typeof tripSchema>;

export const planRequestSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  time: z.object({ type: z.enum(['depart', 'arrive']), at: isoInstant }),
  access: z.object({ transit: z.boolean(), drive: z.boolean(), dropOff: z.boolean() }),
  preferences: preferencesSchema,
  preferredCarParkId: z.string().max(64).optional(),
  preferredStop: placeSchema.optional(),
  savedParkingSpots: z.array(savedParkingSpotSchema).max(10).optional(),
  trip: tripSchema,
});
export type PlanRequest = z.infer<typeof planRequestSchema>;

export const REJECTION_REASONS = [
  'transfer-too-short',
  'walk-too-long',
  'drive-too-long',
  'cancelled-service',
  'departs-in-past',
  'departs-before-requested',
  'arrives-after-target',
  'discontinuous',
  'duplicate',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const CAR_PARK_OUTCOMES = [
  'used',
  // Its option worked but is left out: a car park shown with it is as good.
  'matched-by-another',
  // Its option worked but is left out: more options worked than the list has room for.
  'left-out-for-space',
  'too-far-to-drive',
  'not-towards-destination',
  // Within reach and on the way, but other car parks were tried first (maxTransferCandidates).
  'not-tried',
  'no-workable-connection',
  'provider-error',
] as const;

export const planResponseSchema = z.object({
  mode: z.enum(['live', 'demo']),
  generatedAt: isoInstant,
  itineraries: z.array(itinerarySchema),
  rejected: z.array(
    z.object({ reason: z.enum(REJECTION_REASONS), count: z.number().int().positive() }),
  ),
  checkedCarParks: z.array(
    z.object({ id: z.string(), name: z.string(), outcome: z.enum(CAR_PARK_OUTCOMES) }),
  ),
  unavailable: z.array(z.object({ strategy: z.enum(STRATEGIES), reason: z.string() })),
  notices: z.array(z.string()),
});
export type PlanResponse = z.infer<typeof planResponseSchema>;
