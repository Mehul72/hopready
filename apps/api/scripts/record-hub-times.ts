// Records how long public transport takes from every Park&Ride station to the hubs most trips end
// near, so the planner can rank car parks by a realistic estimate before it spends exact calls.
// From the repository root:
//   TFNSW_API_KEY=... npx tsx apps/api/scripts/record-hub-times.ts
// Writes packages/core/src/data/park-and-ride-hub-times.ts. The key only ever travels in the
// Authorization header and is redacted from anything printed.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  fromSydneyWallClock,
  PARK_AND_RIDE_CATALOGUE,
  sydneyWallClock,
  systemClock,
  type Place,
} from '@hopready/core';

import { TFNSW_API_ORIGIN } from '../src/providers/tfnsw/client';
import { RateGate } from '../src/providers/tfnsw/rate-gate';
import { nextWeekdayAt } from '../src/providers/tfnsw/sample-trips';
import { stopFinderResponseSchema, tripResponseSchema } from '../src/providers/tfnsw/schemas';
import { mapStopFinderResponse, stopFinderParams } from '../src/providers/tfnsw/stop-search';
import { mapTripResponse, tripRequestParams } from '../src/providers/tfnsw/transit';

const OUTPUT_FILE = fileURLToPath(
  new URL('../../../packages/core/src/data/park-and-ride-hub-times.ts', import.meta.url),
);
const REQUEST_TIMEOUT_MS = 20_000;
const MS_PER_DAY = 86_400_000;
// Enough departures to see the service interval without asking for a whole hour.
const JOURNEYS_PER_QUERY = 3;
// Well under the 5 per second the key allows, so a recording run never disturbs a running server.
const gate = new RateGate({ requestsPerSecond: 3, maxQueueMs: 30_000 });

// Where Sydney park-and-ride trips tend to end: the city centre stations by line, and the centres
// with large workplaces. Names are what stop_finder expects.
const HUB_QUERIES: readonly { id: string; query: string }[] = [
  { id: 'central', query: 'Central Station' },
  { id: 'town-hall', query: 'Town Hall Station' },
  { id: 'wynyard', query: 'Wynyard Station' },
  { id: 'martin-place', query: 'Martin Place Station' },
  { id: 'circular-quay', query: 'Circular Quay Station' },
  { id: 'north-sydney', query: 'North Sydney Station' },
  { id: 'st-leonards', query: 'St Leonards Station' },
  { id: 'chatswood', query: 'Chatswood Station' },
  { id: 'macquarie-park', query: 'Macquarie Park Station' },
  { id: 'parramatta', query: 'Parramatta Station' },
];

const PERIODS = ['weekday-peak', 'weekday-evening', 'weekend'] as const;
type Period = (typeof PERIODS)[number];

interface Hub {
  id: string;
  place: Place & { stopId: string };
}

// [minutes on board including changes, minutes between departures]; null when no journey came back.
type HubTime = [number, number] | null;

class RecordingStopped extends Error {}

const apiKey = process.env.TFNSW_API_KEY?.trim() ?? '';

function say(line: string): void {
  process.stdout.write(`${redact(line)}\n`);
}

// Nothing printed may contain the key, even inside an error from the network stack.
function redact(text: string): string {
  return apiKey ? text.split(apiKey).join('[key]') : text;
}

async function fetchJson(path: string, params: Record<string, string>): Promise<unknown> {
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
    throw new RecordingStopped(`TfNSW could not be reached (${reason})`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new RecordingStopped('TfNSW refused the key; check TFNSW_API_KEY and the plan limits');
  }
  if (!response.ok)
    throw new RecordingStopped(`TfNSW answered HTTP ${response.status} for ${path}`);
  return (await response.json()) as unknown;
}

async function findHub(id: string, query: string): Promise<Hub> {
  const body = await fetchJson('/v1/tp/stop_finder', stopFinderParams(query));
  const { suggestions } = mapStopFinderResponse(
    stopFinderResponseSchema.parse(body).locations ?? [],
    null,
  );
  for (const { place } of suggestions) {
    const { stopId } = place;
    if (stopId && place.name.startsWith(query)) return { id, place: { ...place, stopId } };
  }
  throw new RecordingStopped(`stop_finder found no stop named ${query}`);
}

