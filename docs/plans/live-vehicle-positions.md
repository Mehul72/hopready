# Plan: live vehicle positions on the trip map

Status: in progress
Branch: feat/live-vehicles

## Goal

A traveller following a trip can open its map and see where the bus, train or metro they are catching is now, like TripView's vehicle map, with how old each position is. Verifiable by:

- On staging, a planned Sydney bus, Sydney Trains and Sydney Metro service each come back from `POST /v1/vehicles` as `located`, with a position from TfNSW's live feed under the trip id the plan gave.
- The full trip map in the app shows a marker for each located service and a panel row per service that says how old its position is, or why there is none, in live and demo mode.
- TfNSW is asked for each feed at most once every 15 seconds per Workers isolate, only while someone is looking, and those calls have their own daily cap inside the existing TfNSW budget.
- Typecheck, lint and every test pass; the XCUITest walk-through passes; a TestFlight build carries the app side.

## Decided already

Owner answers on 2026-11-01 (this conversation):

- Modes: Sydney buses, Sydney Trains and Sydney Metro first. Light rail and ferries later, once their trip ids are checked against a real plan.
- Only the services in the trip being looked at, while its map is open. No "every bus on the route" view.
- Stay on Workers Free. Build to fit its 10 ms CPU limit and measure on staging; Workers Paid only if the measurement says so.
- Asking TfNSW about the quota is optional and the owner's to send.
- Committing and pushing each step, deploying to staging, using the TfNSW key for live checks and a TestFlight build are all authorised. Pull requests and merges still need a separate yes.
- The privacy explanation gains a line about sending a service's trip id. ADR-0006 then requires bumping `LIVE_DATA_CONSENT_VERSION`, which asks every traveller to agree again once.

Research and the live probe on 2026-11-01 (verified unless marked):

- TfNSW publishes GTFS-realtime Vehicle Positions, protobuf only, polled snapshots refreshed about every 15 s, no push option. Feeds: `/v1/gtfs/vehiclepos/buses`, `/v2/gtfs/vehiclepos/sydneytrains`, `/v2/gtfs/vehiclepos/metro`.
- The Trip Planner's `transportation.properties.RealtimeTripId`, already kept as `TransitLeg.realtimeTripId`, equals the feed's `vehicle.trip.trip_id` exactly for buses and Sydney Trains (probe). Metro shares the format but was not matched against a real plan.
- One feed per mode covers the scope, so the leg's mode picks the feed and the plan response does not change.
- Sizes on a Sunday afternoon: buses 242 KB and 1,263 vehicles, trains 40 KB and 217, metro 7 KB and 24. A first full decode of the bus feed took about 4 ms wall and 11 ms process CPU on this Mac; what Workers bills is unknown.
- 150 buses were listed under trips that had not started (TfNSW `performing_prior_trip`, extension 1007 field 4). Trains and metro never set it.
- Scheduled trains: median position age 51 s, 24 of 139 older than 5 minutes. Non-timetabled entries can be days old.
- HopReady's TfNSW budget is 50,000 calls a UTC day (TfNSW Bronze allows 60,000); vehicle calls must share it without starving planning.

Design (recorded in ADR-0013 in step 7):

- `POST /v1/vehicles` with `{ services: [{ mode, realtimeTripId }] }`. POST, like place search, so what someone is riding never sits in a URL or edge log.
- Each service answers `located` (position, bearing or null, observed time, whether the vehicle is still finishing its previous trip), `not-located`, `not-tracked` (no feed for the mode) or `unavailable` (the feed could not be read). The request as a whole fails only when the server is not set up or the request is invalid.
- One decoded copy of each feed per isolate, refreshed at most every 15 s and only on demand, one upstream fetch at a time, the same pattern as `CarParkCatalogue`. A copy up to 2 minutes old answers when a refresh fails. A Durable Object per feed is the fallback if isolates multiply.
- A hand-written decoder that reads only trip id, position, bearing, timestamp and the TfNSW prior-trip flag, with a size cap. No protobuf library: Workers forbid runtime code generation and the scope needs five fields.
- Vehicle calls count against the `tfnsw` budget and a new `tfnsw-realtime` cap (default 10,000 a day), so planning keeps at least 40,000.
- Demo mode answers from the demo timetable, labelled as sample positions, on the device and in the API's demo mode.

