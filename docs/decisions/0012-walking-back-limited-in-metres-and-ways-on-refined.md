# ADR-0012: Walking back past the destination is limited to 300 m, and the ways on from a car park are refined

## Status

Accepted. Supersedes decision 2 of ADR-0011 and refines its decisions 1, 4 and 7; the rest of ADR-0011 stands.

## Date

2026-10-31

## Context

A second review of the ADR-0011 commits (three reviewers, a skeptic for each finding, staging 1b0908dc and the code; docs/plans/walk-the-rest-and-no-day-jumps.md, log) confirmed:

- The share rule still offered walking back after driving past the door. From Castle Hill Towers to Windsor Rd at Samantha Riley Dr, the drive to Kellyville (south) passes 17 m from the destination, and the walk then goes 346 m of its 884 m back toward the start: a share of 0.39, under the 0.5 line. The same share split the two Penrith car parks, 80 m apart, at 0.40 and 0.64.
- With live car park entrances, walking back toward the start measured 52 to 280 m for car parks beside a destination (Edmondson Park, Penrith, Gordon, Tallawong P3; Schofields on the owner's trip, 78 m) and 340 to 908 m where the drive went past (Kellyville from Castle Hill and from the owner's house, Tallawong P1 and P2 from Schofields, Mount Druitt from St Marys, Hornsby from Epping).
- The rule also removed walking from a saved parking spot or the car park the traveller asked for, leaving "no workable connection" where ADR-0009 offered a walk.
- A car park whose walk or bus was listed read "matched by another" or "left out for space" when its other way on was hidden or cut, with the hidden option's minutes.
- A direct bus within 10 minutes of the walk was never listed when TfNSW also offered a quicker journey with a change: the change was chosen for the car park, then dropped beside the walk.
- At a tie, a change was dropped although walking did not get there first.
- The rule that hides an option beaten at both ends ignored parking: a paid walk could hide a free timetabled bus from its own car park.
- On a trip home, a journey past the 12 hour line could take the place of one inside it; and when TfNSW failed and the walk to the car could not be made, the response said the walk was shown and showed nothing.

Constraint, as before: build 5 reads only response shapes it knows. None of this adds a field or a value.

## Decision

1. Walking the rest is not offered from a Transport Park&Ride car park HopReady picks when more than 300 m of the straight-line walk heads back toward the start (about 7 minutes at TfNSW's street pace). A saved spot, or the car park the traveller asked for, is where they mean to park, so the rule does not apply to them.
2. Public transport with a change that gets there after walking from the same car park would (by the drive estimate) is chosen for that car park only when no other journey is left, so a direct one that would be listed is not passed over. The car park asked for keeps every way on.
3. Walking and public transport are compared in the minutes the cards show; a change that gets there in the same minute as walking is listed.
4. Walking from a Transport Park&Ride car park never hides an option that keeps parking free.
5. A car park reads `used` while any of its ways on is listed, with that option's minutes.
6. On a trip home, the way back to the car is chosen from journeys inside the 12 hour line when there are any; otherwise the far ones are kept, rejected and explained as before.
7. When TfNSW fails on a trip home, the walk to a car within 1.2 km stands in only if it can be taken; otherwise TfNSW's failure is the answer, as before ADR-0011.

## Alternatives considered

### A lower share

- Cons: anything under 0.39 also removes the demo Dee Why car park beside the office (0.29), and short walks score high shares for a few metres back (Penrith multi-level: 178 m, 0.64).
- Rejected.

### The routed drive passing near the destination

- Pros: follows the roads; it is how the reviewer found the Castle Hill case.
- Cons: known only after the Apple route, so the shortlist and the choice of car parks could not use it, and its distance threshold would need its own tuning.
- Not chosen; the straight-line distance separates every measured case. Revisit if a river or motorway misleads it.

## Consequences

### Positive

- No walk back past the door in any measured case, and car park twins no longer split on the rule.
- The Car parks considered sheet matches the cards.

### Negative

- 300 m is a judgement: a car park 290 m past the destination is still offered.
- A traveller who asks for a car park sees every way on from it, including a two-bus chain the walk beats.

## Revisit if

- A car park beside a destination is refused, or one past it offered (report the coordinates).
- Apple routes become cheap enough to test the drive path for every car park.
