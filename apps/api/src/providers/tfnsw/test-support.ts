import { readFileSync } from 'node:fs';

import type { FetchImplementation } from '../http';

// Builders for the TfNSW adapter tests. Samples live in __fixtures__ (see the README there).

const FIXTURES_DIRECTORY = new URL('./__fixtures__/', import.meta.url);

export function loadFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(new URL(fileName, FIXTURES_DIRECTORY), 'utf8'));
}

// A fresh copy that a test can change without touching other tests' fixtures.
export function loadFixtureCopy<T>(fileName: string): T {
  return structuredClone(loadFixture(fileName)) as T;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export interface RecordedRequest {
  url: URL;
  headers: Headers;
}

export type FakeFetch = FetchImplementation & { requests: RecordedRequest[] };

export function fakeFetch(respond: (url: URL) => Response | Promise<Response>): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    return respond(url);
  };
  return Object.assign(fetchImpl, { requests });
}

export function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

// A tiny protobuf writer for GTFS-realtime Vehicle Positions tests. Field numbers follow
// gtfs-realtime.proto and TfNSW's extension 1007; see gtfs-realtime.ts.
export interface SyntheticVehicle {
  tripId?: string | Uint8Array;
  lat?: number;
  lon?: number;
  bearing?: number;
  timestampSeconds?: number;
  onPreviousTrip?: boolean;
  deleted?: boolean;
}

function varintBytes(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 128) {
    bytes.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
}

export function protobufVarint(number: number, value: number): number[] {
  return [...varintBytes(number * 8), ...varintBytes(value)];
}

export function protobufBytes(number: number, bytes: readonly number[] | Uint8Array): number[] {
  return [...varintBytes(number * 8 + 2), ...varintBytes(bytes.length), ...bytes];
}

export function protobufFloat(number: number, value: number): number[] {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return [...varintBytes(number * 8 + 5), ...new Uint8Array(view.buffer)];
}

const utf8 = (text: string) => [...new TextEncoder().encode(text)];

export function syntheticVehicleEntity(index: number, vehicle: SyntheticVehicle): number[] {
  const trip =
    vehicle.tripId === undefined
      ? []
      : protobufBytes(
          1,
          protobufBytes(
            1,
            typeof vehicle.tripId === 'string' ? utf8(vehicle.tripId) : vehicle.tripId,
          ),
        );
  const position =
    vehicle.lat === undefined || vehicle.lon === undefined
      ? []
      : protobufBytes(2, [
          ...protobufFloat(1, vehicle.lat),
          ...protobufFloat(2, vehicle.lon),
          ...(vehicle.bearing === undefined ? [] : protobufFloat(3, vehicle.bearing)),
        ]);
  const timestamp =
    vehicle.timestampSeconds === undefined ? [] : protobufVarint(5, vehicle.timestampSeconds);
  const descriptor =
    vehicle.onPreviousTrip === undefined
      ? []
      : protobufBytes(8, [
          ...protobufBytes(1, utf8(`vehicle-${index}`)),
          ...protobufBytes(1007, protobufVarint(4, vehicle.onPreviousTrip ? 1 : 0)),
        ]);
  return protobufBytes(2, [
    ...protobufBytes(1, utf8(`entity-${index}`)),
    ...(vehicle.deleted ? protobufVarint(2, 1) : []),
    ...protobufBytes(4, [...trip, ...position, ...timestamp, ...descriptor]),
  ]);
}

export function syntheticVehicleFeed(
  vehicles: readonly SyntheticVehicle[],
  options: { headerTimestampSeconds?: number } = {},
): Uint8Array<ArrayBuffer> {
  const header = protobufBytes(1, [
    ...protobufBytes(1, utf8('2.0')),
    ...(options.headerTimestampSeconds === undefined
      ? []
      : protobufVarint(3, options.headerTimestampSeconds)),
  ]);
  return new Uint8Array([
    ...header,
    ...vehicles.flatMap((vehicle, index) => syntheticVehicleEntity(index, vehicle)),
  ]);
}

const RECORDINGS_DIRECTORY = new URL('./__recordings__/', import.meta.url);

export function loadRecordedFeed(fileName: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(fileName, RECORDINGS_DIRECTORY)));
}
