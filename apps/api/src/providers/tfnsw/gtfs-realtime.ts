import type { Coordinate } from '@hopready/core';

// Reads TfNSW's GTFS-realtime Vehicle Positions feeds (protobuf). Only what a vehicle map needs is
// decoded: each vehicle's trip id, position, bearing, report time and TfNSW's flag for a vehicle
// still finishing the trip before. Everything else is skipped by wire type, so new fields in the
// feed never break it. Written by hand because Workers forbid the runtime code generation protobuf
// libraries use, and five fields do not justify one.

export interface VehicleFix {
  tripId: string;
  position: Coordinate;
  // Degrees clockwise from north, or null when the feed does not say.
  bearingDegrees: number | null;
  // When the vehicle reported this position; the feed's own time when the vehicle gives none.
  observedAtMs: number;
  onPreviousTrip: boolean;
}

export interface VehicleFeed {
  feedTimestampMs: number | null;
  // By trip id. Of two reports for one trip, the later wins.
  fixes: Map<string, VehicleFix>;
  // Vehicles left out: no trip, no usable position or no report time.
  skipped: number;
}

export class GtfsRealtimeDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GtfsRealtimeDecodeError';
  }
}

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

// Field numbers from gtfs-realtime.proto and TfNSW's extension (number 1007).
const FEED_HEADER = 1;
const FEED_ENTITY = 2;
const HEADER_TIMESTAMP = 3;
const ENTITY_IS_DELETED = 2;
const ENTITY_VEHICLE = 4;
const VEHICLE_TRIP = 1;
const VEHICLE_POSITION = 2;
const VEHICLE_TIMESTAMP = 5;
const VEHICLE_DESCRIPTOR = 8;
const TRIP_ID = 1;
const POSITION_LATITUDE = 1;
const POSITION_LONGITUDE = 2;
const POSITION_BEARING = 3;
const TFNSW_VEHICLE_DESCRIPTOR = 1007;
const TFNSW_PERFORMING_PRIOR_TRIP = 4;

// NSW with a margin. A position outside it, or the 0,0 some feeds send for "unknown", is not one.
const NSW_BOUNDS = { south: -38.5, north: -27.5, west: 140.5, east: 154 } as const;
const MAX_VARINT_BYTES = 10;
const MS_PER_SECOND = 1_000;

// A cursor over one message's bytes. next() moves to the next field and leaves its number, wire
// type and value in the cursor, so a feed of thousands of vehicles allocates no field objects: the
// feed is decoded on the request path, where Workers Free allows 10 ms of CPU.
class Cursor {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #end: number;
  #offset: number;
  number = 0;
  wireType = 0;
  // Varints (exact up to 2^53, far past any timestamp), and fixed32 or fixed64 as floats.
  numeric = 0;
  // A length-delimited field's bytes, as offsets into the same buffer.
  start = 0;
  stop = 0;

  constructor(bytes: Uint8Array, view: DataView, start: number, end: number) {
    this.#bytes = bytes;
    this.#view = view;
    this.#offset = start;
    this.#end = end;
  }

  static over(bytes: Uint8Array): Cursor {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Cursor(bytes, view, 0, bytes.length);
  }

