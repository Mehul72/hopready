import { describe, expect, it } from 'vitest';

import {
  isTrackedVehicleMode,
  MAX_TRACKED_SERVICES,
  uniqueTrackedServices,
  vehicleLookupSchema,
  vehiclesRequestSchema,
  vehiclesResponseSchema,
} from './vehicles';

const BUS = { mode: 'bus', realtimeTripId: '2703224' } as const;
const TRAIN = { mode: 'train', realtimeTripId: '814P.1417.150.2.A.8.91974280' } as const;

describe('vehiclesRequestSchema', () => {
  it('accepts the trip ids TfNSW sends for buses, trains and metro', () => {
    const request = {
      services: [BUS, TRAIN, { mode: 'metro', realtimeTripId: '0273-001-152-008:1000' }],
    };
    expect(vehiclesRequestSchema.parse(request)).toEqual(request);
  });

  it('needs at least one service and takes no more than a trip could have', () => {
    expect(vehiclesRequestSchema.safeParse({ services: [] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_TRACKED_SERVICES + 1 }, (_, index) => ({
      mode: 'bus',
      realtimeTripId: String(index),
    }));
    expect(vehiclesRequestSchema.safeParse({ services: tooMany }).success).toBe(false);
    expect(
      vehiclesRequestSchema.safeParse({ services: tooMany.slice(0, MAX_TRACKED_SERVICES) }).success,
    ).toBe(true);
  });

  it('refuses trip ids that are empty, too long, or carry spaces or control characters', () => {
    for (const realtimeTripId of ['', 'x'.repeat(121), '27 03', '2703\n224', 'bus→1']) {
      expect(
        vehiclesRequestSchema.safeParse({ services: [{ mode: 'bus', realtimeTripId }] }).success,
      ).toBe(false);
    }
  });

  it('refuses a mode HopReady does not know', () => {
    expect(
      vehiclesRequestSchema.safeParse({ services: [{ mode: 'tram', realtimeTripId: '1' }] })
        .success,
    ).toBe(false);
  });
});

describe('vehicleLookupSchema', () => {
  const located = {
    ...BUS,
    status: 'located',
    position: { lat: -33.892, lon: 151.25 },
    bearingDegrees: 78,
    observedAt: '2026-11-01T03:41:32Z',
    servingTrip: 'this-trip',
  };

  it('reads each status', () => {
    expect(vehicleLookupSchema.parse(located)).toEqual(located);
    for (const status of ['not-located', 'not-tracked', 'unavailable']) {
      expect(vehicleLookupSchema.parse({ ...TRAIN, status })).toEqual({ ...TRAIN, status });
    }
  });

  it('allows no bearing, but not one of 360 or more', () => {
    expect(vehicleLookupSchema.safeParse({ ...located, bearingDegrees: null }).success).toBe(true);
    expect(vehicleLookupSchema.safeParse({ ...located, bearingDegrees: 360 }).success).toBe(false);
    expect(vehicleLookupSchema.safeParse({ ...located, bearingDegrees: -1 }).success).toBe(false);
  });

  it('needs a position and an observed time for a located vehicle', () => {
    const { position: _position, ...withoutPosition } = located;
    expect(vehicleLookupSchema.safeParse(withoutPosition).success).toBe(false);
    expect(
      vehicleLookupSchema.safeParse({ ...located, observedAt: '2026-11-01 14:41' }).success,
    ).toBe(false);
  });
});

describe('vehiclesResponseSchema', () => {
  it('reads an answer', () => {
    const response = {
      mode: 'live',
      checkedAt: '2026-11-01T03:41:42Z',
      vehicles: [{ ...TRAIN, status: 'not-located' }],
    };
    expect(vehiclesResponseSchema.parse(response)).toEqual(response);
  });
});

describe('uniqueTrackedServices', () => {
  it('keeps the order asked and drops repeats of the same service', () => {
    expect(uniqueTrackedServices([BUS, TRAIN, BUS])).toEqual([BUS, TRAIN]);
  });

  it('keeps the same trip id under two modes apart', () => {
    const asTrain = { mode: 'train', realtimeTripId: BUS.realtimeTripId } as const;
    expect(uniqueTrackedServices([BUS, asTrain])).toEqual([BUS, asTrain]);
  });
});

describe('isTrackedVehicleMode', () => {
  it('tracks buses, trains and metro only', () => {
    expect(['bus', 'train', 'metro'].every((mode) => isTrackedVehicleMode(mode as never))).toBe(
      true,
    );
    for (const mode of ['light-rail', 'ferry', 'coach', 'school-bus', 'on-demand', 'other']) {
      expect(isTrackedVehicleMode(mode as never)).toBe(false);
    }
  });
});
