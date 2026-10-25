import type { PlanRequest, Preferences } from '@hopready/core';

import type { PlanChoices } from '@/features/plan/plan-choices';
import { plannerPreferences } from '@/features/plan/plan-request';
import type { AppPreferences } from '@/storage';

function samePreferences(a: Preferences, b: Preferences): boolean {
  const sameModes =
    a.excludedTransitModes.length === b.excludedTransitModes.length &&
    a.excludedTransitModes.every((mode) => b.excludedTransitModes.includes(mode));
  return (
    sameModes &&
    a.maxDriveMinutes === b.maxDriveMinutes &&
    a.maxWalkMinutes === b.maxWalkMinutes &&
    a.parkingBufferMinutes === b.parkingBufferMinutes &&
    a.dropOffBufferMinutes === b.dropOffBufferMinutes &&
    a.transferBufferMinutes === b.transferBufferMinutes &&
    a.carRetrievalBufferMinutes === b.carRetrievalBufferMinutes &&
    a.walkingSpeed === b.walkingSpeed
  );
}

// The same trip with the trip options as they are now. Preferred stops only shape trips out, so
// a trip home keeps the ones it was planned with.
export function withCurrentOptions(
  request: PlanRequest,
  preferences: AppPreferences,
  choices: Pick<PlanChoices, 'preferredStation' | 'preferredCarPark'>,
): PlanRequest {
  const updated: PlanRequest = { ...request, preferences: plannerPreferences(preferences) };
  if (request.trip.kind !== 'outbound') return updated;
  delete updated.preferredCarParkId;
  delete updated.preferredStop;
  if (choices.preferredCarPark) updated.preferredCarParkId = choices.preferredCarPark.id;
  if (choices.preferredStation) updated.preferredStop = choices.preferredStation;
  return updated;
}

// True when the trip options changed after these results were planned, so they no longer show
// what the person asked for.
export function optionsChangedSince(request: PlanRequest, current: PlanRequest): boolean {
  return (
    !samePreferences(request.preferences, current.preferences) ||
    request.preferredCarParkId !== current.preferredCarParkId ||
    request.preferredStop?.stopId !== current.preferredStop?.stopId ||
    request.preferredStop?.name !== current.preferredStop?.name
  );
}
