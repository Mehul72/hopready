import type { ParkedCar, PlanRequest, TripKind } from '@hopready/core';

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

// A correction keeps when the car was parked and changes where it is.
function carMoved(planned: ParkedCar, current: ParkedCar): boolean {
  const from = planned.location.coordinate;
  const to = current.location.coordinate;
  return planned.carParkId !== current.carParkId || from.lat !== to.lat || from.lon !== to.lon;
}

// A trip home is planned again only while it still fits the car. Null once the car changed after
// it was planned: it was moved or removed, the person said they were dropped off, or a car was
// saved after a trip home without one. Planning it again would send them to where the car was, or
// leave theirs behind, and checking it would compare it with a trip to somewhere else, so the
// screens ask them to tap Take me home again instead.
export function withCurrentCar(
  request: PlanRequest,
  parkedCar: ParkedCarState,
): PlanRequest | null {
  const planned = request.trip;
  if (planned.kind === 'outbound') return request;
  const current = returnTripFor(parkedCar);
  if (current.trip.kind !== planned.kind) return null;
  if (
    current.trip.kind === 'return-via-car' &&
    planned.kind === 'return-via-car' &&
    carMoved(planned.parkedCar, current.trip.parkedCar)
  ) {
    return null;
  }
  return { ...request, ...current };
}

// True for a trip home that no longer fits the car (see withCurrentCar).
export function useTripHomeOutOfDate(request: PlanRequest | null): boolean {
  const parkedCar = useParkedCar();
  return request !== null && withCurrentCar(request, parkedCar) === null;
}