## Out of scope

- Light rail, ferries, NSW TrainLink, regional buses and coaches (they answer `not-tracked`).
- Showing vehicles on the results map, or every vehicle on a route.
- Background updates, notifications or Live Activities: positions only update while the map is open.
- Trip updates feeds (predicted delays) and static GTFS.
- Workers Paid, a Durable Object poller, or a TfNSW quota change.

## Steps

- [x] 1. Shared vehicle types and the demo locator
      files: packages/core/src/vehicles.ts, packages/core/src/providers.ts, packages/core/src/model.ts, packages/core/src/geo.ts, packages/core/src/fixtures/vehicle-locator.ts, packages/core/src/fixtures/index.ts, tests beside them
      done when: request and response schemas, the `VehicleLocator` interface and the demo locator exist; core tests cover a demo service before, during and after its run, a non-demo id, an unknown mode and schema limits; `pnpm --filter @hopready/core test` and typecheck pass
      verified: core 347 tests pass (22 new), core lint clean, core, API and app typecheck clean
- [x] 2. GTFS-realtime decoder and binary TfNSW requests
      files: apps/api/src/providers/tfnsw/gtfs-realtime.ts, apps/api/src/providers/http.ts, apps/api/src/providers/tfnsw/client.ts, trimmed real feeds in `apps/api/src/providers/tfnsw/__recordings__`, tests
      done when: the recorded bus, train and metro feeds decode to the trip ids seen on 2026-11-01, including the prior-trip flag; truncated, oversized and wrong-type input fails as malformed-response; binary requests share the gate, retry and failure mapping of JSON ones
      verified: API 358 tests pass (36 new: 16 decoder, 7 binary request, 3 client), lint, typecheck and format clean; recordings 21 KB in total
- [x] 3. Vehicle position provider with a shared copy per feed
      files: apps/api/src/providers/tfnsw/vehicle-positions.ts, apps/api/src/providers/tfnsw/index.ts, apps/api/src/providers/tfnsw/diagnostics.ts, apps/api/src/budget.ts, apps/api/src/config.ts, apps/api/src/composition.ts, apps/api/src/provider-set.ts, apps/api/src/worker.ts, tests
      done when: tests show one upstream fetch per feed per 15 s however many lookups arrive, a stale copy up to 2 minutes old answering a failed refresh, `unavailable` past that, the size cap, the 5 s timeout, and calls counted against both budgets with the realtime cap refusing first
      verified: API 376 tests pass (16 locator, 2 budget wiring), typecheck, lint and format clean. The timeout is 5 s, not the 8 s first written: the feeds answered in 0.15 s, and the app polls every 15 s
- [x] 4. `POST /v1/vehicles`
      files: apps/api/src/app.ts, apps/api/src/rate-limit.ts, apps/api/src/worker.ts, apps/api/src/logger.ts, apps/api/wrangler.jsonc, apps/api/README.md, apps/api/.dev.vars.example, docs/runbook.md, tests
      done when: route tests cover validation, duplicates, the per-install rate limit, not-configured, demo mode and a feed failure answering `unavailable` per service; the wrangler test keeps the new limiter in step in both environments; `pnpm --filter @hopready/api test`, typecheck and lint pass
      verified: API 391 tests pass (11 route, 1 log), typecheck, lint and format clean; the Node server in demo mode answered `not-located` and `not-tracked` over HTTP, 400 for an empty list, and its log never held the trip id
