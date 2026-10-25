// Records real TfNSW responses for the adapter's parser tests. From the repository root:
//   TFNSW_API_KEY=... npx tsx apps/api/scripts/record-tfnsw-samples.ts
// Responses are written to apps/api/src/providers/tfnsw/__recordings__/, then parsed with the
// adapter's own code and summarised. The key only ever travels in the Authorization header.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { systemClock, toTfnswDateTime, type Place } from '@hopready/core';

import { occupancyFromFeed } from '../src/providers/tfnsw/car-parks';
import { TFNSW_API_ORIGIN } from '../src/providers/tfnsw/client';
import { RateGate } from '../src/providers/tfnsw/rate-gate';
import {
  kellyvilleStation,
  nextWeekdayAt,
  tallawongP1Entrance,
} from '../src/providers/tfnsw/sample-trips';
import {
  carParkFacilitySchema,
  stopFinderResponseSchema,
  tripResponseSchema,
} from '../src/providers/tfnsw/schemas';
import { mapStopFinderResponse, stopFinderParams } from '../src/providers/tfnsw/stop-search';
import { mapTripResponse, tripRequestParams } from '../src/providers/tfnsw/transit';

const RECORDINGS_DIRECTORY = fileURLToPath(
  new URL('../src/providers/tfnsw/__recordings__/', import.meta.url),
);
const REQUEST_TIMEOUT_MS = 20_000;
// Well under the 5 per second the key allows, so a recording run never disturbs a running server.
const gate = new RateGate({ requestsPerSecond: 3, maxQueueMs: 10_000 });

interface Recording {
  file: string;
  path: string;
  params: Record<string, string>;
  status: number;
  errorDetail: string | null;
}

class RecordingStopped extends Error {}

const apiKey = process.env.TFNSW_API_KEY?.trim() ?? '';
const recordings: Recording[] = [];

function say(line: string): void {
  process.stdout.write(`${redact(line)}\n`);
}

// Nothing printed may contain the key, even inside an error from the network stack.
function redact(text: string): string {
  return apiKey ? text.split(apiKey).join('[key]') : text;
}

async function record(
  file: string,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(path, TFNSW_API_ORIGIN);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  await gate.acquire(signal);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `apikey ${apiKey}`, Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new RecordingStopped(`${file}: TfNSW could not be reached (${reason})`);
  }

  const text = await response.text();
  const errorDetail = response.headers.get('x-error-detail');
  recordings.push({ file, path, params, status: response.status, errorDetail });
  writeFileSync(join(RECORDINGS_DIRECTORY, file), prettyJsonOrText(text));
  say(
    `${file}: HTTP ${response.status}, ${text.length} bytes${errorDetail ? `, ${errorDetail}` : ''}`,
  );

  if (response.status === 401 || response.status === 403) {
    throw new RecordingStopped('TfNSW refused the key; check TFNSW_API_KEY and the plan limits');
  }
  if (!response.ok) throw new RecordingStopped(`${file}: TfNSW answered HTTP ${response.status}`);
  return JSON.parse(text) as unknown;
}

function prettyJsonOrText(text: string): string {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    // Kept as sent: a body that is not JSON is itself worth seeing.
    return text;
  }
}

async function findStop(
  file: string,
  query: string,
  expectedName: string,
): Promise<Place & { stopId: string }> {
  const body = await record(file, '/v1/tp/stop_finder', stopFinderParams(query));
  const { suggestions } = mapStopFinderResponse(
    stopFinderResponseSchema.parse(body).locations ?? [],
    null,
  );
  for (const { place } of suggestions) {
    const { stopId } = place;
    if (stopId && place.name.startsWith(expectedName)) return { ...place, stopId };
  }
  throw new RecordingStopped(`stop_finder found no stop named ${expectedName}`);
}

function summariseTrip(file: string, body: unknown, from: Place, to: Place, at: string): void {
  const mapping = mapTripResponse(tripResponseSchema.parse(body), {
    from,
    to,
    time: { type: 'depart', at },
    maxJourneys: 20,
    maxWalkMinutes: 60,
    walkingSpeed: 'normal',
    excludedModes: [],
  });
  say(`  ${file}: ${mapping.journeys.length} journeys mapped`);
  for (const diagnostic of mapping.diagnostics) say(`  ${file}: ${JSON.stringify(diagnostic)}`);
}

