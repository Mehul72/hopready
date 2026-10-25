import { buildItinerary, type Itinerary, type Leg, secondsBetween } from '@hopready/core';

export interface ItineraryMatch {
  itinerary: Itinerary;
  // True when it is the very same trip (same services at the same scheduled times), possibly
  // with updated live times. False when it is the same kind of option on a later or earlier run.
  exact: boolean;
}

// The option a person chose, described the way docs/design/routing.md matches it after a
// refresh: same strategy, same car park, same first service.
function optionSignature(itinerary: Itinerary): string {
  const firstTransit = itinerary.legs.find((leg) => leg.kind === 'transit');
  return [
    itinerary.strategy,
    itinerary.parking?.carPark.id ?? '',
    firstTransit ? `${firstTransit.mode}:${firstTransit.service.name}` : '',
  ].join('|');
}

export function matchItinerary(
  previous: Itinerary,
  candidates: readonly Itinerary[],
): ItineraryMatch | null {
  const same = candidates.find((candidate) => candidate.id === previous.id);
  if (same) return { itinerary: same, exact: true };

  const signature = optionSignature(previous);
  const closest = candidates
    .filter((candidate) => optionSignature(candidate) === signature)
    .sort(
      (a, b) =>
        Math.abs(secondsBetween(previous.departAt, a.departAt)) -
        Math.abs(secondsBetween(previous.departAt, b.departAt)),
    )[0];
  return closest ? { itinerary: closest, exact: false } : null;
}

// The services legs ride, each as a run: the same service leaving at the same timetabled time.
function runsOf(legs: readonly Leg[]): string {
  return legs
    .flatMap((leg) =>
      leg.kind === 'transit' ? [`${leg.mode}:${leg.service.name}:${leg.scheduledStart}`] : [],
    )
    .join('|');
}

// The legs of a trip that has started, up to its next service, then `rest` from that service's
// stop. Waits are worked out again from the new times.
function joinedLegs(trip: Itinerary, fromLegIndex: number, rest: readonly Leg[]): Leg[] {
  const travelled = trip.legs.slice(0, fromLegIndex).filter((leg) => leg.kind !== 'wait');
  return [...travelled, ...rest];
}

// For a trip that has started, checked by planning the rest of it from the next stop
// (restOfTripRequest). The trip still runs when an option rides every service still to come, on
// the same runs; joined to the part already travelled, that option is the trip with the latest
// times, and keeps its id because it is the same trip. Null after a cancellation or a missed
// connection.
export function matchRestOfTrip(
  trip: Itinerary,
  fromLegIndex: number,
  candidates: readonly Itinerary[],
): ItineraryMatch | null {
  const runsToCome = runsOf(trip.legs.slice(fromLegIndex));
  const same = candidates.find((candidate) => runsOf(candidate.legs) === runsToCome);
  if (!same) return null;
  const boardingIndex = same.legs.findIndex((leg) => leg.kind === 'transit');
  const updated = buildItinerary({
    strategy: trip.strategy,
    legs: joinedLegs(trip, fromLegIndex, same.legs.slice(boardingIndex)),
    parking: trip.parking,
    fare: trip.fare,
    alerts: same.alerts,
    notes: [...new Set([...trip.notes, ...same.notes])],
  });
  return { itinerary: { ...updated, id: trip.id }, exact: true };
}

// Another option for the rest of a trip that has started, planned the same way, joined to the part
// already travelled. A drive and park or drop-off trip keeps its drive, car park and strategy, so
// the trip still shows where to drive and still offers I parked here.
export function joinAlternative(
  trip: Itinerary,
  fromLegIndex: number,
  alternative: Itinerary,
): Itinerary {
  const rodeAService = trip.legs.slice(0, fromLegIndex).some((leg) => leg.kind === 'transit');
  return buildItinerary({
    strategy: trip.strategy,
    legs: joinedLegs(trip, fromLegIndex, alternative.legs),
    parking: trip.parking,
    // The alternative's fare covers its own services only.
    fare: rodeAService ? { status: 'unknown' } : alternative.fare,
    alerts: alternative.alerts,
    notes: [...new Set([...trip.notes, ...alternative.notes])],
  });
}
