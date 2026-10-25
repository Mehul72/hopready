import { haversineMetres } from './geo';
import type { Fare, Itinerary, Leg, Parking, ServiceAlert, Strategy, TransitLeg } from './model';
import { secondsBetween } from './time';

// Stops and car park entrances often have slightly different coordinates in different datasets.
export const MAX_LOCATION_GAP_METRES = 300;
export const MIN_VISIBLE_WAIT_SECONDS = 60;

export type ContinuityProblem = 'ends-before-start' | 'overlaps-previous' | 'location-gap';

export interface ContinuityIssue {
  legIndex: number;
  problem: ContinuityProblem;
  detail: string;
}

export function findContinuityIssues(
  legs: readonly Leg[],
  maxGapMetres = MAX_LOCATION_GAP_METRES,
): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  legs.forEach((leg, index) => {
    if (secondsBetween(leg.start, leg.end) < 0) {
      issues.push({
        legIndex: index,
        problem: 'ends-before-start',
        detail: `${leg.start} > ${leg.end}`,
      });
    }
    const previous = legs[index - 1];
    if (!previous) return;
    const overlapSeconds = -secondsBetween(previous.end, leg.start);
    if (overlapSeconds > 0) {
      issues.push({
        legIndex: index,
        problem: 'overlaps-previous',
        detail: `${overlapSeconds} s overlap`,
      });
    }
    const gapMetres = haversineMetres(previous.to.coordinate, leg.from.coordinate);
    if (gapMetres > maxGapMetres) {
      issues.push({
        legIndex: index,
        problem: 'location-gap',
        detail: `${Math.round(gapMetres)} m apart`,
      });
    }
  });
  return issues;
}

// Makes waiting visible in the timeline: a gap of a minute or more between legs becomes a wait leg
// at the place the traveller is standing. Total time is unchanged.
export function withWaitLegs(legs: readonly Leg[]): Leg[] {
  const result: Leg[] = [];
  legs.forEach((leg, index) => {
    const previous = legs[index - 1];
    if (previous && secondsBetween(previous.end, leg.start) >= MIN_VISIBLE_WAIT_SECONDS) {
      result.push({
        id: `${leg.id}-wait`,
        kind: 'wait',
        from: previous.to,
        to: previous.to,
        start: previous.end,
        end: leg.start,
        source: 'hopready',
        timing: leg.timing === 'realtime' ? 'realtime' : 'scheduled',
      });
    }
    result.push(leg);
  });
  return result;
}

export function legSeconds(leg: Leg): number {
  return Math.max(0, secondsBetween(leg.start, leg.end));
}

function sumSeconds(legs: readonly Leg[], kinds: readonly Leg['kind'][]): number {
  return legs
    .filter((leg) => kinds.includes(leg.kind))
    .reduce((total, leg) => total + legSeconds(leg), 0);
}

export function transitLegsOf(legs: readonly Leg[]): TransitLeg[] {
  return legs.filter((leg): leg is TransitLeg => leg.kind === 'transit');
}

function realtimeCoverage(legs: readonly Leg[]): Itinerary['realtime'] {
  const transit = transitLegsOf(legs);
  if (transit.length === 0) return 'none';
  const live = transit.filter((leg) => leg.timing === 'realtime').length;
  if (live === transit.length) return 'full';
  return live > 0 ? 'partial' : 'none';
}

function uniqueAlerts(alerts: readonly ServiceAlert[]): ServiceAlert[] {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    if (seen.has(alert.id)) return false;
    seen.add(alert.id);
    return true;
  });
}

// FNV-1a: a short, stable fingerprint so the app can recognise "the same trip" after a refresh.
export function stableId(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const char of parts.join('|')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function itineraryFingerprint(strategy: Strategy, legs: readonly Leg[]): string {
  const parts = legs.map((leg) => {
    if (leg.kind === 'transit') return `${leg.kind}:${leg.service.name}:${leg.scheduledStart}`;
    if (leg.kind === 'park') return `park:${leg.parking.carPark.id}`;
    // Where a drive starts is part of the option: driving to the same office from two suburbs is
    // two different trips, and a refresh re-plans from the same start, so matching still works.
    if (leg.kind === 'drive' || leg.kind === 'ride') {
      return `${leg.kind}:${leg.from.name}>${leg.to.name}`;
    }
    return `${leg.kind}:${leg.to.name}`;
  });
  return stableId([strategy, ...parts]);
}

export interface ItineraryParts {
  strategy: Strategy;
  legs: readonly Leg[];
  parking?: Parking | null;
  fare?: Fare;
  alerts?: readonly ServiceAlert[];
  notes?: readonly string[];
}

export function buildItinerary(parts: ItineraryParts): Itinerary {
  const legs = withWaitLegs(parts.legs);
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (!first || !last) throw new Error('An itinerary needs at least one leg');

  const legAlerts = transitLegsOf(legs).flatMap((leg) => leg.alerts);
  return {
    id: itineraryFingerprint(parts.strategy, legs),
    strategy: parts.strategy,
    legs,
    departAt: first.start,
    arriveAt: last.end,
    durationSeconds: Math.max(0, secondsBetween(first.start, last.end)),
    driveSeconds: sumSeconds(legs, ['drive', 'ride']),
    walkSeconds: sumSeconds(legs, ['walk']),
    waitSeconds: sumSeconds(legs, ['wait']),
    transfers: Math.max(0, transitLegsOf(legs).length - 1),
    parking: parts.parking ?? null,
    fare: parts.fare ?? { status: 'unknown' },
    accessibility: 'unknown',
    realtime: realtimeCoverage(legs),
    alerts: uniqueAlerts([...legAlerts, ...(parts.alerts ?? [])]),
    notes: [...(parts.notes ?? [])],
  };
}
