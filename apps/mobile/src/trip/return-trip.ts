import type { PlanRequest, TripKind } from '@hopready/core';

import { type ParkedCarState, useParkedCar } from '@/storage';

type Access = PlanRequest['access'];

export const PUBLIC_TRANSPORT_ONLY: Access = { transit: true, drive: false, dropOff: false };
const VIA_PARKED_CAR: Access = { transit: true, drive: true, dropOff: false };

// Going back after the outbound trip: through the car only when the person confirmed parking it.
// After a drop-off, or with no car recorded, the way back is public transport only.
export function returnTripFor(parkedCar: ParkedCarState): { trip: TripKind; access: Access } {
  switch (parkedCar.status) {
    case 'parked':
      return {
        trip: { kind: 'return-via-car', parkedCar: parkedCar.parkedCar },
        access: VIA_PARKED_CAR,
      };
    case 'dropped-off':
    case 'none':
      return { trip: { kind: 'return-without-car' }, access: PUBLIC_TRANSPORT_ONLY };
  }
}

// A trip home planned again goes through the car as it is now, the way Take me home plans it, so a
// corrected spot is used straight away. Null when the trip home no longer fits: the car was
// removed, the person said they were dropped off, or a car was saved after a trip home without one.
// Planning it again would send them back to a car they do not have, or leave theirs behind, so the
// screens ask them to tap Take me home again instead.
export function withCurrentCar(
  request: PlanRequest,
  parkedCar: ParkedCarState,
): PlanRequest | null {
  if (request.trip.kind === 'outbound') return request;
  const current = returnTripFor(parkedCar);
  return current.trip.kind === request.trip.kind ? { ...request, ...current } : null;
}

// True for a trip home that no longer fits the car (see withCurrentCar).
export function useTripHomeOutOfDate(request: PlanRequest | null): boolean {
  const parkedCar = useParkedCar();
  return request !== null && withCurrentCar(request, parkedCar) === null;
}
