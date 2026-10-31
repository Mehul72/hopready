# How HopReady plans a trip

This explains the rules in `packages/core/src/planner.ts` and why they are shaped this way. The tests in `planner.test.ts` and `packages/core/src/fixtures/*.test.ts` are the executable version of this page. If they disagree, the tests win, and this page needs fixing.

## What it does not claim

HopReady estimates every documented car park within the driving limit, checks the five most promising exactly, and shows every option that works, reducing only two car parks at one station to one option (see "Only real choices"). It does not search every combination of car park, station and service across Sydney, and it never calls a result optimal. Every response lists the car parks within the driving limit with their estimates and what happened to each.

## Strategies

| Strategy         | Legs                                                      | Provider calls                                                                                                |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `transit-only`   | walk, transit, walk (from TfNSW)                          | 1 TfNSW trip                                                                                                  |
| `park-and-ride`  | drive, park, walk (HopReady's estimate), transit, walk    | 1 occupancy list, Apple ETAs for up to 20 car parks (10 a request), up to 5 TfNSW trips, up to 5 Apple routes |
| `drop-off`       | ride (someone else drives), drop-off, walk, transit, walk | same as park-and-ride, from the stations those car parks serve, without the occupancy list                    |
| `drive-only`     | drive                                                     | 1 Apple route                                                                                                 |
| `return-via-car` | walk, transit, walk to the car, car retrieval, drive      | 1 TfNSW trip (none within 300 m of the car), up to 2 Apple routes                                             |
| `transit-home`   | walk, transit, walk                                       | 1 TfNSW trip                                                                                                  |

A traveller who was dropped off gets `transit-home` and is never sent back for a car. The trip kind (`return-via-car` or `return-without-car`) comes from what the user confirmed in the app, not from the car park that was suggested.

## Choosing car parks

The rules below are ADR-0007. Direction is never a rule on its own: for a trip into the city from the Hills, the useful car parks lie beside or behind the traveller (Seven Hills on the T1 for a Kellyville house), so a car park earns or loses its place on the estimate, not on its bearing.

1. **Pool.** Documented Transport Park&Ride facilities from the Car Park API, placed at their entrances with their station's stop id and capacity, plus spots the user saved. Bus stops and stations are never treated as car parks.
2. **Reach.** A car park must be within `maxDriveMinutes × 1.5 km` of the origin. That is a 90 km/h bound, and straight-line distance never beats the road.
3. **Estimate.** Every car park within reach gets a door-to-door estimate: a rough drive (straight line × 1.35 at 40 km/h), the parking buffer, HopReady's walk from the entrance to the platform, and the public transport time from the station. The public transport time comes from the hub table (`packages/core/src/data/park-and-ride-hub-times.ts`): on-board minutes and headway from each Park&Ride station to Sydney's hubs, recorded from the TfNSW Trip Planner for weekday peak (6 to 10 and 15 to 19), weekday off-peak and weekend. The planner adds half the headway as waiting, then the walk from the hub nearest the destination (up to 1.5 km) or a 5 minute change and a rough onward ride. A straight-line ride (distance × 1.35 at 35 km/h, plus 8 minutes) is the ceiling, so a destination far from every hub still gets an estimate (`packages/core/src/estimate.ts`). Alongside the plain minutes, each car park gets a score in which waiting counts 1.4 times and walking 1.5 times, the weights Transport for NSW and ATAP use in appraisal, because a minute waiting or walking weighs more than a minute on board when people choose where to drive to. The score decides the ranking below; the plain minutes are what the list shows.
4. **Drive times.** The best 20 by score are sent to Apple's ETA endpoint, and the estimate and score are refined with the real drive. A car park whose drive runs past `maxDriveMinutes` is `too-far-to-drive`.
5. **Choice.** Five car parks are asked for journeys: any car park or station the person asked for, the quickest drive, then the best by refined score. One car park per station: of two at one station, the one surer of a space (a fresh count with more than 10% free beats unknown or stale, which beats nearly full), then the better scored, speaks for both. The hub table is a timetable snapshot, so the exact check corrects the five that matter; the rest are shown with their estimate, not with a journey.
6. **Journeys.** TfNSW is asked for journeys from the station's stop id, so they start at the platform without TfNSW's padded walk from the car park. HopReady adds its own walk leg from the car park to the platform at the person's walking speed (source `hopready`).
7. **Explanation.** Each car park within reach is reported with its station, its estimate and one outcome: `used`, `matched-by-another`, `left-out-for-space`, `too-far-to-drive`, `not-tried`, `no-workable-connection` or `provider-error`. A car park is `used` only when its option is shown. One not among the five, or spoken for by a twin at its station, is `not-tried`, so none goes missing from the list. One whose option works but is left out behind a shown option at the same station (see "Only real choices") is `matched-by-another`. One whose option works but is cut because more options work than the 10 a response lists is `left-out-for-space`. `not-towards-destination` is no longer produced; it stays in the schema so older answers still parse.

Drop-off uses the stations served by the car parks within reach, plus a preferred station, through the same steps without the occupancy list: the preferred station, the quickest drive, then the best by estimate, five in all. When no drop-off option works, an `unavailable` entry says whether no station was within the driving limit or no connection worked from the stations checked.

## Timing

**Depart at T.**

1. TfNSW is asked for journeys from the station's platform leaving after `T + drive estimate + parking buffer + walk from the car park`, rounded up to the minute.
2. For the workable journey that arrives first (of two that arrive together, the one that leaves later; of two with the same times, the one within the preferences), Apple is asked for the drive that arrives by `journey start − walk from the car park − parking buffer`. TfNSW's order is not relied on.
3. That gives the latest sensible "Leave at", which cuts waiting.
4. If traffic means that leaving time would be before T, the drive is recalculated leaving at T, and the first journey in the same order that can still be caught is used. The car park is dropped only if none can.

**Arrive by T.**

1. TfNSW is asked for journeys arriving by T. The latest workable one that arrives by T is chosen, so a service now running late is skipped.
2. Apple is asked for a drive arriving by `journey start − walk from the car park − parking buffer`. Apple supports arrival times natively, so the planner never guesses.
3. Options that would need you to leave in the past are rejected.

**Return through the car.** TfNSW plans a journey to the car's exact confirmed coordinate. Then the car retrieval buffer applies. Then Apple plans the drive home, leaving at that moment (depart-at), or arriving by T (arrive-by, solved backwards from the drive).

- Depart-at keeps the two journeys that reach the car first.
- Arrive-by takes the latest journey that reaches the car by the time retrieval has to start, so the buffer is never shortened.
- Within 300 m of the car (the gap allowed between legs), TfNSW is not asked. The trip starts with a walk estimated from the distance at your walking speed, or with the car retrieval when you are already at the car.
- The drive home is never rejected for being longer than the driving limit, because it is the only way to get the car home. The option carries a note saying so instead.

After parking, the walk to the platform starts straight away, and any wait happens at the platform, not in the car park.

## Buffers, applied once

| Buffer        | Default | Where it sits                                                                                                  |
| ------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Parking       | 8 min   | Between arriving at the car park and starting the walk. Covers finding a space, parking and reaching the exit. |
| Drop-off      | 2 min   | Between the drop-off and starting the walk.                                                                    |
| Transfer      | 3 min   | The minimum time between arriving on one service and the next one leaving, including any walk between them.    |
| Car retrieval | 5 min   | Between reaching the car and driving off.                                                                      |

A change is marked `tight-change` when `window < max(buffer, walk time)` (see "Preferences"), and rejected only when `window < walk time`, that is when the next service has left before the walk ends. The buffer is never added on top of TfNSW's own walking time, so it is not double-counted. All defaults can be changed in the app, and Settings explains each one. The trip timeline shows each change against the transfer buffer the trip was planned with, on the walk or wait that starts it, for example "Change at Wynyard Station: 8 min including the walk; your transfer buffer is 3 min".

HopReady sends TfNSW the walking limit as a preference (`itOptionsActive=1`, `trITMOT=100`, `trITMOTvalue100=N`, with N shortened for a slow walker), which shapes the journeys TfNSW proposes without rejecting any (see "Preferences"). It sends no walking speed, because no parameter for it has been verified. For a slow walker, TfNSW's walking times are stretched by how much longer walking takes at the slow speed than at the normal one, before any of these checks; normal and fast keep TfNSW's times.

## Preferences: options that are marked, never hidden

The walking limit, the driving limit and the transfer buffer are preferences (ADR-0008). An option outside them is kept and carries a concern, which the app shows on the option:

| Concern        | Rule                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `long-walk`    | A single walking leg is longer than the walking limit                                                                |
| `long-drive`   | The drive is longer than the driving limit (driving the whole way included), except the drive home from a parked car |
| `tight-change` | A change is shorter than the transfer buffer, including any walk between the services                                |

The walking limit also goes to TfNSW as a preference, which shapes the journeys it proposes. The driving limit also decides which car parks are tried (see "Choosing car parks"). From a car park, when a journey within the preferences and one outside them both work, the one within is used.

## Feasibility: options that are rejected, never shown

| Reason                     | Rule                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `cancelled-service`        | Any transit leg is marked cancelled                                                     |
| `transfer-too-short`       | A change cannot be made: the walk between the services ends after the next one has left |
| `departs-in-past`          | The trip would start more than a minute before now                                      |
| `departs-before-requested` | A depart-at trip starts before the requested time                                       |
| `arrives-after-target`     | An arrive-by trip arrives after the target                                              |
| `discontinuous`            | Legs overlap in time, or jump more than 300 m between legs                              |
| `duplicate`                | The same services and car park as another option                                        |

`walk-too-long` and `drive-too-long` are no longer produced; they stay in the schema so older answers still parse. Counts of each reason come back with the response, so the app can explain an empty result ("some connections could not be made in time at your walking speed") instead of padding the list with poor options.

## Only real choices

Options at different stations are all listed. The other station is the fallback for when the shown car park fills, and its services differ, so neither stands in for the other. Only two car parks at one station are reduced to one option, since they share its services. Usually that happens before any journey is asked for: one car park per station is tried (see "Choosing car parks") and the other is `not-tried` with its estimate. When both were tried, because the person asked for one and the other was the quickest drive or the best by estimate, a `park-and-ride` or `drop-off` option is left out when a shown option of the same strategy at the same station is at least as good on everything the results can be sorted by, and as certain:

- it arrives no later, drives no more and has no more changes, with times and drives read to the minute the way the cards show them;
- it leaves no more than a minute earlier, because a minute is not worth a card of its own;
- it has no service alert the other avoids, and at least as many live times (live, then partly live, then timetable);
- for a car park, the traveller is as sure of a space there: `known` with more than 10% of the spaces free beats unknown or stale, which beats `known` and nearly full. Car parks at one station are duplicates rather than fallbacks, so this holds however old the counts will be by the time the traveller gets there. A drop-off needs no space.

The car park the traveller asked for is never left out this way. Options are compared strongest first, so an option is only ever left out behind one that is shown. Public transport only, `drive-only` and return trips are never left out this way.

## Unknown is unknown

| Data                        | When known                                                                                                                                                                     | When stale or missing                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Occupancy                   | `known`                                                                                                                                                                        | `stale` if older than 15 minutes; `unknown` if missing. It is a snapshot from now, never a promise for when you arrive.                                                                                                                                                                                                       |
| Parking rules               | Documented rules, with their source page and the date checked                                                                                                                  | `unknown` for spots the user saved                                                                                                                                                                                                                                                                                            |
| Fares                       | Not available                                                                                                                                                                  | Always `unknown`, because TfNSW removed Opal fares from `/trip` in October 2023                                                                                                                                                                                                                                               |
| Accessibility               | Not available                                                                                                                                                                  | `unknown`                                                                                                                                                                                                                                                                                                                     |
| Platforms                   | Only when TfNSW states them                                                                                                                                                    | Otherwise null. For a train or metro the app says "Platform not provided" for the platform to board at; for a bus, ferry or light rail stop, which often has none, it shows a stated stand, wharf or bay and nothing otherwise. An arrival platform it was not given is left out                                              |
| Station entrances and exits | Not available. HopReady keeps only the walking time from TfNSW's `footPathInfo`, and drops `footPathElem` and walking legs' `pathDescriptions`, where any such detail would be | Never named. "Entrance details not provided" or "Exit details not provided", then "Follow the station signs.", on the walk into or out of a train or metro station, or on the train or metro itself when no walk leads in or out. A platform change inside one station, and the station a trip starts or ends at, get no note |
| Times                       | Live only when TfNSW says the leg is realtime-controlled, and while the last check is at most 15 minutes old                                                                   | Otherwise labelled timetable or estimate. Live times from an older check are labelled "Checked <time>"                                                                                                                                                                                                                        |

## Time

- Instants travel as UTC ISO strings.
- Sydney wall-clock time is used only:
  - to talk to TfNSW, which takes a local date and time;
  - to show times to people. Times always display in Sydney time, whatever time zone the phone is in.
- A local time inside the October daylight-saving gap moves forward by the gap.
- A repeated April time picks the earlier occurrence unless told otherwise (`packages/core/src/time.ts`).

## When providers fail

Every provider call has its own timeout (8 s by default) on top of the request's deadline. If driving or the car park list fails, public transport options still come back, and an `unavailable` entry explains what is missing. If everything fails, the provider error reaches the API, which maps it to an HTTP status. A provider failure is never replaced with made-up data.

## Refreshing

- Results refresh when the person asks, at most every 30 seconds after the shown results arrived.
- A followed trip is checked when the app comes back to the foreground, once its last answer is more than 60 seconds old, and from Check for changes on the trip screen, at most every 30 seconds. Both count from the last answer: a check that found the trip no longer offered counts, a failed one never does, so Try again is never held back. The trip screen's "Checked <time>" line shows that time.
- Before the trip starts, a check re-plans the whole trip and matches the chosen option: the same trip if it is still offered (the same services on the same timetabled runs, even when a delay adds or removes a wait between them), otherwise the closest run with the same strategy, car park or drop-off station, and first service. The check asks for the chosen option's car park or drop-off station, which is never left out (see "Only real choices"), so a car park chosen while a better one was nearly full is still found once that one has room.
- Once the trip has started, only the rest is planned: from the stop of the next service that has not left, by public transport only (a trip home still ends with the drive from the car). The search starts from the earlier of that service's timetabled and estimated times, never before now, so a service that has made up time is still found. The trip still runs when an option rides every service still to come on the same runs and can still be made from the part already travelled, which keeps its planned times: no service may leave before the traveller reaches its stop, and every change keeps the transfer buffer. Alternatives that cannot be made that way are not offered.
- A service that has already left cannot be planned again, so a delay on it, and a connection it then misses, is not seen. After such a check the trip screen says only that the next services are still running.
- If the chosen option is gone (a cancellation, or a connection that no longer works), the app says so and shows the alternatives, or explains that nothing is currently available. Once the trip has started, the alternatives say which stop they leave from, and following one keeps the part already travelled, so a drive and park trip keeps its drive, its car park and I parked here.
- Times are called live only while the last check is at most 15 minutes old, the limit used for car park counts. After that the results and the trip screen show "Checked <time>" instead.
- A trip home planned before the car changed (moved, removed, dropped off, or a car saved after a trip home without one) is never refreshed or checked. The results and the trip screen say it is out of date, Start this trip is unavailable, and the banner leads to Take me home on the Car tab, or to the Plan tab when no car is saved.