- [x] 5. App data: client, trip service and polling
      files: apps/mobile/src/api/client.ts, apps/mobile/src/api/schemas.ts, apps/mobile/src/trip/trip-service.ts, apps/mobile/src/trip/vehicle-positions.ts, apps/mobile/src/trip/queries.ts, apps/mobile/src/test-support/trips.ts, apps/mobile/README.md, tests
      done when: tests show which legs are asked about (transit legs with a trip id that have not ended), polling every 15 s only while the screen is focused and the app active, an unknown status read as `unavailable`, and demo mode never calling the API
      verified: app 749 tests pass (18 new: 5 trip service, 10 polling and selection, 3 client), typecheck and lint clean. Services more than an hour ahead are listed but not asked about; cancelled services are left out
- [x] 6. App UI: markers, the live positions panel and the way in
      files: apps/mobile/src/components/trip-map.tsx, apps/mobile/src/features/shared/map-screen.tsx, apps/mobile/src/features/shared/live-positions-panel.tsx, apps/mobile/src/features/itinerary/itinerary-screen.tsx, apps/mobile/src/features/itinerary/vehicle-text.ts, tests
      done when: component tests show a marker per located service that the camera does not re-frame for, each panel state in words and for VoiceOver, positions older than 5 minutes shown as out of date without a marker, tapping a row framing that vehicle, and sample positions labelled in demo mode; `pnpm --filter @hopready/mobile test`, typecheck and lint pass
      verified: app 770 tests pass (21 new: 16 wording, 3 map, 2 screen), typecheck, lint and format clean. The screen test plans a demo commute, opens its live map from the timeline, finds the vehicle placed and labelled as a sample, and taps its row to move the map. Not yet seen on a simulator; that is step 9
- [x] 7. Privacy explanation, decision record and docs
      files: apps/mobile/src/features/consent/live-data-consent-screen.tsx, apps/mobile/src/storage/settings.ts, site/privacy/index.html, docs/decisions/0013-live-vehicle-positions.md, docs/providers.md, docs/design/routing.md, docs/testing.md, docs/release.md, docs/PROGRESS.md
      done when: the consent screen and the privacy page say the same new line, the version is bumped with its tests updated, ADR-0013 records the design and what would reverse it, and `pnpm check` passes
      verified: `pnpm check` passes (core 347, API 391 with 8 live tests skipped, app 771), formatting clean. LIVE_DATA_CONSENT_VERSION is 2, with a test that an agreement to version 1 is asked again
- [x] 8. Staging deploy and live checks
      done when: staging is deployed; a bus, a Sydney Trains and a Metro service from real plans come back `located`; a bus 20 to 40 minutes out is checked for a trip id and a position; CPU per vehicles request is measured on staging and recorded here, with the Free or Paid answer it implies
      verified: staging version e8f0323c (584f67f1 redeployed for a cold isolate; previous fa88cec2). Four control plans match the baseline taken before the deploy. Buses (Bondi Junction, Kellyville), a Metro and a T1 from real plans came back `located`; bus 611 30 minutes out was located on its previous trip. Workers tail: vehicles requests 66 ms CPU on a fresh isolate, 33 ms on a second, 9 ms for a warm refresh of three feeds, 1 ms from the copy; plans 5 to 110 ms. All 200, no warnings, no trip id in any log line
- [ ] 9. Walk-through and TestFlight
      done when: the XCUITest walk-through passes with `-collect-test-diagnostics never`, an EAS build is uploaded, and Apple reports it valid and in beta testing

## Staging rollout (step 8)

Risk: medium. `/v1/vehicles` is new and no shipped build calls it, but the same deploy changes code every plan goes through: the shared retry path in `providers/http.ts`, the TfNSW client's gate, the budget ledger's names and a new rate limit binding. No one-way door: the only new data is ledger rows under the budget name `tfnsw-realtime`, which older code never reads.