  // A cursor over the current length-delimited field.
  inner(): Cursor {
    return new Cursor(this.#bytes, this.#view, this.start, this.stop);
  }

  text(): string | null {
    try {
      return textDecoder.decode(this.#bytes.subarray(this.start, this.stop));
    } catch {
      return null;
    }
  }

  next(): boolean {
    if (this.#offset >= this.#end) return false;
    const key = this.#varint();
    this.number = Math.floor(key / 8);
    this.wireType = key % 8;
    if (this.number === 0) throw new GtfsRealtimeDecodeError('A field has number 0');
    switch (this.wireType) {
      case WIRE_VARINT:
        this.numeric = this.#varint();
        return true;
      case WIRE_FIXED64:
        this.#need(8);
        this.numeric = this.#view.getFloat64(this.#offset, true);
        this.#offset += 8;
        return true;
      case WIRE_LENGTH_DELIMITED: {
        const length = this.#varint();
        this.#need(length);
        this.start = this.#offset;
        this.stop = this.#offset + length;
        this.#offset = this.stop;
        return true;
      }
      case WIRE_FIXED32:
        this.#need(4);
        this.numeric = this.#view.getFloat32(this.#offset, true);
        this.#offset += 4;
        return true;
      default:
        // Groups (3 and 4) are not used by GTFS-realtime; anything else is not protobuf.
        throw new GtfsRealtimeDecodeError(`Unsupported wire type ${this.wireType}`);
    }
  }

  #varint(): number {
    let value = 0;
    let scale = 1;
    for (let read = 0; read < MAX_VARINT_BYTES; read++) {
      if (this.#offset >= this.#end) {
        throw new GtfsRealtimeDecodeError('The feed ends inside a number');
      }
      const byte = this.#bytes[this.#offset++]!;
      value += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return value;
      scale *= 128;
    }
    throw new GtfsRealtimeDecodeError('A number runs past ten bytes');
  }

  #need(length: number): void {
    if (this.#offset + length > this.#end) {
      throw new GtfsRealtimeDecodeError('The feed ends inside a field');
    }
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function decodeVehiclePositions(feed: Uint8Array): VehicleFeed {
  let feedTimestampMs: number | null = null;
  const vehicles: Cursor[] = [];
  const top = Cursor.over(feed);
  while (top.next()) {
    if (top.wireType !== WIRE_LENGTH_DELIMITED) continue;
    if (top.number === FEED_HEADER) feedTimestampMs = headerTimestampMs(top.inner());
    else if (top.number === FEED_ENTITY) {
      const vehicle = vehicleOf(top.inner());
      if (vehicle) vehicles.push(vehicle);
    }
  }

  const fixes = new Map<string, VehicleFix>();
  let skipped = 0;
  for (const vehicle of vehicles) {
    const fix = fixOf(vehicle, feedTimestampMs);
    if (!fix) {
      skipped += 1;
      continue;
    }
    const earlier = fixes.get(fix.tripId);
    if (!earlier || earlier.observedAtMs < fix.observedAtMs) fixes.set(fix.tripId, fix);
  }
  return { feedTimestampMs, fixes, skipped };
}

function headerTimestampMs(header: Cursor): number | null {
  while (header.next()) {
    if (header.number === HEADER_TIMESTAMP && header.wireType === WIRE_VARINT) {
      return header.numeric > 0 ? header.numeric * MS_PER_SECOND : null;
    }
  }
  return null;
}

// The entity's VehiclePosition, unless the entity is deleted or carries something else.
function vehicleOf(entity: Cursor): Cursor | null {
  let vehicle: Cursor | null = null;
  while (entity.next()) {
    if (entity.number === ENTITY_IS_DELETED && entity.wireType === WIRE_VARINT) {
      if (entity.numeric === 1) return null;
    } else if (entity.number === ENTITY_VEHICLE && entity.wireType === WIRE_LENGTH_DELIMITED) {
      vehicle = entity.inner();
    }
  }
  return vehicle;
}

function fixOf(vehicle: Cursor, feedTimestampMs: number | null): VehicleFix | null {
  let tripId: string | null = null;
  let position: { coordinate: Coordinate; bearingDegrees: number | null } | null = null;
  let observedAtMs: number | null = null;
  let onPreviousTrip = false;
  while (vehicle.next()) {
    const nested = vehicle.wireType === WIRE_LENGTH_DELIMITED;
    if (vehicle.number === VEHICLE_TRIP && nested) tripId = tripIdOf(vehicle.inner());
    else if (vehicle.number === VEHICLE_POSITION && nested) position = positionOf(vehicle.inner());
    else if (vehicle.number === VEHICLE_TIMESTAMP && vehicle.wireType === WIRE_VARINT) {
      if (vehicle.numeric > 0) observedAtMs = vehicle.numeric * MS_PER_SECOND;
    } else if (vehicle.number === VEHICLE_DESCRIPTOR && nested) {
      onPreviousTrip = performingPriorTrip(vehicle.inner());
    }
  }
  const reportedAtMs = observedAtMs ?? feedTimestampMs;
  if (!tripId || !position || reportedAtMs === null) return null;
  return {
    tripId,
    position: position.coordinate,
    bearingDegrees: position.bearingDegrees,
    observedAtMs: reportedAtMs,
    onPreviousTrip,
  };
}

function tripIdOf(trip: Cursor): string | null {
  while (trip.next()) {
    if (trip.number !== TRIP_ID || trip.wireType !== WIRE_LENGTH_DELIMITED) continue;
    const text = trip.text();
    return text && text.length > 0 ? text : null;
  }
  return null;
}

function positionOf(
  position: Cursor,
): { coordinate: Coordinate; bearingDegrees: number | null } | null {
  let lat: number | null = null;
  let lon: number | null = null;
  let bearing: number | null = null;
  while (position.next()) {
    if (position.wireType !== WIRE_FIXED32) continue;
    if (position.number === POSITION_LATITUDE) lat = position.numeric;
    else if (position.number === POSITION_LONGITUDE) lon = position.numeric;
    else if (position.number === POSITION_BEARING) bearing = position.numeric;
  }
  if (lat === null || lon === null || !isInNsw(lat, lon)) return null;
  return {
    coordinate: { lat, lon },
    bearingDegrees:
      bearing !== null && Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : null,
  };
}

function isInNsw(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= NSW_BOUNDS.south &&
    lat <= NSW_BOUNDS.north &&
    lon >= NSW_BOUNDS.west &&
    lon <= NSW_BOUNDS.east
  );
}

function performingPriorTrip(descriptor: Cursor): boolean {
  while (descriptor.next()) {
    if (
      descriptor.number !== TFNSW_VEHICLE_DESCRIPTOR ||
      descriptor.wireType !== WIRE_LENGTH_DELIMITED
    ) {
      continue;
    }
    const extension = descriptor.inner();
    while (extension.next()) {
      if (extension.number === TFNSW_PERFORMING_PRIOR_TRIP && extension.wireType === WIRE_VARINT) {
        return extension.numeric === 1;
      }
    }
    return false;
  }
  return false;
}
