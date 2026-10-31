import {
  addSeconds,
  isBefore,
  legSeconds,
  placeSchema,
  ProviderError,
  secondsBetween,
  stableId,
  toIso,
  toTfnswDateTime,
  walkingPaceRatio,
  type Coordinate,
  type Leg,
  type Place,
  type ServiceAlert,
  type TransitJourney,
  type TransitLeg,
  type TransitMode,
  type TransitProvider,
  type TransitQuery,
  type WalkLeg,
} from '@hopready/core';
import { z } from 'zod';

import type { TfnswClient } from './client';
import type { DiagnosticSink, TfnswDiagnostic } from './diagnostics';
import { coordinateFromLatLon, hasStatus, nonEmptyText } from './fields';
import { htmlToText } from './html-text';
import {
  footPathInfoSchema,
  stopSequenceEntrySchema,
  tripInfoSchema,
  tripJourneySchema,
  tripResponseSchema,
  type Transportation,
  type TripJourney,
  type TripLeg,
  type TripLocation,
  type TripResponse,
} from './schemas';

const PROVIDER = 'tfnsw-trip-planner';

// RouteProduct.class in the Trip Planner spec.
const MODE_BY_PRODUCT_CLASS: ReadonlyMap<number, TransitMode> = new Map([
  [1, 'train'],
  [2, 'metro'],
  [4, 'light-rail'],
  [5, 'bus'],
  [7, 'coach'],
  [9, 'ferry'],
  [11, 'school-bus'],
]);
const WALK_PRODUCT_CLASSES: ReadonlySet<number> = new Set([99, 100]);
// TripTransportation.iconId 23 is "On Demand (product class 5)" in the spec.
const ON_DEMAND_ICON_ID = 23;

// excludedMeans=checkbox plus exclMOT_<class>=1 for each excluded mode. TfNSW has no parameter for
// On Demand, so those journeys are removed after the response arrives.
const EXCLUSION_PARAM_BY_MODE: Partial<Record<TransitMode, string>> = {
  train: 'exclMOT_1',
  metro: 'exclMOT_2',
  'light-rail': 'exclMOT_4',
  bus: 'exclMOT_5',
  coach: 'exclMOT_7',
  ferry: 'exclMOT_9',
  'school-bus': 'exclMOT_11',
};

const SEVERITY_BY_PRIORITY: ReadonlyMap<string, ServiceAlert['severity']> = new Map([
  ['veryHigh', 'severe'],
  ['high', 'severe'],
  ['normal', 'warning'],
  ['low', 'info'],
  ['veryLow', 'info'],
]);

// TfNSW states a platform or stand only inside the stop's name ("Central Station, Platform 24",
// "Liverpool Station, Stand A"). properties.platform holds internal codes such as "CE24" or "X1".
const PLATFORM_SEGMENT = /^(?:Platform|Stand|Wharf|Side|Bay) (?:[0-9]{1,3}[A-Z]?|[A-Z])$/;

const httpsUrlSchema = z.url({ protocol: /^https$/ });

export function tripRequestParams(query: TransitQuery): Record<string, string> {
  const { itdDate, itdTime } = toTfnswDateTime(query.time.at);
  const params: Record<string, string> = {
    outputFormat: 'rapidJSON',
    coordOutputFormat: 'EPSG:4326',
    depArrMacro: query.time.type === 'depart' ? 'dep' : 'arr',
    itdDate,
    itdTime,
    ...placeParams('origin', query.from),
    ...placeParams('destination', query.to),
    calcNumberOfTrips: String(query.maxJourneys),
    TfNSWTR: 'true',
    // Steers TfNSW towards journeys whose walks fit the traveller's limit. Not in the TfNSW swagger,
    // but honoured (checked 2026-10-31: walks fell to the limit when another service allowed it). It
    // is a preference inside TfNSW, not a cap: a longer walk still comes back when it is the only
    // way to a service. A slow walker's limit is given in TfNSW's own walking time, since their
    // walks are stretched afterwards.
    itOptionsActive: '1',
    trITMOT: '100',
    trITMOTvalue100: String(
      Math.max(
        1,
        Math.round(query.maxWalkMinutes / Math.max(walkingPaceRatio(query.walkingSpeed), 1)),
      ),
    ),
  };
  const exclusions = [...new Set(query.excludedModes)].flatMap(
    (mode) => EXCLUSION_PARAM_BY_MODE[mode] ?? [],
  );
  if (exclusions.length > 0) {
    params.excludedMeans = 'checkbox';
    for (const name of exclusions) params[name] = '1';
  }
  return params;
}