- Before: note the current staging Worker version (`wrangler deployments list --env staging`); the airport fix recorded `fa88cec2-8250-494d-a88d-346d2a702e5f`.
- Advance when: health reports every provider configured, `vehicles` included; Kellyville to Central and the airport trip plan as they did, with no new unavailable strategies; a bus, a Sydney Trains and a Metro service from real plans come back `located`; no 5xx in the request logs.
- Hold on: a vehicle feed answering `unavailable`, or a plan slower than before by more than a second.
- Roll back without debate on: any plan that fails or answers 5xx where it did not before, or Error 1102 on `/v1/plan`. From apps/api, `CI=true npx wrangler rollback <previous version> --env staging --message 'Revert live vehicle positions'`, then check health and the Kellyville plan.
- Turn off only the feeds, keeping the rest: deploy with `--var TFNSW_REALTIME_DAILY_CALL_BUDGET:1`; lookups then answer `unavailable` after the first fetch.

## Open questions

- Closed 2026-11-01: does a cold decode pass Free's 10 ms of CPU? Yes: 66 ms on a fresh isolate, against 5 to 110 ms for trip plans on the same Worker, all answered `ok`. The vehicles route adds no CPU risk that planning does not already carry, so the Free or Paid decision stays where it is (docs/OWNER-ACTIONS.md, item 11).
- Closed 2026-11-01: a bus 30 minutes out (611 from Kellyville) had a trip id, was flagged live, and was in the feed on its previous trip.
- How large is the bus feed at a weekday peak? Measured in step 8 if staging runs then; the size cap in step 2 leaves room for ten times the Sunday size.

## Log

- 2026-11-01 Plan written from the research workflow (wf_9396733f-7ee) and the live probe. Feeds saved under the session scratchpad for the recordings in step 2.
- 2026-11-01 Step 8: all four Central to Parramatta trains came back `not-located`. Each was a timetable-only leg (not yet tracked), the first 15 minutes out, the same as the T1 that was missing in the probe: a train appears once TfNSW tracks its trip. One located T1 report was 23 minutes old, which the app shows as out of date with no marker.
- 2026-11-01 Step 7: release.md's App Privacy notes gained the trip map's request; it carries no place and nothing is kept, so neither answer option changes. The PROGRESS log row waits for the staging results in step 8.
- 2026-11-01 Step 6: the badge uses the theme's onModeColour, which the theme's contrast tests already hold to 4.5:1 on every mode colour in both schemes, instead of a new colour pairing. The live map link is offered only when a service runs on bus, train or metro; the panel still lists other services and says they have no live positions.
- 2026-11-01 Step 5: legs are asked about whether or not TfNSW marked them live, because buses appear in the feed under their trip id before the trip planner flags them (150 such buses on 2026-11-01). The query does not retry; the next poll 15 s later is the retry.
- 2026-11-01 Step 4: the feed name in diagnostics would have been dropped silently, because the logger writes only allowlisted fields; `feed` was added to LogFields with a test. The runbook gained a "live positions are unavailable" entry.
- 2026-11-01 Step 3: after a failed refresh a feed is left alone for 15 s, or as long as TfNSW's Retry-After asks up to 60 s, so a TfNSW outage costs one try per feed per window, not one per lookup. Budgets are checked before each feed fetch rather than around `locate`, so answers from a copy already held cost nothing even when a budget is spent. Reports older than 30 minutes read as not located.
- 2026-11-01 Step 2: a generator-based decoder took 1.2 ms warm and 11 ms of process CPU cold on the full Sunday bus feed (M5 Pro). A cursor that allocates no field objects takes 0.38 ms warm and 7.5 to 8.3 ms process CPU (3 ms wall) cold. Kept the cursor. Whether Workers counts helper threads stays open for step 8.
- 2026-11-01 Step 1: adding `tfnsw-realtime` to ProviderName broke the planner, which treats every provider name as a leg source (planner.ts driveLeg). It was added to DATA_SOURCES too; no leg is ever sent with it, so older apps are unaffected. The demo locator avoids `findLastIndex`, unused elsewhere, because it runs on the phone in demo mode.