// The next Saturday after the Sydney date of `now`, at the given Sydney wall-clock time.
function nextSaturdayAt(now: Date, hour: number, minute: number): string {
  const today = sydneyWallClock(now);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const daysToSaturday = (6 - tomorrow.getUTCDay() + 7) % 7;
  const day = new Date(tomorrow.getTime() + daysToSaturday * MS_PER_DAY);
  return fromSydneyWallClock({
    year: day.getUTCFullYear(),
    month: day.getUTCMonth() + 1,
    day: day.getUTCDate(),
    hour,
    minute,
  }).toISOString();
}

function stationPlaces(): (Place & { stopId: string })[] {
  const byStopId = new Map<string, Place & { stopId: string }>();
  for (const carPark of PARK_AND_RIDE_CATALOGUE) {
    const { name, stopId, coordinate } = carPark.station;
    if (!byStopId.has(stopId)) byStopId.set(stopId, { name, coordinate, kind: 'stop', stopId });
  }
  return [...byStopId.values()];
}

async function hubTime(from: Place, to: Place, at: string): Promise<HubTime> {
  const query = {
    from,
    to,
    time: { type: 'depart' as const, at },
    maxJourneys: JOURNEYS_PER_QUERY,
    maxWalkMinutes: 60,
    walkingSpeed: 'normal' as const,
    excludedModes: [],
  };
  const body = await fetchJson('/v1/tp/trip', tripRequestParams(query));
  const { journeys } = mapTripResponse(tripResponseSchema.parse(body), query);
  const timed = journeys
    .filter((journey) => journey.legs.length > 0)
    .map((journey) => {
      const first = journey.legs[0];
      const last = journey.legs[journey.legs.length - 1];
      if (!first || !last) throw new Error('A journey with legs has a first and a last leg');
      return {
        departMs: Date.parse(first.start),
        rideMs: Date.parse(last.end) - Date.parse(first.start),
      };
    })
    .sort((a, b) => a.departMs - b.departMs);
  if (timed.length === 0) return null;

  const rideMinutes = Math.round(Math.min(...timed.map((journey) => journey.rideMs)) / 60_000);
  const gaps = timed.slice(1).map((journey, index) => {
    const previous = timed[index];
    if (!previous) throw new Error('slice(1) keeps a predecessor for every entry');
    return journey.departMs - previous.departMs;
  });
  const headwayMinutes =
    gaps.length === 0
      ? 0
      : Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length / 60_000);
  return [rideMinutes, headwayMinutes];
}

