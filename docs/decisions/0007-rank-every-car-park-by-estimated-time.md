# ADR-0007: Rank every car park by estimated door-to-door time, and check the best few exactly

## Status

Accepted

## Date

2026-10-31

## Context

The first planner chose car parks with geometry: a car park had to lie "on the way" (closer to the destination than the start, unless within 5 km of it, and on a detour of at most 1.6 times the direct distance), then the best four by a straight-line score were asked for journeys. On 2026-10-31 the owner reported, from a house in Kellyville, that Kellyville's own station was marked "not on the way" and Seven Hills (T1 Western line, 1,613 spaces, 33 minutes to Central) was never listed. The reason is the shape of Sydney: the rail and metro lines run west to east, the large car parks sit at the outer stations, so for a trip into the city the useful car parks are behind or beside the traveller. A direction rule keeps exactly the car parks that fill first and drops the ones a local would use.

Constraints:

- HopReady has no router of its own. A public transport leg costs one TfNSW Trip Planner call per car park; the key allows 5 calls a second and 60,000 a day, shared by every TfNSW endpoint. A plan has 12 seconds.
- Apple's ETA endpoint answers for up to 10 destinations per call, within 25,000 calls a day for the whole team.
- The TfNSW Car Park API lists every facility with its stop id (tsn), its entrance coordinate, its capacity and its live count, all in one call to `/v1/carpark/full-list` (docs/research/park-and-ride.md).
- Research on park-and-ride choice (docs/research/park-and-ride.md, part 2) finds people do not pick the lot that minimises total time: they weigh time in the car far above time on a train, prefer rail or metro to bus, and bypass the nearest station for a better service or a surer space. Routing engines with their own graph (OpenTripPlanner, MOTIS, Navitia) search every access stop within a generous bound and let cost decide; OpenTripPlanner removed its connectivity heuristic after it misbehaved and uses a car-access penalty instead.
- A table of public transport times from each Park&Ride station to a set of hubs, recorded from TfNSW's own planner, is a good estimate for trips ending near a hub and a rough one elsewhere; a station-level matrix built from GTFS would be exact but needs a nightly job.

## Decision

1. Every documented car park within the straight-line driving bound (90 km/h for the driving limit) gets a door-to-door estimate: a rough drive, the parking buffer, HopReady's own walk from the car park's entrance to the platform, and the public transport time from the station. The public transport time comes from `packages/core/src/data/park-and-ride-hub-times.ts`, a table of on-board minutes and headways from every Park&Ride station to Sydney's hubs for weekday peak, weekday off-peak and weekend, recorded from the TfNSW Trip Planner by `apps/api/scripts/record-hub-times.ts`; the planner adds half the headway as waiting and the walk or ride from the hub to the destination, and never uses a hub route that is slower than a straight-line ride would be.
2. The best 20 by estimate are sent to Apple's ETA endpoint in one batch (two calls). Car parks whose drive runs past the driving limit are left out and, if they looked within reach, reported as too far.
3. The best 5 by the refined estimate are asked for journeys, one car park per station: of two at one station the one surer of a space, then the one nearer the platform, speaks for both. The quickest drive is always among them, as is any car park or station the traveller asked for.
4. Journeys for a car park are asked for from its station's stop id, so they start at the platform; HopReady adds the walk from the car park as its own estimated leg.
5. Every car park within the driving limit is reported with its station and its estimate, whether it was used, not tried, or too far, so nothing goes missing from the list and the traveller can see what the untried ones would roughly take.
6. Options at different stations are all listed. Only two car parks at one station are reduced to one option, since they get the same services.
7. Direction is never a rule on its own. A car park a few minutes back from the start earns its place or loses it on the estimate.

## Alternatives considered

### Keep the geometric rules and tune them

- Pros: no extra provider calls; already explained in the app.
- Cons: every tuning (5 km any direction, two quickest drives) fixed one house and broke another; the rules cannot express "a different line is quicker for this destination".
- Rejected: the owner's two reports were both consequences of the rules, not of their thresholds.

### Ask TfNSW for journeys from every car park

- Pros: exact for all 40.
- Cons: 40 Trip Planner calls per plan is 8 seconds at the 5 per second gate and about 1,500 plans a day against the quota; most of the answers would be for car parks nobody would drive to.
- Rejected on cost and latency; the estimate decides which 5 are worth asking.

### Build a station-to-station matrix from GTFS instead of a hub table

- Pros: exact public transport times for any destination; the researcher built one over the whole TfNSW timetable in 10 seconds with a 300-line RAPTOR.
- Cons: a nightly job, a 300 MB download, a new data pipeline to run and watch.
- Not chosen yet. The hub table covers the destinations most park-and-ride trips end near (the city centre, Chatswood, Parramatta, Macquarie Park, North Sydney and the suburban centres). The exact check still happens for the car parks that matter. This is the one to revisit.

### Let TfNSW plan park-and-ride itself

- Pros: one call.
- Cons: TfNSW documents no car-access parameter; a `trITMOT=104` probe answered "no it connection" (the skeptic notes the probe omitted `prRoutingMacro`, so the engine's capability is unknown, not disproved); even if it worked, TfNSW would choose the car park and time the drive without traffic.
- Rejected until TfNSW documents it (ADR-0001 still holds).

### Rank by a full generalised cost (walking 1.5, waiting 1.4, bus against rail, transfers)

- Pros: matches how people choose, as the appraisal guidance and the lot-choice studies measure it.
- Cons: a weighted score is not a time, and the list must show times. The bus constant and the transfer penalties need the mode and the number of changes on each hub route, which the hub table does not record. The lot-choice studies put car time at about 4 times transit time, but their weights rest on free-flow drive times, and a heavy car weight favours the nearest car park, which is the bias the owner reported.
- Adopted in part: waiting counts 1.4 and walking 1.5 when choosing which car parks to check (`packages/core/src/estimate.ts`), the drive counts once, and the estimate shown to people stays in plain minutes. The bus constant and transfer penalties wait for a hub table that records them.

## Consequences

### Positive

- Kellyville, Bella Vista, Hills Showground, Cherrybrook and Seven Hills are all tried for a Kellyville house to Central, with Seven Hills ranked by its T1 time rather than its bearing. On staging (version 6d48416d) that trip answers in 3.3 seconds with 9 options.
- Thirteen to fifteen car parks are listed with estimates instead of eight with reasons; "not on the way" no longer exists.
- Occupancy for every facility costs one call instead of one per car park, and every car park is placed at its entrance with its capacity.

### Negative

- Two Apple ETA calls per plan instead of one, and five TfNSW journey calls instead of four: about 12 Apple and 7 TfNSW requests per plan (docs/providers.md).
- The hub table is a snapshot of the timetable. It must be re-recorded when timetables change; the recording costs about 1,700 TfNSW calls and ten minutes. Its estimates for destinations far from any hub are rough; the exact check corrects the five that matter, but a sixth-best car park may be mis-ranked.
- Twins at one station are decided before any journey is asked for, so the other twin is reported "not tried" rather than "matched by another".
- `checkedCarParks` gained `stationName` and `estimatedMinutes`; the app before build 5 ignores them.

## Revisit if

- Plans to destinations away from the hubs are common, or the "not tried" estimates prove misleading: build the GTFS station matrix nightly and keep the hub table as its fallback.
- TfNSW documents car access or park-and-ride routing.
- Apple or TfNSW quotas bind (docs/providers.md gives the thresholds): cache ETAs per origin cell and time band before cutting candidates.
- A TfNSW engine upgrade stops honouring the stop-id origin or the walking preference.
