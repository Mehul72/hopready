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
- [ ] 3. Vehicle position provider with a shared copy per feed
      files: apps/api/src/providers/tfnsw/vehicle-positions.ts, apps/api/src/providers/tfnsw/index.ts, apps/api/src/budget.ts, apps/api/src/config.ts, apps/api/src/composition.ts, tests
      done when: tests show one upstream fetch per feed per 15 s however many lookups arrive, a stale copy up to 2 minutes old answering a failed refresh, `unavailable` past that, the size cap, the 8 s timeout, and calls counted against both budgets with the realtime cap refusing first
- [ ] 4. `POST /v1/vehicles`
      files: apps/api/src/app.ts, apps/api/src/rate-limit.ts, apps/api/src/worker.ts, apps/api/src/node-server.ts, apps/api/src/runtime.ts, apps/api/src/provider-set.ts, apps/api/wrangler.jsonc, apps/api/README.md, tests
      done when: route tests cover validation, duplicates, the per-install rate limit, not-configured, demo mode and a feed failure answering `unavailable` per service; the wrangler test keeps the new limiter in step in both environments; `pnpm --filter @hopready/api test`, typecheck and lint pass
- [ ] 5. App data: client, trip service and polling
      files: apps/mobile/src/api/client.ts, apps/mobile/src/api/schemas.ts, apps/mobile/src/trip/trip-service.ts, apps/mobile/src/trip/vehicle-positions.ts, tests
      done when: tests show which legs are asked about (transit legs with a trip id that have not ended), polling every 15 s only while the screen is focused and the app active, an unknown status read as `unavailable`, and demo mode never calling the API
- [ ] 6. App UI: markers, the live positions panel and the way in
      files: apps/mobile/src/components/trip-map.tsx, apps/mobile/src/features/shared/map-screen.tsx, apps/mobile/src/features/itinerary/itinerary-screen.tsx, apps/mobile/src/features/itinerary/vehicle-text.ts, tests
      done when: component tests show a marker per located service that the camera does not re-frame for, each panel state in words and for VoiceOver, positions older than 5 minutes shown as out of date without a marker, tapping a row framing that vehicle, and sample positions labelled in demo mode; `pnpm --filter @hopready/mobile test`, typecheck and lint pass
- [ ] 7. Privacy explanation, decision record and docs
      files: apps/mobile/src/features/consent/live-data-consent-screen.tsx, the consent version constant, site/privacy/index.html, docs/decisions/0013-live-vehicle-positions.md, docs/providers.md, docs/design/routing.md, docs/PROGRESS.md
      done when: the consent screen and the privacy page say the same new line, the version is bumped with its tests updated, ADR-0013 records the design and what would reverse it, and `pnpm check` passes
- [ ] 8. Staging deploy and live checks
      done when: staging is deployed; a bus, a Sydney Trains and a Metro service from real plans come back `located`; a bus 20 to 40 minutes out is checked for a trip id and a position; CPU per vehicles request is measured on staging and recorded here, with the Free or Paid answer it implies
- [ ] 9. Walk-through and TestFlight
      done when: the XCUITest walk-through passes with `-collect-test-diagnostics never`, an EAS build is uploaded, and Apple reports it valid and in beta testing

## Open questions

- Does Workers bill V8 helper-thread CPU, putting a cold bus-feed decode over Free's 10 ms? Blocks the verdict in step 8; if it does, Workers Paid goes back to the owner.
- Does the Trip Planner give a trip id for a bus 20 to 40 minutes out, and is that bus already in the feed? Checked in step 8. Step 5 does not gate on the live flag, so this does not block it.
- How large is the bus feed at a weekday peak? Measured in step 8 if staging runs then; the size cap in step 2 leaves room for ten times the Sunday size.

## Log

- 2026-11-01 Plan written from the research workflow (wf_9396733f-7ee) and the live probe. Feeds saved under the session scratchpad for the recordings in step 2.
- 2026-11-01 Step 2: a generator-based decoder took 1.2 ms warm and 11 ms of process CPU cold on the full Sunday bus feed (M5 Pro). A cursor that allocates no field objects takes 0.38 ms warm and 7.5 to 8.3 ms process CPU (3 ms wall) cold. Kept the cursor. Whether Workers counts helper threads stays open for step 8.
- 2026-11-01 Step 1: adding `tfnsw-realtime` to ProviderName broke the planner, which treats every provider name as a leg source (planner.ts driveLeg). It was added to DATA_SOURCES too; no leg is ever sent with it, so older apps are unaffected. The demo locator avoids `findLastIndex`, unused elsewhere, because it runs on the phone in demo mode.
