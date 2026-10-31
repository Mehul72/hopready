# ADR-0011: From a car park a walk from the destination, walking and public transport are listed by how close they get there, and no walk goes back the way the car came

## Status

Accepted. Supersedes decision 3 of ADR-0010 and amends its decision 5; the rest of ADR-0010 stands. Decision 2 is superseded, and decisions 1, 4 and 7 refined, by ADR-0012: walking back is limited to 300 m, and the ways on from a car park are refined.

## Date

2026-10-31

## Context

The owner planned 14 James Mileham Drive, Kellyville to 24 Anson St, Nirimba Fields at 8.23 pm on Saturday 31 October on build 5. Option 2 was drive 17, walk 5, school bus 5642, walk 2, school bus 6627, walk 7, on Monday afternoon. The owner: after driving the whole way, the best answer is drive, park, walk.

A review of staging and the planner the same evening (docs/plans/walk-the-rest-and-no-day-jumps.md, log) found:

- The same shape on Monday at 2.32 pm with build 5's settings, which send no excluded modes: the chain from Schofields arrives 3.24 pm, the walk from the same car park 3.16 pm. ADR-0010 decision 3 counted walking from a Transport Park&Ride car park as a mark, and the 20 minute walk was also over the 15 minute limit. The chain had no marks, so within the 10 minute tolerance it replaced the walk. Either mark alone was enough.
- Car parks past the destination offered walks back. Home to Windsor Rd at Samantha Riley Dr is a 5 to 6 minute drive; both Kellyville car parks offered 15 to 35 minute walks back, and both were listed.
- The drive to those Kellyville car parks is only 15 to 94 seconds longer than the drive to the door, and the demo Dee Why car park beside the office is 8 seconds longer, so drive times cannot tell them apart. Straight lines can: the share of the walk that heads back toward the start is 0.95 to 0.99 for the Kellyville car parks, 0.09 for Schofields to Anson St and 0.29 for Dee Why.
- The 12 hour limit measured the trip's ends. An option could leave on time and then wait 40 hours for its bus, and an arrive-by trip home could reach the car 20 hours early.
- Arriving by a time, the tolerance could pick a journey whose drive had already left, and the car park then gave nothing.
- A TfNSW failure read as "no workable connection" at a car park whose walk could not be taken, and failed the whole trip home even when the car was a short walk away.

Constraint: build 5 talks to staging and reads only response shapes it knows. None of these decisions add a field or a value.

## Decision

1. From a car park within the walking-the-rest gate, the walk and the best public transport option are both listed when they get there within 10 minutes of each other (arriving by a time, when they leave within 10 minutes), so the free parking that comes with public transport can be weighed against the walk. Public transport with a change is not listed when walking gets there first. Otherwise the quicker one is listed alone. The car park the traveller asked for keeps both (ADR-0010 decision 4), and the existing rule that hides an option beaten at both ends by another from the same station still applies.
2. Walking the rest is not offered from a car park past the destination: one where more than half of the straight-line walk heads back toward the start.
3. Two car parks at one station that can both walk the rest are one choice: the one surer of a space, then the one that gets there sooner on foot. A car park that can walk the rest is still never reduced with a twin that cannot.
4. The 12 hour limit is measured to the first service when leaving at a time and from the last service when arriving by one (on a trip home, the service that reaches the car). Journeys past it are dropped before one is chosen, and the unavailable sentence names that service's time.
5. Arriving by a time, when the chosen journey needs a drive that would already have left, another journey the drive can still make is chosen.
6. A car park where TfNSW failed and whose walk cannot be taken reads `provider-error`.
7. When TfNSW fails on a trip home and the car is within 1.2 km, the walk to the car is shown with a notice that names the failure.

## Alternatives considered

### Compare the drive to the car park with the drive to the door

- Pros: follows the road network.
- Cons: one more ETA per request, and the differences are seconds: 15 for a Kellyville car park past the destination, 8 for Dee Why beside it. With minute-rounded estimates, a car park beside the destination failed.
- Rejected on those numbers.

### Let public transport replace the walk only when it gets there no later

- Pros: one option per car park, simpler.
- Cons: hides a direct bus a few minutes later that keeps parking free.
- Not chosen; listing both within 10 minutes leaves that choice to the traveller.

### Keep the marks and drop the paid-parking mark

- Cons: the long-walk mark alone still let the chain win in the owner's case.
- Rejected.

## Consequences

### Positive

- The owner's trip on staging (version 1b0908dc): Saturday 10.03 pm, drive 16, then drive 14, park at Schofields and walk 20, arriving 10.45 pm. Monday 2.32 pm with build 5's settings: drive 18, then the Schofields walk arriving 3.16 pm; the school bus chain is gone.
- Home to Windsor Rd: no walk back from the Kellyville car parks.

### Negative

- One car park can show two options when a direct bus is within 10 minutes of the walk.
- Someone who would rather not walk 20 minutes does not see a two-bus option from that car park that gets there later.
- The share rule is a straight-line proxy: a river or motorway between a car park and the destination can misjudge it.

## Revisit if

- People ask for the bus from a car park they could walk from.
- A real car park is misjudged as past the destination, or not (report the coordinates).