function placeParams(end: 'origin' | 'destination', place: Place): Record<string, string> {
  if (place.stopId) return { [`type_${end}`]: 'any', [`name_${end}`]: place.stopId };
  const { lat, lon } = place.coordinate;
  // Longitude first, as the spec requires for coordinate input.
  return {
    [`type_${end}`]: 'coord',
    [`name_${end}`]: `${lon.toFixed(6)}:${lat.toFixed(6)}:EPSG:4326`,
  };
}

export interface TripMapping {
  journeys: TransitJourney[];
  diagnostics: TfnswDiagnostic[];
}

type Step = { kind: 'walk'; leg: TripLeg } | { kind: 'transit'; leg: TripLeg; mode: TransitMode };

type JourneyOutcome =
  | { kind: 'mapped'; journey: TransitJourney }
  | { kind: 'unsupported-mode'; productClass: number }
  | { kind: 'unreadable' };

interface AlertTally {
  unreadable: number;
}

export function mapTripResponse(response: TripResponse, query: TransitQuery): TripMapping {
  const candidates = response.journeys ?? [];
  const journeys: TransitJourney[] = [];
  const unsupportedClasses = new Set<number>();
  const alertTally: AlertTally = { unreadable: 0 };
  let unsupported = 0;
  let excluded = 0;
  let unreadable = 0;

  for (const candidate of candidates) {
    const parsed = tripJourneySchema.safeParse(candidate);
    const outcome = parsed.success
      ? mapJourney(parsed.data, query, alertTally)
      : ({ kind: 'unreadable' } as const);
    if (outcome.kind === 'unreadable') {
      unreadable += 1;
    } else if (outcome.kind === 'unsupported-mode') {
      unsupported += 1;
      unsupportedClasses.add(outcome.productClass);
    } else if (usesExcludedMode(outcome.journey, query.excludedModes)) {
      excluded += 1;
    } else {
      journeys.push(outcome.journey);
    }
  }

  if (candidates.length > 0 && unreadable === candidates.length) {
    throw new ProviderError(
      PROVIDER,
      'malformed-response',
      'TfNSW sent journeys HopReady could not read',
    );
  }

  const diagnostics: TfnswDiagnostic[] = [];
  if (unsupported > 0) {
    diagnostics.push({
      kind: 'journeys-dropped',
      reason: 'unsupported-mode',
      count: unsupported,
      productClasses: [...unsupportedClasses].sort((a, b) => a - b),
    });
  }
  if (excluded > 0) {
    diagnostics.push({ kind: 'journeys-dropped', reason: 'excluded-mode', count: excluded });
  }
  if (unreadable > 0) {
    diagnostics.push({ kind: 'journeys-dropped', reason: 'unreadable', count: unreadable });
  }
  if (alertTally.unreadable > 0) {
    diagnostics.push({
      kind: 'alerts-dropped',
      reason: 'unreadable',
      count: alertTally.unreadable,
    });
  }
  if (candidates.length === 0) {
    diagnostics.push({
      kind: 'no-journeys',
      systemMessageCodes: systemMessageCodes(response.systemMessages),
    });
  }

  return { journeys: journeys.slice(0, query.maxJourneys), diagnostics };
}

function mapJourney(journey: TripJourney, query: TransitQuery, tally: AlertTally): JourneyOutcome {
  const steps: Step[] = [];
  for (const leg of journey.legs) {
    const productClass = leg.transportation.product.class;
    if (WALK_PRODUCT_CLASSES.has(productClass)) {
      steps.push({ kind: 'walk', leg });
      continue;
    }
    const mode = MODE_BY_PRODUCT_CLASS.get(productClass);
    if (!mode) return { kind: 'unsupported-mode', productClass };
    steps.push({ kind: 'transit', leg, mode: isOnDemand(leg.transportation) ? 'on-demand' : mode });
  }

  // The journey starts and ends exactly where the planner asked; in between are TfNSW's own stops.
  const lastIndex = steps.length - 1;
  const ends: { from: Place; to: Place }[] = [];
  for (const [index, step] of steps.entries()) {
    const from = index === 0 ? query.from : placeFromLocation(step.leg.origin);
    const to = index === lastIndex ? query.to : placeFromLocation(step.leg.destination);
    if (!from || !to) return { kind: 'unreadable' };
    ends.push({ from, to });
  }

  const legs: Leg[] = [];
  const walkAlerts: ServiceAlert[] = [];
  for (const [index, step] of steps.entries()) {
    const { from, to } = ends[index]!;
    if (step.kind === 'walk') {
      legs.push(walkLeg(step.leg, index, from, to));
      walkAlerts.push(...alertsFrom(step.leg.infos, tally));
      continue;
    }
    const leg = transitLeg(step.leg, step.mode, index, from, to, tally);
    if (!leg) return { kind: 'unreadable' };
    legs.push(leg);

    const next = steps[index + 1];
    const nextFrom = ends[index + 1]?.from;
    if (next?.kind === 'transit' && nextFrom) {
      const interchange = interchangeWalk(step.leg, next.leg, index, to, nextFrom, leg.end);
      if (interchange) legs.push(interchange);
    }
  }

  return {
    kind: 'mapped',
    journey: {
      legs: keepWalksInSequence(atWalkingPace(legs, query)),
      fare: { status: 'unknown' },
      alerts: uniqueById(walkAlerts),
    },
  };
}

