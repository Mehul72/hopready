# How HopReady plans a trip

This explains the rules in `packages/core/src/planner.ts` and why they are shaped this way. The tests in `planner.test.ts` and `packages/core/src/fixtures/*.test.ts` are the executable version of this page. If they disagree, the tests win, and this page needs fixing.

## What it does not claim

HopReady checks a small, explainable set of options and shows the ones that work. It does not search every combination of car park, station and service across Sydney, and it never calls a result optimal. Every response lists the car parks it checked and what happened to each.

## Strategies

| Strategy         | Legs                                                      | Provider calls                                                             |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `transit-only`   | walk, transit, walk (from TfNSW)                          | 1 TfNSW trip                                                               |
| `park-and-ride`  | drive, park, walk, transit, walk                          | 1 Apple ETA (up to 8 car parks), up to 3 TfNSW trips, up to 3 Apple routes |
| `drop-off`       | ride (someone else drives), drop-off, walk, transit, walk | same as park-and-ride, from stations                                       |
| `drive-only`     | drive                                                     | 1 Apple route                                                              |
| `return-via-car` | walk, transit, walk to the car, car retrieval, drive      | 1 TfNSW trip, up to 2 Apple routes                                         |
| `transit-home`   | walk, transit, walk                                       | 1 TfNSW trip                                                               |

A traveller who was dropped off gets `transit-home` and is never sent back for a car. The trip kind (`return-via-car` or `return-without-car`) comes from what the user confirmed in the app, not from the car park that was suggested.

## Choosing car parks

1. **Pool.** Documented Transport Park&Ride facilities from the Car Park API, plus spots the user saved. Bus stops and stations are never treated as car parks.
2. **Straight-line filter.**
   - The car park must be within `maxDriveMinutes × 1.5 km` of the origin. That is a 90 km/h bound, and straight-line distance never beats the road.
   - It must be at least 1 km closer to the destination than the origin is.
   - The detour (origin to car park to destination) must be at most 1.6 times the direct distance.
   - A preferred car park skips the direction checks but not the driving limit.
3. **Ranking.** One Apple ETA call for up to 8 shortlisted candidates. Candidates beyond `maxDriveMinutes` are dropped. The rest are scored by drive time plus a rough transit estimate (distance × 1.35 at 35 km/h, plus 8 minutes), and the best 3 are kept. The preferred car park always ranks first.
4. **Explanation.** Each checked car park is reported with one outcome: `used`, `too-far-to-drive`, `not-towards-destination`, `no-workable-connection` or `provider-error`.

Drop-off uses the stations served by those car parks, plus a preferred station, through the same steps.

## Timing

**Depart at T.**

1. TfNSW is asked for journeys from the car park leaving after `T + drive estimate + parking buffer`, rounded up to the minute.
2. For the earliest workable journey, Apple is asked for the drive that arrives by `journey start − parking buffer`.
3. That gives the latest sensible "Leave at", which cuts waiting.
4. If traffic means that leaving time would be before T, the drive is recalculated leaving at T. The connection is dropped if it no longer works.

**Arrive by T.**

1. TfNSW is asked for journeys arriving by T. Results are in arrive-by order, and the latest workable one is chosen.
2. Apple is asked for a drive arriving by `journey start − parking buffer`. Apple supports arrival times natively, so the planner never guesses.
3. Options that would need you to leave in the past are rejected.

**Return through the car.** TfNSW plans a journey to the car's exact confirmed coordinate. Then the car retrieval buffer applies. Then Apple plans the drive home, leaving at that moment (depart-at), or arriving by T (arrive-by, solved backwards from the drive).

After parking, the walk to the platform starts straight away, and any wait happens at the platform, not in the car park.

## Buffers, applied once

| Buffer        | Default | Where it sits                                                                                                  |
| ------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Parking       | 8 min   | Between arriving at the car park and starting the walk. Covers finding a space, parking and reaching the exit. |
| Drop-off      | 2 min   | Between the drop-off and starting the walk.                                                                    |
| Transfer      | 3 min   | The minimum time between arriving on one service and the next one leaving, including any walk between them.    |
| Car retrieval | 5 min   | Between reaching the car and driving off.                                                                      |

The transfer buffer is checked as `window ≥ max(buffer, walk time)`. It is never added on top of TfNSW's own walking time, so it is not double-counted. All defaults can be changed in the app, and Settings explains each one.

## Feasibility: options that are rejected, never shown

| Reason                     | Rule                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `cancelled-service`        | Any transit leg is marked cancelled                        |
| `walk-too-long`            | Any single walking leg exceeds the user's maximum          |
| `transfer-too-short`       | A connection window is below `max(transfer buffer, walk)`  |
| `drive-too-long`           | The drive leg exceeds the user's maximum                   |
| `departs-in-past`          | The trip would start more than a minute before now         |
| `departs-before-requested` | A depart-at trip starts before the requested time          |
| `arrives-after-target`     | An arrive-by trip arrives after the target                 |
| `discontinuous`            | Legs overlap in time, or jump more than 300 m between legs |
| `duplicate`                | The same services and car park as another option           |

Counts of each reason come back with the response, so the app can explain an empty result ("some connections were shorter than your 3 min transfer buffer") instead of padding the list with poor options.

## Unknown is unknown

| Data          | When known                                                    | When stale or missing                                                                                                   |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Occupancy     | `known`                                                       | `stale` if older than 15 minutes; `unknown` if missing. It is a snapshot from now, never a promise for when you arrive. |
| Parking rules | Documented rules, with their source page and the date checked | `unknown` for spots the user saved                                                                                      |
| Fares         | Not available                                                 | Always `unknown`, because TfNSW removed Opal fares from `/trip` in October 2023                                         |
| Accessibility | Not available                                                 | `unknown`                                                                                                               |
| Platforms     | Only when TfNSW states them                                   | Otherwise null, and the app says "Platform not provided"                                                                |
| Times         | Live only when TfNSW says the leg is realtime-controlled      | Otherwise labelled timetable or estimate                                                                                |

## Time

- Instants travel as UTC ISO strings.
- Sydney wall-clock time is used only:
  - to talk to TfNSW, which takes a local date and time;
  - to show times to people. Times always display in Sydney time, whatever time zone the phone is in.
- A local time inside the October daylight-saving gap moves forward by the gap.
- A repeated April time picks the earlier occurrence unless told otherwise (`packages/core/src/time.ts`).

## When providers fail

Every provider call has its own timeout (8 s by default) on top of the request's deadline. If driving fails, public transport options still come back, and an `unavailable` entry explains what is missing. If everything fails, the provider error reaches the API, which maps it to an HTTP status. A provider failure is never replaced with made-up data.

## Refreshing

- The app refreshes when the user asks, at most every 30 seconds.
- An active trip refreshes when the app returns to the foreground, if it is more than 60 seconds old.
- A refresh re-plans and matches the chosen option by strategy, car park and first service.
- If the chosen option is gone (a cancellation, or a missed connection), the app says so and shows the alternatives, or explains that nothing is currently available.
