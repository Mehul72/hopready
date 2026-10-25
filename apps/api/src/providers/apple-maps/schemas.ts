import { z } from 'zod';

// Shapes from developer.apple.com/documentation/applemapsserverapi. Apple marks every field
// optional and some arrive as null, so presence is checked where used; types are checked here.
function optional<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullish().transform((value) => value ?? undefined);
}

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const seconds = z.number().nonnegative();
const metres = z.number().nonnegative();

const locationSchema = z.object({ latitude, longitude });
export type AppleLocation = z.infer<typeof locationSchema>;

// The Location object documents latitude and longitude, but Apple's own autocomplete example
// shows lat and lng, so both spellings are read.
const autocompleteLocationSchema = z.union([
  locationSchema,
  z
    .object({ lat: latitude, lng: longitude })
    .transform(({ lat, lng }): AppleLocation => ({ latitude: lat, longitude: lng })),
]);

const structuredAddressSchema = z.object({
  fullThoroughfare: optional(z.string()),
  locality: optional(z.string()),
  subLocality: optional(z.string()),
  subAdministrativeArea: optional(z.string()),
  administrativeArea: optional(z.string()),
  postCode: optional(z.string()),
});
export type AppleStructuredAddress = z.infer<typeof structuredAddressSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresInSeconds: z.number().positive(),
});

export const etaResponseSchema = z.object({
  etas: optional(
    z.array(
      z.object({
        destination: optional(locationSchema),
        distanceMeters: optional(metres),
        expectedTravelTimeSeconds: optional(seconds),
        staticTravelTimeSeconds: optional(seconds),
      }),
    ),
  ),
});
export type AppleEta = NonNullable<z.infer<typeof etaResponseSchema>['etas']>[number];

export const directionsResponseSchema = z.object({
  routes: optional(
    z.array(
      z.object({
        distanceMeters: optional(metres),
        durationSeconds: optional(seconds),
        stepIndexes: optional(z.array(z.number().int().nonnegative())),
      }),
    ),
  ),
  steps: optional(z.array(z.object({ stepPathIndex: optional(z.number().int().nonnegative()) }))),
  stepPaths: optional(z.array(z.array(locationSchema))),
});
export type AppleDirections = z.infer<typeof directionsResponseSchema>;

export const autocompleteResponseSchema = z.object({
  results: optional(
    z.array(
      z.object({
        completionUrl: optional(z.string()),
        displayLines: optional(z.array(z.string())),
        location: optional(autocompleteLocationSchema),
        structuredAddress: optional(structuredAddressSchema),
      }),
    ),
  ),
});
export type AppleAutocompleteResult = NonNullable<
  z.infer<typeof autocompleteResponseSchema>['results']
>[number];

export const searchResponseSchema = z.object({
  results: optional(
    z.array(
      z.object({
        coordinate: optional(locationSchema),
        poiCategory: optional(z.string()),
        structuredAddress: optional(structuredAddressSchema),
      }),
    ),
  ),
});
