import type { Place, PlanRequest, Preferences, SavedParkingSpot } from '@hopready/core';

import { type AppPreferences, isSamePlace } from '@/storage';

import type { PlanChoices, TravelAccess } from './plan-choices';
import { isTimeInPast, requestTimeFor, type TimeChoice } from './time-choice';

export interface PlanInputs {
  origin: Place | null;
  destination: Place | null;
  time: TimeChoice;
  access: TravelAccess;
  choices: Pick<PlanChoices, 'preferredStation' | 'preferredCarPark'>;
  preferences: AppPreferences;
  savedParkingSpots: readonly SavedParkingSpot[];
}

export type PlanProblem =
  | 'missing-origin'
  | 'missing-destination'
  | 'same-place'
  | 'no-way-to-travel'
  | 'drop-off-needs-transit'
  | 'time-passed';

export const PLAN_PROBLEM_TEXT: Readonly<Record<PlanProblem, string>> = {
  'missing-origin': "Choose where you're starting from.",
  'missing-destination': "Choose where you're going.",
  'same-place': 'Choose a destination that is not where you start.',
  'no-way-to-travel': 'Choose at least one way to travel.',
  'drop-off-needs-transit':
    'A drop-off is at a station, so turn on Public transport for the rest of the trip.',
  'time-passed': 'That time has passed. Choose a later time, or Leave now.',
};

export function findPlanProblems(inputs: PlanInputs, now: Date): PlanProblem[] {
  const { origin, destination, access } = inputs;
  const problems: PlanProblem[] = [];
  if (!origin) problems.push('missing-origin');
  if (!destination) problems.push('missing-destination');
  if (origin && destination && isSamePlace(origin, destination)) problems.push('same-place');
  if (!access.transit && !access.drive && !access.dropOff) problems.push('no-way-to-travel');
  // The planner only plans a drop-off followed by public transport; without it nothing comes back.
  else if (access.dropOff && !access.transit) problems.push('drop-off-needs-transit');
  if (isTimeInPast(inputs.time, now)) problems.push('time-passed');
  return problems;
}

// The planner's own settings, without app-only ones such as the navigation app.
export function plannerPreferences(preferences: AppPreferences): Preferences {
  return {
    maxDriveMinutes: preferences.maxDriveMinutes,
    maxWalkMinutes: preferences.maxWalkMinutes,
    parkingBufferMinutes: preferences.parkingBufferMinutes,
    dropOffBufferMinutes: preferences.dropOffBufferMinutes,
    transferBufferMinutes: preferences.transferBufferMinutes,
    carRetrievalBufferMinutes: preferences.carRetrievalBufferMinutes,
    walkingSpeed: preferences.walkingSpeed,
    excludedTransitModes: [...preferences.excludedTransitModes],
  };
}

export type PlanRequestResult =
  { ok: true; request: PlanRequest } | { ok: false; problems: PlanProblem[] };

export function buildPlanRequest(inputs: PlanInputs, now: Date): PlanRequestResult {
  const problems = findPlanProblems(inputs, now);
  const { origin, destination, access, choices } = inputs;
  if (problems.length > 0 || !origin || !destination) {
    return { ok: false, problems };
  }
  const { preferredStation, preferredCarPark } = choices;
  return {
    ok: true,
    request: {
      origin,
      destination,
      time: requestTimeFor(inputs.time, now),
      access: { ...access },
      preferences: plannerPreferences(inputs.preferences),
      trip: { kind: 'outbound' },
      ...(preferredCarPark ? { preferredCarParkId: preferredCarPark.id } : {}),
      ...(preferredStation ? { preferredStop: preferredStation } : {}),
      // Spots the person saved are only parking candidates, so they matter only when driving.
      ...(access.drive && inputs.savedParkingSpots.length > 0
        ? { savedParkingSpots: [...inputs.savedParkingSpots] }
        : {}),
    },
  };
}
