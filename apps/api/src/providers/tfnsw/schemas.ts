import { z } from 'zod';

// Schemas for the parts of TfNSW responses HopReady relies on. Unknown fields are dropped, so additions
// on TfNSW's side do not break parsing; fields the mapping needs are required here or checked where used.
// Sources: Trip Planner Swagger (tripplanner_v1_swag_efa11_20251002.yml), Car Park API documentation
// v2.4, and real responses published in the KRAIL project's test assets.

// Trip Planner coordinates are [latitude, longitude]. Longitude comes first only in request parameters.
export const latLonPairSchema = z.array(z.number()).min(2);

const instantSchema = z.iso.datetime({ offset: true });

// Real responses send realtimeStatus as an array (["MONITORED"]); a bare string is accepted too.
export const statusListSchema = z.union([z.array(z.string()), z.string()]);

const parentLocationSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  coord: latLonPairSchema.nullish(),
  parent: z.object({ name: z.string().nullish(), type: z.string().nullish() }).nullish(),
});

const tripLocationSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  disassembledName: z.string().nullish(),
  type: z.string().nullish(),
  coord: latLonPairSchema.nullish(),
  parent: parentLocationSchema.nullish(),
  properties: z.object({ realtimeStatus: statusListSchema.nullish() }).nullish(),
});

const legOriginSchema = tripLocationSchema.extend({
  departureTimePlanned: instantSchema,
  departureTimeEstimated: instantSchema.nullish(),
});

const legDestinationSchema = tripLocationSchema.extend({
  arrivalTimePlanned: instantSchema,
  arrivalTimeEstimated: instantSchema.nullish(),
});

const transportationSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  disassembledName: z.string().nullish(),
  number: z.string().nullish(),
  description: z.string().nullish(),
  iconId: z.number().nullish(),
  product: z.object({
    class: z.number(),
    iconId: z.number().nullish(),
    name: z.string().nullish(),
  }),
  destination: z.object({ name: z.string().nullish() }).nullish(),
  operator: z.object({ name: z.string().nullish() }).nullish(),
  properties: z.object({ RealtimeTripId: z.string().nullish() }).nullish(),
});

export const footPathInfoSchema = z.object({
  position: z.string().nullish(),
  duration: z.number().nullish(),
});

export const tripInfoSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  priority: z.string().nullish(),
  subtitle: z.string().nullish(),
  urlText: z.string().nullish(),
  content: z.string().nullish(),
  url: z.string().nullish(),
});

export const stopSequenceEntrySchema = z.object({
  properties: z.object({ realtimeStatus: statusListSchema.nullish() }).nullish(),
});

export const tripLegSchema = z.object({
  origin: legOriginSchema,
  destination: legDestinationSchema,
  transportation: transportationSchema,
  duration: z.number().nullish(),
  distance: z.number().nullish(),
  isRealtimeControlled: z.boolean().nullish(),
  realtimeStatus: statusListSchema.nullish(),
  // Items below are parsed one by one, so one odd entry costs only itself, not the journey.
  coords: z.array(z.unknown()).nullish(),
  infos: z.array(z.unknown()).nullish(),
  stopSequence: z.array(z.unknown()).nullish(),
  footPathInfo: z.array(z.unknown()).nullish(),
  interchange: z
    .object({
      type: z.number().nullish(),
      coords: z.array(z.unknown()).nullish(),
    })
    .nullish(),
});
export type TripLeg = z.infer<typeof tripLegSchema>;
export type TripLocation = z.infer<typeof tripLocationSchema>;
export type Transportation = z.infer<typeof transportationSchema>;

export const tripJourneySchema = z.object({ legs: z.array(tripLegSchema).min(1) });
export type TripJourney = z.infer<typeof tripJourneySchema>;

// The spec describes systemMessages as { responseMessages: [...] }; real responses send a bare array.
const systemMessageSchema = z.object({ code: z.number().nullish(), type: z.string().nullish() });
const systemMessagesSchema = z.union([
  z.array(systemMessageSchema),
  z.object({ responseMessages: z.array(systemMessageSchema).nullish() }),
]);

export const tripResponseSchema = z.object({
  // Journeys are parsed one by one: an unreadable journey is dropped and counted, not fatal.
  journeys: z.array(z.unknown()).nullish(),
  systemMessages: systemMessagesSchema.nullish(),
});
export type TripResponse = z.infer<typeof tripResponseSchema>;

export const stopFinderLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  disassembledName: z.string().nullish(),
  type: z.string(),
  coord: latLonPairSchema,
  matchQuality: z.number().nullish(),
  parent: parentLocationSchema.nullish(),
});
export type StopFinderLocation = z.infer<typeof stopFinderLocationSchema>;

export const stopFinderResponseSchema = z.object({
  locations: z.array(z.unknown()).nullish(),
});

// The Car Park API sends numbers as strings ("121"); a few real responses use plain numbers.
const numberLikeSchema = z.union([z.string(), z.number()]);

// GET /v1/carpark with no facility: real responses are an object of facility ID to name. The
// documentation describes facility_id and facility_name fields, so that array form is accepted too.
export const carParkListSchema = z.union([
  z.record(z.string(), z.string()),
  z.array(z.object({ facility_id: numberLikeSchema, facility_name: z.string() })),
]);

// GET /v1/carpark?facility=<id>
export const carParkFacilitySchema = z.object({
  facility_id: numberLikeSchema,
  facility_name: z.string().nullish(),
  tsn: numberLikeSchema.nullish(),
  spots: numberLikeSchema.nullish(),
  location: z
    .object({
      latitude: numberLikeSchema.nullish(),
      longitude: numberLikeSchema.nullish(),
    })
    .nullish(),
  occupancy: z.object({ total: numberLikeSchema.nullish() }).nullish(),
  MessageDate: z.string().nullish(),
});
export type CarParkFacilityFeed = z.infer<typeof carParkFacilitySchema>;
