import {
  formatDurationMinutes,
  type PlanResponse,
  type Preferences,
  type RejectionReason,
} from '@hopready/core';

export { STRATEGY_LABELS } from '../shared/option-labels';

export type CheckedCarPark = PlanResponse['checkedCarParks'][number];
type CarParkOutcome = CheckedCarPark['outcome'];

export function carParkOutcomeText(outcome: CarParkOutcome, maxDriveMinutes: number): string {
  switch (outcome) {
    case 'used':
      return 'Exact times in the options';
    case 'matched-by-another':
      return 'Another car park at this station gets you there as early, with no more driving';
    case 'left-out-for-space':
      return 'Works, but more options were found than fit on the list';
    case 'too-far-to-drive':
      return `Further than your ${maxDriveMinutes} min driving limit`;
    case 'not-towards-destination':
      return 'Not on the way to your destination';
    case 'not-tried':
      return 'Not among the five tried';
    case 'no-workable-connection':
      return 'No public transport connection worked from here';
    case 'provider-error':
      return "Couldn't be checked just now";
    case 'not-understood':
      return 'Checked. Update HopReady to see what happened here';
  }
}

// Tried car parks first, then the ones that could have been, each group by its estimate.
const OUTCOME_ORDER: readonly CarParkOutcome[] = [
  'used',
  'matched-by-another',
  'left-out-for-space',
  'not-tried',
  'no-workable-connection',
  'provider-error',
  'too-far-to-drive',
  'not-towards-destination',
  'not-understood',
];

export function orderCheckedCarParks(carParks: readonly CheckedCarPark[]): CheckedCarPark[] {
  return [...carParks].sort(
    (a, b) =>
      OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome) ||
      (a.estimatedMinutes ?? Number.POSITIVE_INFINITY) -
        (b.estimatedMinutes ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  );
}

export interface CheckedCarParkDescription {
  title: string;
  // The station and the rough door-to-door estimate, when the planner gave them.
  detail: string | null;
  outcome: string;
  spoken: string;
}

export function describeCheckedCarPark(
  carPark: CheckedCarPark,
  maxDriveMinutes: number,
): CheckedCarParkDescription {
  const estimate =
    carPark.estimatedMinutes === undefined
      ? null
      : `about ${formatDurationMinutes(carPark.estimatedMinutes * 60)} door to door`;
  const station = carPark.stationName ?? null;
  const outcome = carParkOutcomeText(carPark.outcome, maxDriveMinutes);
  return {
    title: carPark.name,
    detail: [station, estimate].filter(Boolean).join(' · ') || null,
    outcome,
    spoken: `${[carPark.name, station, estimate].filter(Boolean).join(', ')}: ${outcome}`,
  };
}

// What a person can change to get options back.
export type Remedy = 'trip-options' | 'time';

export interface RejectionExplanation {
  reason: RejectionReason;
  text: string;
  remedy: Remedy | null;
}

function explain(
  reason: RejectionReason,
  preferences: Preferences,
): Omit<RejectionExplanation, 'reason'> | null {
  switch (reason) {
    case 'transfer-too-short':
      return {
        text: 'Some connections could not be made in time at your walking speed.',
        remedy: 'trip-options',
      };
    case 'walk-too-long':
      return {
        text: `Some walks were longer than your ${preferences.maxWalkMinutes} min walking limit.`,
        remedy: 'trip-options',
      };
    case 'drive-too-long':
      return {
        text: `Some drives were longer than your ${preferences.maxDriveMinutes} min driving limit.`,
        remedy: 'trip-options',
      };
    case 'cancelled-service':
      return { text: 'Some services were cancelled.', remedy: 'time' };
    case 'departs-in-past':
      return { text: 'Some options would have needed you to leave already.', remedy: 'time' };
    case 'departs-before-requested':
      return {
        text: 'Some options would have needed you to leave before your chosen time.',
        remedy: 'time',
      };
    case 'arrives-after-target':
      return { text: 'Some options would have arrived after your arrive-by time.', remedy: 'time' };
    case 'discontinuous':
      return {
        text: "Some options had steps that didn't join up, so they were left out.",
        remedy: null,
      };
    // A duplicate is an option already in the list; it explains nothing about what is missing.
    case 'duplicate':
      return null;
  }
}

export function explainRejections(
  rejected: PlanResponse['rejected'],
  preferences: Preferences,
): RejectionExplanation[] {
  return rejected.flatMap(({ reason }) => {
    const explanation = explain(reason, preferences);
    return explanation ? [{ reason, ...explanation }] : [];
  });
}

export const REMEDY_SUGGESTIONS: Readonly<Record<Remedy, string>> = {
  'trip-options': 'Changing your trip options may bring some back.',
  time: 'A different time may work better.',
};
