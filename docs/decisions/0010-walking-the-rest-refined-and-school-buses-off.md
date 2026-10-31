# ADR-0010: Walking the rest is gated by distance, timed like TfNSW and loses to free public transport; school buses are off by default

## Status

Accepted. Supersedes decision 3 of ADR-0009; the rest of ADR-0009 stands.

## Date

2026-10-31

## Context

ADR-0009 added drive, park, walk for a car park within 20 minutes' walk of the destination. A design critique and a code audit the same evening, checked against TfNSW and the running planner, found five problems with it as built (docs/plans/walk-the-rest-and-no-day-jumps.md, log):

- The walk was timed at 1.3 m/s over 1.3 times the straight line. TfNSW times the owner's walk, Schofields car park to 24 Anson St (842 m apart), at 20 minutes over 1,318 m in both directions; HopReady said 15. An arrive-by trip would get there about 5 minutes late.
- The gate was "20 minutes, or the walking limit if longer", in the traveller's own minutes: a 60 minute limit let in a 56 minute walk, and a slow walker lost the option while longer walks in other options stayed listed.
- Walking from a Transport Park&Ride car park gives up free parking (the charge without a trip depends on the car park, the day, the time and the stay), yet it beat a free bus from the same car park by any margin.
- A trip being followed is checked again with its car park named. When the check found the bus quicker than the walk, or the other way round, the one option per car park flipped and the app (build 5 included) said the trip was no longer offered.
- Two car parks at one station were reduced to one by space count before the walk was known, so a nearly full car park beside the destination could lose to its twin 500 m further away.

Separately, the research found that Transport for NSW's own trip planner leaves school buses out unless the person asks for them (its "Plan a trip" link carries `excludedModes=11`; TfNSW's school travel FAQ tells students to tick School bus), and that Google Maps and Apple's transit times did not use them where they were fastest. School services run on school days at school times and are open to all fare-paying passengers. The owner's bad option was two school buses.

Constraint: build 5 on the owner's phone reads unknown rejection reasons and car park outcomes, nothing else new, and sends `excludedTransitModes` as saved on the phone (an empty list).

## Decision

1. Walking the rest is offered from a car park within 1.2 km in a straight line of the destination (about 20 minutes at normal pace by HopReady's measure, 27 by TfNSW's), whatever the walking limit or pace. The walk is timed as TfNSW times street walks, 1.5 times the straight line at 1.1 m/s at normal pace, scaled for slow and fast walkers, and marked `long-walk` against the person's own limit.
2. It is not offered when the start is no farther from the destination than the car park is.
3. When choosing between a car park's ways on, walking from a Transport Park&Ride car park counts as one mark, and a long drive counts for nothing (both ways on share the drive). So a free public transport option at most 10 minutes later is used instead of a paid walk.
4. The car park the traveller asked for (which every check of a followed trip names) keeps both ways on when both work, best first.
5. A car park that can walk the rest is tried on its own, not reduced with its twin at the station.
6. Drop-off skips stations within 1.2 km of the destination: whoever drives could go to the door.
7. When everything public transport or the trip home found is more than 12 hours from the time asked for, an unavailable entry says when the nearest one is ("The first public transport found leaves Mon 2 Nov 7:07 am, more than 12 hours after the time asked for"), which apps that drop the new rejection reasons can still show.
8. When TfNSW has no journey back to a car within 1.2 km, the trip home walks there, timed as in decision 1.
9. School buses are left out by default (`excludedTransitModes: ['school-bus']`), with a one-time carry-over of saved trip options (preferences version 2) so phones that saved an empty list gain the exclusion; Trip options says they run on school days and anyone with a ticket can ride, and lets people allow them.
10. TfNSW gets no walking speed either: `changeSpeed` is honoured and, like the walking cap, sends TfNSW days ahead (home to Anson St, 9.30 pm Saturday, `changeSpeed=slow`: Monday 1.44 pm only).

## Alternatives considered

### Time the walk with a TfNSW walking query from the car park

- Pros: TfNSW's own path and time.
- Cons: one more TfNSW call per car park within reach, and a second answer to reconcile when it fails.
- Not chosen; the street walk matches TfNSW on the measured case. Revisit if estimates are reported wrong.

### A per car park price on the walking option

- Pros: the person would see "$5 for up to 3 hours today".
- Cons: the price depends on how long they stay, which HopReady does not know, and on a table of rates per car park, day and hour to keep current.
- Not chosen; the note says the parking may be charged and to check the rates at the car park.

### Keep school buses in and only mark them

- Pros: nothing hidden.
- Cons: TfNSW, Google and Apple all leave them out by default; with the walking cap gone they appear only near school bell times, where a regular service usually does as well (Monday 2.30 pm from the owner's house: the same arrival without them).
- Rejected; one tap in Trip options brings them back.

## Consequences

### Positive

- The owner's trip on Saturday evening: drive 17 min; drive, park at Schofields, walk 20 min (arrive 10.02 pm, marked, with the fee note); then public transport options that night (staging 58903c32).
- A followed walking trip stays the same trip when the bus becomes quicker.

### Negative

- Drive, park, walk times are more cautious than HopReady's other walks (car park to platform), on purpose.
- Two options can appear for the car park the traveller asked for.
- People who rely on school buses must allow them once in Trip options after updating.

## Revisit if

- People report walks from car parks they could not make in the time shown.
- TfNSW's walking pace or the Park&Ride rates change.
- Someone asks for school buses on by default for school trips: a "travelling to school" switch would suit them better than a default.
