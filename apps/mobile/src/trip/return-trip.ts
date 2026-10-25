import type { PlanRequest, TripKind } from '@hopready/core';

import type { ParkedCarState } from '@/storage';

type Access = PlanRequest['access'];

const PUBLIC_TRANSPORT_ONLY: Access = { transit: true, drive: false, dropOff: false };
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