function walkLeg(leg: TripLeg, index: number, from: Place, to: Place): WalkLeg {
  const start = toIso(leg.origin.departureTimeEstimated ?? leg.origin.departureTimePlanned);
  const end = toIso(leg.destination.arrivalTimeEstimated ?? leg.destination.arrivalTimePlanned);
  const path = pathFrom(leg.coords);
  return {
    id: `walk-${index}-${start}`,
    kind: 'walk',
    from,
    to,
    start,
    end,
    source: PROVIDER,
    timing: 'estimated',
    distanceMetres: typeof leg.distance === 'number' && leg.distance >= 0 ? leg.distance : null,
    ...(path ? { path } : {}),
  };
}

function transitLeg(
  leg: TripLeg,
  mode: TransitMode,
  index: number,
  from: Place,
  to: Place,
  tally: AlertTally,
): TransitLeg | null {
  const service = serviceFrom(leg.transportation);
  if (!service) return null;
  const scheduledStart = toIso(leg.origin.departureTimePlanned);
  const scheduledEnd = toIso(leg.destination.arrivalTimePlanned);
  const path = pathFrom(leg.coords);
  return {
    id: `transit-${index}-${scheduledStart}`,
    kind: 'transit',
    from,
    to,
    start: toIso(leg.origin.departureTimeEstimated ?? leg.origin.departureTimePlanned),
    end: toIso(leg.destination.arrivalTimeEstimated ?? leg.destination.arrivalTimePlanned),
    source: PROVIDER,
    // Estimated times are present on every leg; only the flag says real-time data produced them.
    timing: leg.isRealtimeControlled === true ? 'realtime' : 'scheduled',
    mode,
    service,
    scheduledStart,
    scheduledEnd,
    departurePlatform: splitPlatform(leg.origin).platform,
    arrivalPlatform: splitPlatform(leg.destination).platform,
    stopCount: stopCountFrom(leg.stopSequence),
    cancelled: isCancelled(leg),
    alerts: alertsFrom(leg.infos, tally),
    realtimeTripId: nonEmptyText(leg.transportation.properties?.RealtimeTripId),
    ...(path ? { path } : {}),
  };
}

// TfNSW describes a short change between services on the arriving leg (`interchange`, with the walking
// time in footPathInfo when it has one) instead of as a leg of its own.
function interchangeWalk(
  arriving: TripLeg,
  departing: TripLeg,
  index: number,
  from: Place,
  to: Place,
  arrivedAt: string,
): WalkLeg | null {
  const interchangeType = arriving.interchange?.type;
  const walksBetween = interchangeType === 99 || interchangeType === 100;
  const changesStop = nonEmptyText(arriving.destination.id) !== nonEmptyText(departing.origin.id);
  const walkSeconds =
    footPathSeconds(arriving.footPathInfo, 'AFTER') ??
    footPathSeconds(departing.footPathInfo, 'BEFORE');
  if (!walksBetween && !changesStop && walkSeconds === null) return null;

  const path = pathFrom(arriving.interchange?.coords);
  return {
    id: `interchange-${index}-${arrivedAt}`,
    kind: 'walk',
    from,
    to,
    start: arrivedAt,
    // With no walking time from TfNSW the walk gets no length rather than an invented one; the time
    // until the next departure then shows as waiting.
    end: addSeconds(arrivedAt, walkSeconds ?? 0),
    source: PROVIDER,
    timing: 'estimated',
    distanceMetres: null,
    ...(path ? { path } : {}),
  };
}

