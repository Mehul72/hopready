import {
  formatDurationMinutes,
  formatSydneyTime,
  type Itinerary,
  type Leg,
  legSeconds,
  type ServiceAlert,
} from '@hopready/core';

import { LEG_VISUALS, type LegVisualKind, legVisualKind } from '@/theme';

import { selfDriveSeconds } from './itinerary-order';
import { describeOccupancy, SPACES_CAN_FILL_NOTE, type Wording } from '../shared/occupancy-wording';
import { isSampleItinerary } from '../shared/sample-data';
import { shownDurationSeconds } from '../shared/shown-duration';
import { STRATEGY_LABELS } from './plan-explanations';

const SECONDS_PER_MINUTE = 60;
// Shorter than this rounds to "0 min", which reads as a mistake rather than a short step.
const SHORTEST_ROUNDED_LEG_SECONDS = 30;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function spokenDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.round(totalSeconds / SECONDS_PER_MINUTE));
  if (minutes < 60) return plural(minutes, 'minute', 'minutes');
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourText = plural(hours, 'hour', 'hours');
  return remainder === 0 ? hourText : `${hourText} ${plural(remainder, 'minute', 'minutes')}`;
}

export function legDuration(seconds: number): Wording {
  if (seconds < SHORTEST_ROUNDED_LEG_SECONDS) {
    return { text: '<1 min', spoken: 'less than a minute' };
  }
  return { text: formatDurationMinutes(seconds), spoken: spokenDuration(seconds) };
}

export interface LegStep {
  key: string;
  kind: LegVisualKind;
  // The route name for a service, such as "M1" or "280".
  serviceName: string | null;
  duration: Wording;
  spoken: string;
}

type MovingLeg = Extract<Leg, { kind: 'drive' | 'ride' | 'walk' | 'transit' }>;

function isMoving(leg: Leg): leg is MovingLeg {
  return (
    leg.kind === 'drive' || leg.kind === 'ride' || leg.kind === 'walk' || leg.kind === 'transit'
  );
}

function spokenStep(leg: MovingLeg, duration: Wording): string {
  switch (leg.kind) {
    case 'drive':
      return `drive for ${duration.spoken} to ${leg.to.name}`;
    case 'ride':
      return `get a lift for ${duration.spoken} to ${leg.to.name}`;
    case 'walk':
      return `walk for ${duration.spoken}`;
    case 'transit':
      return `${LEG_VISUALS[leg.mode].label} ${leg.service.name} for ${duration.spoken} to ${leg.to.name}`;
  }
}

// The steps that move the traveller, in order. Waiting, parking and drop-off happen in place and
// are covered by the times and the parking line. A change between services with no walking time
// given is not a step of its own: the next service already shows it.
export function legSteps(itinerary: Itinerary): LegStep[] {
  return itinerary.legs.flatMap((leg, index) => {
    if (!isMoving(leg)) return [];
    if (leg.kind === 'walk' && legSeconds(leg) === 0) return [];
    const duration = legDuration(legSeconds(leg));
    return [
      {
        // Leg ids come from providers and may repeat, so the position is part of the key.
        key: `${index}:${leg.id}`,
        kind: legVisualKind(leg),
        serviceName: leg.kind === 'transit' ? leg.service.name : null,
        duration,
        spoken: spokenStep(leg, duration),
      },
    ];
  });
}

export interface TripFacts {
  total: Wording;
  driving: Wording | null;
  walking: Wording | null;
  changes: Wording | null;
}

function rideSeconds(itinerary: Itinerary): number {
  return itinerary.legs
    .filter((leg) => leg.kind === 'ride')
    .reduce((total, leg) => total + legSeconds(leg), 0);
}

function changesWording(transfers: number): Wording {
  if (transfers === 0) return { text: 'No changes', spoken: 'No changes' };
  const text = plural(transfers, 'change', 'changes');
  return { text, spoken: text };
}

export function tripFacts(itinerary: Itinerary): TripFacts {
  const driveSeconds = selfDriveSeconds(itinerary);
  const liftSeconds = rideSeconds(itinerary);
  const total = {
    text: formatDurationMinutes(shownDurationSeconds(itinerary)),
    spoken: spokenDuration(shownDurationSeconds(itinerary)),
  };
  let driving: Wording | null = null;
  if (driveSeconds > 0) {
    driving = {
      text: `Drive ${formatDurationMinutes(driveSeconds)}`,
      spoken: `${spokenDuration(driveSeconds)} driving`,
    };
  } else if (liftSeconds > 0) {
    driving = {
      text: `Lift ${formatDurationMinutes(liftSeconds)}`,
      spoken: `${spokenDuration(liftSeconds)} in someone else's car`,
    };
  }
  const walking =
    itinerary.walkSeconds > 0
      ? {
          text: `Walk ${formatDurationMinutes(itinerary.walkSeconds)}`,
          spoken: `${spokenDuration(itinerary.walkSeconds)} walking`,
        }
      : null;
  const hasTransit = itinerary.legs.some((leg) => leg.kind === 'transit');
  return {
    total,
    driving,
    walking,
    changes: hasTransit ? changesWording(itinerary.transfers) : null,
  };
}

