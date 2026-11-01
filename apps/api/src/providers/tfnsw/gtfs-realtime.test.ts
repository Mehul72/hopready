import { haversineMetres } from '@hopready/core';
import { describe, expect, it } from 'vitest';

import { decodeVehiclePositions, GtfsRealtimeDecodeError } from './gtfs-realtime';
import {
  loadRecordedFeed,
  protobufBytes,
  protobufVarint,
  syntheticVehicleFeed,
} from './test-support';

// Saved from TfNSW on Sunday 1 November 2026 at 14:41 AEDT and trimmed with
// scripts/trim-vehicle-feed.ts. The trip ids came from Trip Planner plans made in the same minute.
const BONDI_380 = '2703224';
const BONDI_333 = '2534597';
const CENTRAL_T1 = '814P.1417.150.2.A.8.91974280';
const CENTRAL_STATION = { lat: -33.884024, lon: 151.206203 };
const HEADER_SECONDS = 1_793_504_502;

describe('decodeVehiclePositions on recorded TfNSW feeds', () => {
  it('finds the buses a plan named, with position, bearing and report time', () => {
    const feed = decodeVehiclePositions(loadRecordedFeed('vehiclepos-buses.pb'));

    expect(feed.feedTimestampMs).toBe(HEADER_SECONDS * 1_000);
    const bus380 = feed.fixes.get(BONDI_380);
    expect(bus380?.position.lat).toBeCloseTo(-33.89204, 5);
    expect(bus380?.position.lon).toBeCloseTo(151.25021, 5);
    expect(bus380?.bearingDegrees).toBe(78);
    expect(bus380?.observedAtMs).toBeLessThan(HEADER_SECONDS * 1_000);
    expect(bus380?.onPreviousTrip).toBe(false);
    expect(feed.fixes.get(BONDI_333)?.bearingDegrees).toBe(107);
  });

  it('reads TfNSW’s flag for a bus still finishing its previous trip', () => {
    const fixes = [
      ...decodeVehiclePositions(loadRecordedFeed('vehiclepos-buses.pb')).fixes.values(),
    ];
    expect(fixes.filter((fix) => fix.onPreviousTrip)).toHaveLength(10);
  });

  it('finds a Sydney Trains service at Central, with no bearing because the feed sends none', () => {
    const feed = decodeVehiclePositions(loadRecordedFeed('vehiclepos-sydneytrains.pb'));
    const train = feed.fixes.get(CENTRAL_T1);

    expect(train).toBeDefined();
    expect(haversineMetres(train!.position, CENTRAL_STATION)).toBeLessThan(200);
    expect(train!.bearingDegrees).toBeNull();
  });

  it('reads every metro vehicle under TfNSW’s metro trip ids', () => {
    const feed = decodeVehiclePositions(loadRecordedFeed('vehiclepos-metro.pb'));

    expect(feed.fixes.size).toBe(24);
    for (const tripId of feed.fixes.keys()) {
      expect(tripId).toMatch(/^\d{4}-\d{3}-\d{3}-\d{3}:\d{4}$/);
    }
  });

  it('puts every position it keeps inside NSW', () => {
    for (const file of [
      'vehiclepos-buses.pb',
      'vehiclepos-sydneytrains.pb',
      'vehiclepos-metro.pb',
    ]) {
      for (const fix of decodeVehiclePositions(loadRecordedFeed(file)).fixes.values()) {
        expect(fix.position.lat).toBeLessThan(-27.5);
        expect(fix.position.lat).toBeGreaterThan(-38.5);
      }
    }
  });
});

