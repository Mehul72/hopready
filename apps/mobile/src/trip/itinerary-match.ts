import { type Itinerary, secondsBetween } from '@hopready/core';

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