// The full list's shape is not documented. This says whether it carries what listFacilities needs,
// which decides whether it can replace one request per car park.
function summariseFullList(body: unknown): void {
  let entries: unknown[] = [];
  if (Array.isArray(body)) entries = body;
  else if (body && typeof body === 'object') entries = Object.values(body);

  const feeds = entries.flatMap((entry) => {
    const parsed = carParkFacilitySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const withLocation = feeds.filter(
    (feed) => feed.location?.latitude && feed.location.longitude,
  ).length;
  const withTsn = feeds.filter((feed) => feed.tsn).length;
  const shape = Array.isArray(body) ? 'an array' : `a ${typeof body}`;
  say(
    `  carpark-full-list.json: ${shape} of ${entries.length} entries, ${feeds.length} readable as ` +
      `facilities, ${withLocation} with a location, ${withTsn} with a tsn`,
  );
}

async function main(): Promise<void> {
  if (!apiKey) {
    process.stderr.write('Set TFNSW_API_KEY to an Open Data Hub API token first.\n');
    process.exitCode = 1;
    return;
  }
  mkdirSync(RECORDINGS_DIRECTORY, { recursive: true });
  const now = systemClock.now();
  const departAt = nextWeekdayAt(now, 8, 0);
  const arriveBy = nextWeekdayAt(now, 9, 0);

  const chatswood = await findStop('stop-finder-chatswood.json', 'Chatswood', 'Chatswood Station');
  const barangaroo = await findStop(
    'stop-finder-barangaroo-station.json',
    'Barangaroo Station',
    'Barangaroo Station',
  );

  const tallawong = tallawongP1Entrance();
  const outbound = await record(
    'trip-tallawong-p1-to-chatswood.json',
    '/v1/tp/trip',
    tripRequestParams({
      from: tallawong,
      to: chatswood,
      time: { type: 'depart', at: departAt },
      maxJourneys: 6,
      maxWalkMinutes: 15,
      walkingSpeed: 'normal',
      excludedModes: [],
    }),
  );
  const kellyville = kellyvilleStation();
  const arriveByTrip = await record(
    'trip-kellyville-to-barangaroo.json',
    '/v1/tp/trip',
    tripRequestParams({
      from: kellyville,
      to: barangaroo,
      time: { type: 'arrive', at: arriveBy },
      maxJourneys: 6,
      maxWalkMinutes: 15,
      walkingSpeed: 'normal',
      excludedModes: [],
    }),
  );

  await record('carpark-list.json', '/v1/carpark', {});
  const fullList = await record('carpark-full-list.json', '/v1/carpark/full-list', {});
  const tallawongP1 = await record('carpark-facility-26.json', '/v1/carpark', { facility: '26' });

  await record('departure-mon-chatswood.json', '/v1/tp/departure_mon', {
    outputFormat: 'rapidJSON',
    coordOutputFormat: 'EPSG:4326',
    mode: 'direct',
    type_dm: 'stop',
    name_dm: chatswood.stopId,
    departureMonitorMacro: 'true',
    TfNSWDM: 'true',
    ...toTfnswDateTime(now),
  });

  writeFileSync(
    join(RECORDINGS_DIRECTORY, 'manifest.json'),
    `${JSON.stringify({ recordedAt: now.toISOString(), recordings }, null, 2)}\n`,
  );

  say('Parsed with the adapter:');
  summariseTrip('trip-tallawong-p1-to-chatswood.json', outbound, tallawong, chatswood, departAt);
  summariseTrip(
    'trip-kellyville-to-barangaroo.json',
    arriveByTrip,
    kellyville,
    barangaroo,
    arriveBy,
  );
  summariseFullList(fullList);
  const occupancy = occupancyFromFeed(carParkFacilitySchema.parse(tallawongP1));
  say(
    `  carpark-facility-26.json: ${occupancy ? JSON.stringify(occupancy) : 'no usable occupancy'}`,
  );
  say(`Written to ${RECORDINGS_DIRECTORY}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${redact(message)}\n`);
  if (!(error instanceof RecordingStopped) && error instanceof Error && error.stack) {
    process.stderr.write(`${redact(error.stack)}\n`);
  }
  process.exitCode = 1;
});