describe('decodeVehiclePositions on built feeds', () => {
  const at = { lat: -33.87, lon: 151.21 };

  it('uses the feed’s time for a vehicle that reports none', () => {
    const feed = decodeVehiclePositions(
      syntheticVehicleFeed([{ tripId: 'a', ...at }], { headerTimestampSeconds: 1_000 }),
    );
    expect(feed.fixes.get('a')?.observedAtMs).toBe(1_000_000);
  });

  it('leaves out a vehicle with no time at all, no trip, or no usable position', () => {
    const feed = decodeVehiclePositions(
      syntheticVehicleFeed([
        { tripId: 'no-time', ...at },
        { ...at, timestampSeconds: 5 },
        { tripId: 'null-island', lat: 0, lon: 0, timestampSeconds: 5 },
        { tripId: 'no-position', timestampSeconds: 5 },
        { tripId: 'kept', ...at, timestampSeconds: 5 },
      ]),
    );
    expect([...feed.fixes.keys()]).toEqual(['kept']);
    expect(feed.skipped).toBe(4);
  });

  it('keeps the later of two reports for one trip', () => {
    const feed = decodeVehiclePositions(
      syntheticVehicleFeed([
        { tripId: 'a', lat: -33.8, lon: 151.1, timestampSeconds: 20 },
        { tripId: 'a', lat: -33.9, lon: 151.2, timestampSeconds: 10 },
      ]),
    );
    expect(feed.fixes.get('a')?.observedAtMs).toBe(20_000);
    expect(feed.fixes.get('a')?.position.lat).toBeCloseTo(-33.8, 5);
  });

  it('ignores a deleted vehicle', () => {
    const feed = decodeVehiclePositions(
      syntheticVehicleFeed([{ tripId: 'a', ...at, timestampSeconds: 5, deleted: true }]),
    );
    expect(feed.fixes.size).toBe(0);
    expect(feed.skipped).toBe(0);
  });

  it('turns any bearing into 0 to 359.99 degrees', () => {
    const feed = decodeVehiclePositions(
      syntheticVehicleFeed([
        { tripId: 'over', ...at, bearing: 450, timestampSeconds: 5 },
        { tripId: 'negative', ...at, bearing: -90, timestampSeconds: 5 },
        { tripId: 'full-turn', ...at, bearing: 360, timestampSeconds: 5 },
      ]),
    );
    expect(feed.fixes.get('over')?.bearingDegrees).toBe(90);
    expect(feed.fixes.get('negative')?.bearingDegrees).toBe(270);
    expect(feed.fixes.get('full-turn')?.bearingDegrees).toBe(0);
  });

  it('leaves out a trip id that is not valid UTF-8', () => {
    const feed = decodeVehiclePositions(
      syntheticVehicleFeed([{ tripId: new Uint8Array([0xff, 0xfe]), ...at, timestampSeconds: 5 }]),
    );
    expect(feed.fixes.size).toBe(0);
    expect(feed.skipped).toBe(1);
  });

  it('skips fields it does not read, whatever their type', () => {
    const vehicle = [
      ...protobufBytes(1, protobufBytes(1, [...new TextEncoder().encode('a')])),
      ...protobufBytes(2, [0x0d, 0, 0, 0, 0]), // a position holding only a latitude of 0
      ...protobufVarint(9, 3), // occupancy status
      ...[0x51, 1, 2, 3, 4, 5, 6, 7, 8], // field 10 as fixed64
      ...protobufVarint(5, 7),
    ];
    const feed = decodeVehiclePositions(
      new Uint8Array([...protobufBytes(2, protobufBytes(4, vehicle)), ...protobufVarint(99, 1)]),
    );
    expect(feed.fixes.size).toBe(0);
    expect(feed.skipped).toBe(1);
  });

  it('reads an empty feed as no vehicles', () => {
    expect(decodeVehiclePositions(new Uint8Array(0))).toEqual({
      feedTimestampMs: null,
      fixes: new Map(),
      skipped: 0,
    });
  });
});

describe('decodeVehiclePositions on broken input', () => {
  it('refuses a feed cut off part way', () => {
    const whole = loadRecordedFeed('vehiclepos-metro.pb');
    expect(() => decodeVehiclePositions(whole.subarray(0, whole.length - 3))).toThrow(
      GtfsRealtimeDecodeError,
    );
  });

  it('refuses bytes that are not protobuf', () => {
    for (const bytes of [
      [0x0b], // a group start, which GTFS-realtime never uses
      [0x07], // wire type 7 does not exist
      [0x00, 0x01], // field number 0
      [0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01], // an 11 byte number
    ]) {
      expect(() => decodeVehiclePositions(new Uint8Array(bytes))).toThrow(GtfsRealtimeDecodeError);
    }
  });

  it('refuses a JSON error page sent in place of the feed', () => {
    const page = new TextEncoder().encode('{"ErrorDetails":{"Message":"Service unavailable"}}');
    expect(() => decodeVehiclePositions(page)).toThrow(GtfsRealtimeDecodeError);
  });
});