function render(
  recordedAt: Date,
  serviceDates: Record<Period, string>,
  hubs: readonly Hub[],
  times: ReadonlyMap<string, Record<string, Record<Period, HubTime>>>,
): string {
  const lines: string[] = [];
  lines.push(
    '// Generated by apps/api/scripts/record-hub-times.ts; do not edit by hand. Public transport',
    '// times from every Park&Ride station to the hubs most trips end near, asked of the TfNSW trip',
    `// planner on ${recordedAt.toISOString()} for these service days (Sydney time):`,
  );
  for (const period of PERIODS) lines.push(`//   ${period}: ${serviceDates[period]}`);
  lines.push(
    '// Each entry is [minutes on board including changes, minutes between departures], or null when',
    '// no journey came back. The planner adds the walk at each end and half the headway itself.',
    '',
    "import type { Coordinate } from '../geo';",
    '',
    `export const HUB_TIMES_RECORDED_ON = '${recordedAt.toISOString().slice(0, 10)}';`,
    '',
    `export const HUB_PERIODS = ${JSON.stringify(PERIODS)} as const;`,
    'export type HubPeriod = (typeof HUB_PERIODS)[number];',
    '',
    'export interface Hub {',
    '  id: string;',
    '  name: string;',
    '  stopId: string;',
    '  coordinate: Coordinate;',
    '}',
    '',
    '// prettier-ignore',
    'export const HUBS: readonly Hub[] = [',
  );
  for (const hub of hubs) {
    const { lat, lon } = hub.place.coordinate;
    lines.push(
      `  { id: ${JSON.stringify(hub.id)}, name: ${JSON.stringify(hub.place.name)}, stopId: ${JSON.stringify(hub.place.stopId)}, coordinate: { lat: ${lat}, lon: ${lon} } },`,
    );
  }
  lines.push(
    '];',
    '',
    'export type HubTime = readonly [rideMinutes: number, headwayMinutes: number] | null;',
    '',
    '// Station stop id, then hub id, then period.',
    '// prettier-ignore',
    'export const HUB_TIMES_BY_STATION: Readonly<Record<string, Readonly<Record<string, Readonly<Record<HubPeriod, HubTime>>>>>> = {',
  );
  for (const [stopId, byHub] of times) {
    const hubEntries = Object.entries(byHub).map(([hubId, byPeriod]) => {
      const periodEntries = PERIODS.map((period) => {
        const value = byPeriod[period];
        return `${JSON.stringify(period)}: ${value === null ? 'null' : `[${value[0]}, ${value[1]}]`}`;
      });
      return `${JSON.stringify(hubId)}: { ${periodEntries.join(', ')} }`;
    });
    lines.push(`  ${JSON.stringify(stopId)}: { ${hubEntries.join(', ')} },`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!apiKey) {
    process.stderr.write('Set TFNSW_API_KEY to an Open Data Hub API token first.\n');
    process.exitCode = 1;
    return;
  }
  const now = systemClock.now();
  const departures: Record<Period, string> = {
    'weekday-peak': nextWeekdayAt(now, 8, 0),
    'weekday-evening': nextWeekdayAt(now, 21, 0),
    weekend: nextSaturdayAt(now, 10, 0),
  };
  const serviceDates = Object.fromEntries(
    PERIODS.map((period) => {
      const wall = sydneyWallClock(new Date(departures[period]));
      return [
        period,
        `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')} ${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`,
      ];
    }),
  ) as Record<Period, string>;

  const hubs: Hub[] = [];
  for (const { id, query } of HUB_QUERIES) {
    const hub = await findHub(id, query);
    hubs.push(hub);
    say(`${id}: ${hub.place.name} (${hub.place.stopId})`);
  }

  const stations = stationPlaces();
  const total = stations.length * hubs.length * PERIODS.length;
  say(
    `${stations.length} stations x ${hubs.length} hubs x ${PERIODS.length} periods = ${total} trips`,
  );

  const times = new Map<string, Record<string, Record<Period, HubTime>>>();
  let done = 0;
  let missing = 0;
  for (const station of stations) {
    const byHub: Record<string, Record<Period, HubTime>> = {};
    for (const hub of hubs) {
      const byPeriod = {} as Record<Period, HubTime>;
      for (const period of PERIODS) {
        if (station.stopId === hub.place.stopId) {
          byPeriod[period] = [0, 0];
        } else {
          byPeriod[period] = await hubTime(station, hub.place, departures[period]);
          if (byPeriod[period] === null) missing += 1;
        }
        done += 1;
        if (done % 50 === 0) say(`  ${done}/${total}`);
      }
      byHub[hub.id] = byPeriod;
    }
    times.set(station.stopId, byHub);
    const central = byHub.central?.['weekday-peak'];
    say(
      `${station.name}: to Central at peak ${central ? `${central[0]} min on board, every ${central[1]} min` : 'no journey'}`,
    );
  }

  writeFileSync(OUTPUT_FILE, render(now, serviceDates, hubs, times));
  say(`Written to ${OUTPUT_FILE} (${missing} of ${total} station-hub-period pairs had no journey)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${redact(message)}\n`);
  if (!(error instanceof RecordingStopped) && error instanceof Error && error.stack) {
    process.stderr.write(`${redact(error.stack)}\n`);
  }
  process.exitCode = 1;
});