function footPathSeconds(
  entries: readonly unknown[] | null | undefined,
  position: 'AFTER' | 'BEFORE',
): number | null {
  let totalSeconds: number | null = null;
  for (const entry of entries ?? []) {
    const parsed = footPathInfoSchema.safeParse(entry);
    if (!parsed.success || parsed.data.position !== position) continue;
    const seconds = parsed.data.duration;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      totalSeconds = (totalSeconds ?? 0) + seconds;
    }
  }
  return totalSeconds;
}

// No TfNSW walking speed parameter has been verified, so TfNSW times walks at its own pace. A slow
// walker gets each walk stretched by how much longer walking takes at their speed; normal and fast
// keep TfNSW's times, which for a fast walker err early. A walk to the first service then starts
// earlier (see keepWalksInSequence), and a change the slower pace cannot make fails the planner's
// transfer check.
function atWalkingPace(legs: readonly Leg[], query: TransitQuery): Leg[] {
  const paceRatio = walkingPaceRatio(query.walkingSpeed);
  if (paceRatio <= 1) return [...legs];
  // With no service to catch, an arrive-by walk keeps its arrival and starts earlier instead.
  const keepsArrival = query.time.type === 'arrive' && legs.length === 1;
  return legs.map((leg) => {
    if (leg.kind !== 'walk') return leg;
    const walkSeconds = Math.ceil(legSeconds(leg) * paceRatio);
    return keepsArrival
      ? { ...leg, start: addSeconds(leg.end, -walkSeconds) }
      : { ...leg, end: addSeconds(leg.start, walkSeconds) };
  });
}

// Walks bend around services, never the other way: a walk starts no earlier than the leg before it
// ends, and a walk that opens the journey ends by the first departure. Its length is kept.
function keepWalksInSequence(legs: readonly Leg[]): Leg[] {
  const ordered: Leg[] = [];
  legs.forEach((leg, index) => {
    const previous = ordered[index - 1];
    const next = legs[index + 1];
    if (leg.kind !== 'walk') {
      ordered.push(leg);
      return;
    }
    const walkSeconds = Math.max(0, secondsBetween(leg.start, leg.end));
    if (previous && isBefore(leg.start, previous.end)) {
      ordered.push({ ...leg, start: previous.end, end: addSeconds(previous.end, walkSeconds) });
    } else if (!previous && next && isBefore(next.start, leg.end)) {
      ordered.push({ ...leg, start: addSeconds(next.start, -walkSeconds), end: next.start });
    } else {
      ordered.push(leg);
    }
  });
  return ordered;
}