export type TimingSummary = 'live' | 'partly-live' | 'sample-live' | 'timetable' | 'estimate';

export function timingSummary(itinerary: Itinerary): TimingSummary {
  const hasTransit = itinerary.legs.some((leg) => leg.kind === 'transit');
  // Without a service, every time comes from a drive estimate.
  if (!hasTransit) return 'estimate';
  if (isSampleItinerary(itinerary) && itinerary.realtime !== 'none') return 'sample-live';
  if (itinerary.realtime === 'full') return 'live';
  return itinerary.realtime === 'partial' ? 'partly-live' : 'timetable';
}

export const TIMING_SUMMARY_WORDING: Readonly<Record<TimingSummary, Wording>> = {
  live: { text: 'Live', spoken: 'Live times' },
  'partly-live': { text: 'Partly live', spoken: 'Some times live, others from the timetable' },
  'sample-live': { text: 'Sample live', spoken: 'Sample times for demo mode, not live' },
  timetable: { text: 'Timetable', spoken: 'Timetable times, not live' },
  estimate: { text: 'Estimate', spoken: 'Estimated drive time' },
};

export interface AlertSummary {
  count: number;
  severity: ServiceAlert['severity'];
  wording: Wording;
}

const SEVERITY_RANK: Readonly<Record<ServiceAlert['severity'], number>> = {
  info: 0,
  warning: 1,
  severe: 2,
};

export function alertSummary(itinerary: Itinerary): AlertSummary | null {
  const count = itinerary.alerts.length;
  if (count === 0) return null;
  const severity = itinerary.alerts.reduce<ServiceAlert['severity']>(
    (worst, alert) =>
      SEVERITY_RANK[alert.severity] > SEVERITY_RANK[worst] ? alert.severity : worst,
    'info',
  );
  const text = plural(count, 'alert', 'alerts');
  return {
    count,
    severity,
    wording: { text, spoken: plural(count, 'service alert', 'service alerts') },
  };
}

export const UNKNOWN_RULES_NOTE = 'Check signs for parking rules.';

export interface ParkingSummary {
  carParkName: string;
  occupancy: Wording;
  note: string;
  // Only when nobody has documented the rules, such as a spot the person saved. Documented rules
  // and their source are on the trip's own screen.
  rulesNote: string | null;
}

export function parkingSummary(itinerary: Itinerary, now: Date): ParkingSummary | null {
  const parking = itinerary.parking;
  if (!parking) return null;
  return {
    carParkName: parking.carPark.name,
    occupancy: describeOccupancy(parking.occupancy, now),
    note: SPACES_CAN_FILL_NOTE,
    rulesNote: parking.rules.status === 'unknown' ? UNKNOWN_RULES_NOTE : null,
  };
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

// The whole card as one sentence, so VoiceOver users hear an option the way it looks.
export function describeItinerary(itinerary: Itinerary, now: Date): string {
  const facts = tripFacts(itinerary);
  const parking = parkingSummary(itinerary, now);
  const alerts = alertSummary(itinerary);
  const steps = legSteps(itinerary).map((step) => step.spoken);
  const sentences = [
    STRATEGY_LABELS[itinerary.strategy],
    `Leave ${formatSydneyTime(itinerary.departAt)}, arrive ${formatSydneyTime(itinerary.arriveAt)}, ${facts.total.spoken} in total`,
    steps.length > 0 ? capitalise(steps.join(', then ')) : null,
    facts.changes?.spoken ?? null,
    parking ? `Parking at ${parking.carParkName}: ${parking.occupancy.spoken}` : null,
    parking ? parking.note.replace(/\.$/, '') : null,
    parking?.rulesNote ? parking.rulesNote.replace(/\.$/, '') : null,
    TIMING_SUMMARY_WORDING[timingSummary(itinerary)].spoken,
    alerts?.wording.spoken ?? null,
    ...itinerary.notes.map((note) => note.replace(/\.$/, '')),
  ];
  return `${sentences.filter((sentence): sentence is string => sentence !== null).join('. ')}.`;
}
