# ADR-0013: Live vehicle positions from TfNSW's feeds, one shared copy per feed in each Worker isolate

## Status

Accepted. Decided in docs/plans/live-vehicle-positions.md before building; the owner chose the recommended scope, hosting and quota answers on 2026-11-01.

## Date

2026-11-01

## Context

The owner asked whether a traveller can see where their bus is now, as in TripView.

What is true, checked on 2026-11-01 (a live probe and a research workflow whose claims were checked against their sources):

- TfNSW publishes GTFS-realtime Vehicle Positions: protobuf only, full snapshots refreshed about every 15 s, fetched by polling. There is no push, stream or webhook. Sydney is covered by `/v1/gtfs/vehiclepos/buses`, `/v2/gtfs/vehiclepos/sydneytrains` and `/v2/gtfs/vehiclepos/metro`; light rail, ferries, NSW TrainLink and regional buses are 20 more feeds.
- The Trip Planner's `RealtimeTripId`, which HopReady already keeps on every transit leg, equals the feed's `trip_id` exactly: the T1 and both buses of two real plans were found that way. Metro uses the same format but was not matched against a plan.
- On a Sunday afternoon the bus feed was 242 KB with 1,263 vehicles; trains 40 KB with 217; metro 7 KB with 24. 150 buses were already listed under trips that had not started. Train positions had a median age of 51 s, but 24 of 139 were over 5 minutes old.
- HopReady runs on Workers Free: 10 ms of CPU per request and 100,000 requests a day. A first decode of the full bus feed took 3 ms of wall time and 7.5 to 8.3 ms of process CPU on an M5 Pro; repeated decodes 0.4 ms. On staging, Workers reported 66 ms of CPU for a lookup on a fresh isolate, 9 ms for a warm refresh of three feeds and 1 ms from the copy, against 5 to 110 ms for trip plans, all answered without Error 1102.
- On Workers a fetch, and the timers bounding it, end with the request that started it if that request is cancelled. The app cancels a poll whenever the map closes mid-request, so a promise shared between requests can be left pending for good (reproduced in workerd by the review on 2026-11-01).
- TfNSW's Bronze plan allows 60,000 calls a day and 5 a second per key; HopReady caps itself at 50,000 a UTC day for trip planning, stop search and car parks.
- The app plans with ADR-0006's agreement: every change to what is sent needs the agreement asked again.

## Decision

1. The app shows, on a followed or viewed trip's full map, where the vehicles of that trip's own services are, polled every 15 s while the map is on screen and the app is in front. No other vehicles, no background updates.
2. `POST /v1/vehicles` takes up to 8 services as `{ mode, realtimeTripId }` and answers each `located` (position, bearing or null, report time, whether the vehicle is still finishing its previous trip), `not-located`, `not-tracked` or `unavailable`. POST so what someone rides never sits in a URL; trip ids are never logged.
3. Each Worker isolate keeps one decoded copy of each feed, fetched only when a lookup needs it and at most once every 15 s, one fetch at a time, with no retry. After a failure it waits 15 s, or TfNSW's `Retry-After` up to a minute, and answers from its last copy while that is under 2 minutes old. Each lookup waits at most 6 s on a fetch another request started, with its own timer, and a fetch pending longer is replaced; the daily budget's first sync is bounded the same way (1.5 s per check, restarted after 10 s).
4. A decoder written for the purpose reads only the trip id, position, bearing, report time and TfNSW's prior-trip flag (extension 1007, field 4), with a 4 MB cap and a 5 s timeout.
5. The mode picks the feed (bus, train, metro). Every other mode answers `not-tracked`, so the plan response did not change.
6. Feed requests count against the TfNSW budget and a cap of their own (`TFNSW_REALTIME_DAILY_CALL_BUDGET`, 10,000 a day), checked before each fetch, so polling never takes the calls planning needs.
7. Reports older than 30 minutes read as `not-located`; the app puts no marker for a position older than 5 minutes and says how old every position is.
8. The live data agreement gains a line for this and moves to version 2.

## Alternatives considered

### A Durable Object per feed

- Pros: one TfNSW fetch per feed per 15 s across every isolate, however many there are.
- Cons: a DO request per lookup against Free's 100,000 a day; an object kept warm by a timer is billed for duration and keeps calling TfNSW when nobody watches, while one without a timer hibernates after 10 s and drops its copy; and the Node server would need a second path.
- Rejected for now: with a handful of testers there are a handful of isolates, so the saving is a few calls a minute. It is the first change to make if isolates multiply (Revisit if).

### A protobuf library (gtfs-realtime-bindings, protobufjs)

- Pros: decodes every field, maintained by others.
- Cons: protobufjs's reflection path builds code with `Function`, which Workers forbid; the static bindings decode every field into objects, more CPU and memory than reading five, on the request path where Free allows 10 ms; and they add dependencies for fields HopReady does not use.
- Rejected: a 290 line decoder, tested against real recorded feeds, covers the five fields.

### Pushing positions to the phone

- Pros: no polling while a trip is followed; could drive a Live Activity.
- Cons: TfNSW offers no push, so the server would still poll; it needs APNs credentials, a stored device token per traveller and a background job, none of which Workers Free or ADR-0006's "the server keeps nothing" allows today.
- Rejected: polling from the open map gives the same picture while it is looked at, which is when it matters.

### Keeping the shared fetch alive with `waitUntil`

- Pros: a fetch would survive the cancellation of the request that started it, so no lookup would wait the 6 s.
- Cons: the locator and the budget would need each request's execution context threaded through the core's provider interface, for a case the bounded waits already recover from in seconds.
- Rejected for now: the first change to make if the 6 s waits show up in the logs.

### Gating on TfNSW's live flag

- Pros: asks only about services the Trip Planner says are tracked.
- Cons: buses are often in the feed under their trip id before the Trip Planner flags them (150 on 2026-11-01).
- Rejected: every leg with a trip id is asked about; the answer says when there is no vehicle.

## Consequences

### Positive

- "Where is my bus" works for Sydney buses, Sydney Trains and Metro from the trip map, in live and demo mode, with no change to how trips are planned.
- TfNSW calls stay bounded however many people watch: at most four a minute per feed per isolate, inside a daily cap that leaves planning at least 40,000.
- A TfNSW feed outage shows as "could not get its position" per service, with the rest of the trip untouched.

### Negative

- Every isolate fetches its own copy, so TfNSW calls grow with the number of isolates, not with demand.
- A lookup on a fresh isolate used 66 ms of CPU on staging, well past Free's 10 ms, though trip plans already use up to 110 ms without Error 1102. If Cloudflare starts enforcing the limit, both need Workers Paid.
- One client spreading requests over many Cloudflare locations can spend the day's realtime cap, after which live positions answer `unavailable` for everyone until 00:00 UTC; planning keeps its share.
- Trains and metro have no prior-trip flag, so a train may not appear until its trip starts. Replacement buses, private ferries and some coaches never have a position.
- Positions update only while the map is open; nothing warns a traveller who is not looking.
- Everyone who agreed to live data use is asked once more, because the agreement's version moved.

## Revisit if

- TfNSW calls for vehicle feeds pass a few thousand a day, or Workers runs many isolates: move the copy into a Durable Object per feed.
- Workers reports Error 1102 on `/v1/vehicles` or `/v1/plan`: Workers Paid, or decode in a Durable Object.
- The owner wants light rail or ferries: confirm their trip ids against real plans first; L1's ids may not match.
- The owner wants alerts while the app is closed: that is push, and it needs its own decision.