function placeFromLocation(location: TripLocation): Place | null {
  // Real responses sometimes leave a platform's own coord out but give its station's.
  const stationCoord = location.parent?.type === 'stop' ? location.parent.coord : null;
  const coordinate = coordinateFromLatLon(location.coord) ?? coordinateFromLatLon(stationCoord);
  const { name } = splitPlatform(location);
  if (!coordinate || !name) return null;
  const isStop = location.type === 'stop' || location.type === 'platform';
  const stopId = isStop ? nonEmptyText(location.id) : null;
  const parsed = placeSchema.safeParse({
    name,
    coordinate,
    kind: isStop ? 'stop' : location.type === 'poi' ? 'poi' : 'address',
    ...(stopId ? { stopId } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function splitPlatform(location: TripLocation): { name: string | null; platform: string | null } {
  const name = nonEmptyText(location.disassembledName, location.name);
  if (!name || location.type !== 'platform') return { name, platform: null };
  const segments = name.split(',').map((segment) => segment.trim());
  let platformStart = segments.length;
  while (platformStart > 1 && PLATFORM_SEGMENT.test(segments[platformStart - 1]!)) {
    platformStart -= 1;
  }
  if (platformStart === segments.length) return { name, platform: null };
  return {
    name: segments.slice(0, platformStart).join(', '),
    platform: segments.slice(platformStart).join(', '),
  };
}

function serviceFrom(transportation: Transportation): TransitLeg['service'] | null {
  const name = nonEmptyText(
    transportation.disassembledName,
    transportation.number,
    transportation.name,
    transportation.product.name,
  );
  if (!name) return null;
  return {
    name,
    description: nonEmptyText(transportation.description),
    headsign: nonEmptyText(transportation.destination?.name),
    operator: nonEmptyText(transportation.operator?.name),
  };
}

function isOnDemand(transportation: Transportation): boolean {
  return (
    transportation.iconId === ON_DEMAND_ICON_ID ||
    transportation.product.iconId === ON_DEMAND_ICON_ID
  );
}

// The statuses transportnsw.info's own planner treats as cancelled or not stopping. The Open Data spec
// lists none of them, and its system message -9999 (TRIP_CANCELLED) names no leg, so it is not used.
function isCancelled(leg: TripLeg): boolean {
  const boarding = leg.origin.properties?.realtimeStatus;
  const alighting = leg.destination.properties?.realtimeStatus;
  return (
    hasStatus(leg.realtimeStatus, 'TRIP_CANCELLED') ||
    hasStatus(boarding, 'DEPARTURE_CANCELLED') ||
    hasStatus(boarding, 'NO_CALL_AT_STOP') ||
    hasStatus(alighting, 'NO_CALL_AT_STOP')
  );
}

// Stops after boarding, up to and including the stop where the traveller gets off. Stops the service
// will skip (NO_CALL_AT_STOP) are not counted.
function stopCountFrom(stopSequence: readonly unknown[] | null | undefined): number | null {
  if (!stopSequence || stopSequence.length < 2) return null;
  let count = 0;
  for (const entry of stopSequence.slice(1)) {
    const parsed = stopSequenceEntrySchema.safeParse(entry);
    if (!parsed.success) return null;
    if (!hasStatus(parsed.data.properties?.realtimeStatus, 'NO_CALL_AT_STOP')) count += 1;
  }
  return count;
}

function alertsFrom(
  infos: readonly unknown[] | null | undefined,
  tally: AlertTally,
): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  for (const entry of infos ?? []) {
    const parsed = tripInfoSchema.safeParse(entry);
    const alert = parsed.success ? alertFrom(parsed.data) : null;
    if (alert) alerts.push(alert);
    else tally.unreadable += 1;
  }
  return uniqueById(alerts);
}

function alertFrom(info: z.infer<typeof tripInfoSchema>): ServiceAlert | null {
  const detail = nonEmptyText(htmlToText(info.content ?? ''));
  const title = nonEmptyText(
    htmlToText(info.subtitle ?? ''),
    htmlToText(info.urlText ?? ''),
    detail,
  );
  if (!title) return null;
  const tfnswId = nonEmptyText(typeof info.id === 'number' ? String(info.id) : info.id);
  const url = httpsUrlSchema.safeParse(info.url);
  return {
    id: tfnswId ?? `tfnsw-${stableId([title, detail ?? ''])}`,
    // An alert without a known priority shows as a warning rather than being played down.
    severity: SEVERITY_BY_PRIORITY.get(info.priority ?? '') ?? 'warning',
    title,
    ...(detail && detail !== title ? { detail } : {}),
    ...(url.success ? { url: url.data } : {}),
  };
}

function pathFrom(points: readonly unknown[] | null | undefined): Coordinate[] | null {
  if (!points || points.length < 2) return null;
  const path: Coordinate[] = [];
  for (const point of points) {
    const coordinate = Array.isArray(point) ? coordinateFromLatLon(point) : null;
    if (!coordinate) return null;
    path.push(coordinate);
  }
  return path;
}

function usesExcludedMode(journey: TransitJourney, excludedModes: readonly TransitMode[]): boolean {
  return journey.legs.some((leg) => leg.kind === 'transit' && excludedModes.includes(leg.mode));
}

function uniqueById(alerts: readonly ServiceAlert[]): ServiceAlert[] {
  const byId = new Map<string, ServiceAlert>();
  for (const alert of alerts) if (!byId.has(alert.id)) byId.set(alert.id, alert);
  return [...byId.values()];
}

function systemMessageCodes(messages: TripResponse['systemMessages']): number[] {
  const list = Array.isArray(messages) ? messages : (messages?.responseMessages ?? []);
  return list.flatMap((message) => (typeof message.code === 'number' ? [message.code] : []));
}

export function createTransitProvider(
  client: TfnswClient,
  report: DiagnosticSink,
): TransitProvider {
  return {
    name: PROVIDER,
    async planJourneys(query: TransitQuery, signal: AbortSignal): Promise<TransitJourney[]> {
      const response = await client.get({
        provider: PROVIDER,
        path: '/v1/tp/trip',
        params: tripRequestParams(query),
        parse: (body) => tripResponseSchema.parse(body),
        signal,
      });
      const mapping = mapTripResponse(response, query);
      mapping.diagnostics.forEach(report);
      return mapping.journeys;
    },
  };
}
