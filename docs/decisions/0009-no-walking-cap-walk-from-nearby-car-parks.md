# ADR-0009: TfNSW gets no walking limit, a nearby car park offers drive, park, walk, and options stay within 12 hours

## Status

Accepted. Supersedes decisions 1 and 4 of ADR-0008; the rest of ADR-0008 stands.

## Date

2026-10-31

## Context

At 8.23 pm on Saturday 31 October the owner planned 14 James Mileham Drive, Kellyville to 24 Anson St, Nirimba Fields. After driving the whole way (18 minutes) the list offered "Drive and park" via Schofields leaving "2:32 pm": drive 17, walk 5, school bus 5642 for 3 minutes, walk 2, school bus 6627 for 2 minutes, walk 7. Every public transport option left on Monday afternoon and ended on school bus 6627. The owner's verdict: after driving, the sensible answer is drive, park, then walk.

What the direct calls to TfNSW showed (docs/plans/walk-the-rest-and-no-day-jumps.md, log):

| Request, Saturday evening              | Journeys                                                |
| -------------------------------------- | ------------------------------------------------------- |
| Home to Anson St, no walking limit     | 8 that night, first arriving 9.44 pm, final walk 18 min |
| Home to Anson St, `trITMOTvalue100=15` | 2, both Monday afternoon on school bus 6627             |
| Schofields Station, no walking limit   | a 16 minute walk, arriving 9.07 pm                      |
| Schofields Station, 15                 | Monday's school buses, plus the 16 minute walk          |
| Schofields Station, 8                  | Monday's school buses only                              |
| Tallawong Station, no walking limit    | 6 that night (bus 748, then an 18 minute walk)          |
| Tallawong Station, 15                  | Monday only                                             |

The engine vendor documents the parameter as a cap: trITMOTvalue is "the maximum time from the starting point to the first stop and also from the destination stop to the destination point" (Mentz EFA JSON training EN 2.9, page 74). ADR-0008 had read it as a preference because a longer walk still came back when nothing else existed; TfNSW searches days ahead, so something else almost always exists.

Three more planner rules made it worse:

- From a car park, a walk-only answer was dropped, because parking only made sense with public transport after it.
- From a car park, a journey within the preferences was preferred however much later it arrived (ADR-0008 decision 4).
- Nothing stopped an option leaving 42 hours after the time asked for, and the app printed "2:32 pm" with no day.

Constraints:

- Build 5 on the owner's phone reads unknown rejection reasons and car park outcomes, nothing else new; strategies and leg kinds cannot change.
- Transport Park&Ride parking is free for up to 18 hours with a public transport trip; otherwise a charge that depends on the car park, the day, the time and the stay applies at the exit (transportnsw.info/parkandride, read 2026-10-31).
- HopReady's walk estimate is the straight line times 1.3 at the traveller's pace; it knows nothing of rivers or motorways.

## Decision

1. TfNSW is not given the walking limit (no `itOptionsActive`, `trITMOT` or `trITMOTvalue100`), and the provider query no longer carries it. TfNSW's own reach applies; the limit marks options (`long-walk`). The demo world walks a fixed 15 minutes at normal pace to, from and between stops, as TfNSW's reach is a distance whatever the traveller's pace.
2. From each car park or station, the option that gets there first is used (for arrive-by, the one that leaves last). One with fewer marks is used instead only when it is at most 10 minutes worse.
3. A park-and-ride car park (Transport Park&Ride or a saved spot) whose walk to the destination is at most 20 minutes, or the walking limit when that is longer, also offers drive, park, walk, with HopReady's walk estimate. It competes with that car park's public transport under rule 2. At a Transport Park&Ride car park it carries the note "Park&Ride parking is free with a public transport trip, tapping on and off. Walking from here instead, you may be charged when you leave: check the rates at the car park." The charge without a trip depends on the car park, the day, the time and the stay: $5 for up to 3 hours at Schofields on a weekend, $30 a day at standard-rate car parks on weekdays, free at Gosford at weekends and under 20 minutes anywhere The car park's ranking estimate counts the walk when it is the cheaper way on.
4. A depart-at option that leaves more than 12 hours after the time asked for is rejected as `departs-long-after-requested`, and an arrive-by option that arrives more than 12 hours before the target as `arrives-long-before-target`. With the cap in place, "arrive by Sunday 10:00" came back as Friday 3.24 pm arrivals.
5. The app shows the weekday on any time that falls on another Sydney day from its reference: the time asked for on the results and trip screens, the trip's start on its steps, and today on the Plan tab card.

## Alternatives considered

### Keep sending the walking limit, as a generous fixed value (for example 30)

- Pros: an explicit reach that the demo world could share.
- Cons: still a cap; wherever the nearest served stop is further, TfNSW goes to another day again. No probe found a case where 30 beat no value.
- Not chosen. The probe matrix in docs/research/park-and-ride.md is the evidence to revisit with.

### Ask TfNSW twice, with and without the limit

- Pros: keeps journeys shaped by the limit when they exist the same evening.
- Cons: doubles TfNSW calls per plan (up to 12 for a plan with driving, over the 5 a second gate), and rule 2 would still have to discard the far-off ones.
- Rejected on cost.

### Use TfNSW's walk-only answer from the station for drive, park, walk

- Pros: TfNSW's own path and time.
- Cons: it starts at the platform, so the person would walk from the car park to the platform and back out; it only exists for car parks TfNSW was asked about, and not when TfNSW fails.
- Rejected; HopReady walks from the car park itself.

### Never offer walking from a Transport Park&Ride car park

- Pros: Park&Ride is meant for public transport customers.
- Cons: non-commuters may park at the posted rate; the owner asked for exactly this; without it the only answers were Monday buses.
- Rejected, with the fee note instead.

### Show far-off options with their day instead of rejecting them

- Pros: "first service is Monday" is information.
- Cons: a plan for Saturday evening listing Monday afternoon is noise next to a drive that evening; 12 hours still covers the first train of the morning after a late-night search.
- Rejected; the app shows the day for the ones within 12 hours.

## Consequences

### Positive

- The owner's trip now gives, all on Saturday night: drive 17 min; drive, park at Schofields, walk 15 min (arrive 9.30 pm, with the fee note); then Tallawong, Kellyville, Bella Vista and Hills Showground and four public transport options, the long final walks marked (staging c6228927).
- Kellyville to Central (Monday 8 am) and Parramatta to Carrington St with an 8 minute limit are unchanged.

### Negative

- More options carry a `long-walk` mark, since TfNSW no longer avoids long walks for people with short limits.
- Drive, park, walk relies on a straight-line walk estimate; a car park across a motorway from the destination will read shorter than it is. It is offered only within 20 minutes, and labelled as an estimate.
- One more Apple route call for each tried car park within walking distance of the destination.
- Build 5 does not show the day labels or the new rejection explanation; build 6 does.

## Revisit if

- People report drive, park, walk from car parks they cannot walk from: ask Apple or TfNSW for the walk instead of estimating it.
- TfNSW documents a walking preference that ranks rather than caps.
- Plans late on Saturday regularly come back empty because the first service is Sunday afternoon or later.
