# Plan: car park choice, route choice and a simpler results screen (v2)

Status: in progress (server done; app and docs next)
Branch: feat/hopready-v1

## Goal

HopReady lists the car parks and routes a local would consider, ranked by real door-to-door time, never returns nothing when the providers returned something, and shows it on a results screen as plain as Apple Maps or Google Maps: a short list of options, details behind a tap.

Verifiable by:

- Kellyville (Wrights Rd) to Central at 8 am on a weekday lists Hills Showground, Kellyville, Bella Vista, Cherrybrook and Seven Hills with exact times, in time order, with Seven Hills checked rather than "not tried".
- 41 Hunter St, Parramatta to 50 Carrington St, Sydney with an 8 minute walking preference still shows the T1 trip, marked as a longer walk, instead of "No trip options found".
- The results screen shows the map, the options and nothing else above the fold; freshness, sorting, excluded car parks and reasons are reachable from it but not on it.
- Scenario tests in packages/core cover both trips; 702 or more app tests pass; the XCUITest walk-through passes; staging is deployed before the TestFlight build that depends on it.

## Decided already

- Park-and-ride is composed by HopReady (drive from Apple Maps, public transport from TfNSW): ADR-0001. Confirmed again on 2026-10-31: TfNSW's trip planner rejects a car access leg (`trITMOT=104` answers "origin: no it connection").
- Apple Maps for drive legs and the map: ADR-0002.

## Out of scope

- Fares, accounts, sync, Android, background location (unchanged from v1).
- A graph router of our own.
- Changing the live data agreement (ADR-0006) or what the server stores (nothing).

## Steps

Server and core first (no app build needed; build 4 keeps working because every schema change is additive and unknown fields are stripped), then the app.

- [ ] 0. Research brief in docs/research/park-and-ride.md with sources; code map read
      done when: the brief exists, every design-relevant fact is marked verified, inferred or unknown
- [x] 1. Hub travel-time table: apps/api/scripts/record-hub-times.ts writes packages/core/src/data/park-and-ride-hub-times.ts (34 stations x 10 hubs x 3 periods). Commit a998245
      done when: the file is generated from TfNSW, committed, and a core test checks every catalogue station has a row
- [x] 2. TfNSW adapter sends the walking preference (`itOptionsActive=1&trITMOT=100&trITMOTvalue100=N`). Commit 6c5bbd4
      files: apps/api/src/providers/tfnsw/transit.ts, transit.test.ts
      done when: the request test asserts the three parameters; a plan on staging still answers (staging check in step 8)
- [x] 3. Occupancy for every facility in one `/v1/carpark/full-list` call, cached 60 s, per-facility calls only as the fallback; the same list places every car park at its entrance. Commits 2ac2443, 48f39cc
      files: apps/api/src/providers/tfnsw/car-parks.ts, schemas.ts, recordings.test.ts, car-parks.test.ts
      done when: a plan makes one occupancy request; the recorded full list parses; a failed full list falls back
- [x] 4. Car park journeys start at the station stop id, with HopReady's own walk leg from the car park's coordinate to the station. Commit adfb337
      files: packages/core/src/planner.ts, planner.test.ts
      done when: a park-and-ride itinerary has drive, park, walk (source hopready), transit; the transit query carries the stopId; tests cover a car park beside the platform and 100 m from it
- [x] 5. Candidate selection by estimated total time: estimate every facility (rough drive plus hub table), ETA the best 20, check the best 5 exactly, one per station, always including the quickest drive and the preferred car park; report every facility with its station and estimate. Commit (see log)
      files: packages/core/src/planner.ts, packages/core/src/estimate.ts, model.ts (additive `stationName` and `estimatedMinutes` on checkedCarParks), planner.test.ts, planner-scenarios.test.ts
      done when: Kellyville (Wrights Rd) to Central with the real catalogue checks Seven Hills (planner test "tries Seven Hills from Kellyville"); call count per plan documented in step 9
- [x] 6. Preferences mark, never hide: no `walk-too-long` or `drive-too-long` rejections, and `transfer-too-short` only for a change that cannot be made at all; itineraries carry additive `concerns` (long-walk, long-drive, tight-change); from a car park, journeys within the preferences are preferred. Commits 3cdf8cb, 917ec52
      files: packages/core/src/planner.ts, model.ts, itinerary.ts, tests
      done when: Parramatta to Carrington St with an 8 minute walk limit returns the direct T1 trip marked long-walk
- [x] 7. Dominance only between car parks at the same station; every other option is listed. One car park per station is tried (the one surer of a space, then the nearer the platform); the other is reported not tried with its estimate. Commits adfb337, bcce311
      done when: Kellyville is listed next to Hills Showground in the Kellyville scenario (planner test "lists both, whatever the better one says about its spaces")
- [x] 8. Deploy to staging, re-run the real trips, record results in docs/research/park-and-ride.md (versions 726a62c4 and 6d48416d)
      done when: staging answers within 5 s and the Kellyville list includes Seven Hills with an exact time
- [x] 9. ADR-0007 (car park choice) and ADR-0008 (preferences), routing.md and providers.md rewritten, PROGRESS updated. Commit 5b688a8; research brief part 2 and the extended hub table follow in their own commits
- [x] 10. Results screen v2 in the app (short option rows, map card, details behind a tap, car parks and reasons in a sheet, no freshness banner, sort in the toolbar), one trip-options editor; the Plan tab stays as it is (see log). Commits d04bbd8, 223f05c, 9b3e5db; XCUITest 6 tests passed (1 skipped by design) on 2026-10-31 19:45, screenshots refreshed
      done when: 702 or more app tests pass, the XCUITest walk-through passes, screenshots refreshed
- [ ] 11. TestFlight build 5

## Open questions

- How many car parks can be checked exactly per plan within the TfNSW rate limit and a 5 s deadline? Blocks the candidate count in step 1.
- Does the Apple Maps ETA endpoint batch destinations in the current client? Blocks the screening design.

## Log

- 2026-10-31 Owner's screenshots: Parramatta to Carrington St returned "No trip options found" with "walks longer than your 8 min limit"; Kellyville to the city listed Kellyville as "not on the way" and never listed Seven Hills; a 7 minute walk from the Hills Showground car park to the platform looked wrong. Owner asked for a rethink of route and car park selection with research, and a simpler interface.
- 2026-10-31 Reproduced on staging (version fa3a7952): public transport only, 41 Hunter St to 50 Carrington St, Monday 08:27, walk limit 8: two itineraries (3 min walk, a one-stop bus, 4 min interchange, T1), two rejected as walk-too-long. TfNSW itself estimates 11 minutes for the 700 m walk to Parramatta Station, so the direct T1 trip always fails an 8 minute cap. Saturday 08:27 in the past: zero itineraries (walk-too-long 2, departs-in-past 2).
- 2026-10-31 Kellyville (Wrights Rd after Ardley Ave) to Central, Monday 08:00, on staging: 8 itineraries, 2.9 s. Checked car parks: Hills Showground, Cherrybrook, Kellyville (north), North Rocks used; Bella Vista, Kellyville (south), Seven Hills not tried; Tallawong not towards destination; Hornsby too far. 29 of the 40 facilities not mentioned at all.
- 2026-10-31 TfNSW probes (direct calls): `itOptionsActive=1&trITMOT=100&trITMOTvalue100=5` is honoured (walks fell to 5 min or less, though an 11 minute walk still came back when it was the only way to the station); `trITMOT=104` (car) errors; `useProxFootSearch=1&maxTime=5` changes nothing; a stop-id origin (TSN 2154392, Hills Showground) returns metro departures every 4 to 5 minutes with no walking leg.
- 2026-10-31 TfNSW car park records carry `tsn` (stop id), facility coordinates and `spots`: Kellyville north 351, south 964 (different coordinates; staging shows one coordinate for both), Hills Showground 584, Seven Hills 1613, North Rocks 139. 46 facilities listed, 5 "historical only", Kiama outside coverage, so 40 in HopReady.
- 2026-10-31 The walk from a car park to the platform in TfNSW's answer includes station access padding: 139 m shown as 4 min, 342 m as 7 min (Hills Showground, same facility, different times of day).
- 2026-10-31 Hub table recorded: 34 stations x 10 hubs x 3 periods, 1,020 TfNSW calls, none missing. Seven Hills to Central at peak: 33 min on board every 8; Hills Showground 39 every 4; Kellyville 47 every 4; North Rocks 50 every 3.
- 2026-10-31 Steps 2 to 5 and 7 landed (commits 6c5bbd4 to edbcdae). Core 242, API 330, app 702 tests pass; typecheck, lint and format clean. Surprises: the fake transit in planner.test.ts keyed journeys on car park names, which no longer reach the provider (journeys are asked for from the station), so the dominance tests were rewritten around twins at one station and separate stations; the demo world's Kellyville (south) is now "not tried" rather than "matched by another", since one car park per station is chosen before any journey is asked for.
- 2026-10-31 Step 6 on staging (version 6d48416d): Parramatta to Carrington St, public transport only, Monday 08:27, walk limit 8: four options, the direct T1 trips back and marked long-walk, nothing rejected. With driving: ten options led by driving the whole way (27 min, marked long-drive), North Rocks 52 and Ashfield 55.
- 2026-10-31 Research sweep finished (8 topics, each checked by three refuters; notes in the session scratchpad, written up in docs/research/park-and-ride.md part 2). What it changes: the hub table is accurate near its hubs and rough across the suburbs, so seven suburban hubs (Strathfield, Epping, Blacktown, Liverpool, Hurstville, Bondi Junction, Sydenham) are being recorded; the appraisal weights (walk 1.5, wait 1.4, bus against rail) are worth applying to the choice of the five, not to the times shown; no reference planner rejects on a walking limit, which confirms step 6.
- 2026-10-31 Step 9: ADR-0007 and ADR-0008 written, ADR-0001's candidate rule marked superseded, routing.md and providers.md rewritten (per plan with driving: up to 7 TfNSW and 8 to 13 Apple requests, measured 2026-10-31 in the demo world; Apple binds first at about 29,000 planned trips a month), owner item 20, store text and the support page now call the limits preferences.
- 2026-10-31 Ranking now weights waiting 1.4 and walking 1.5 when choosing the five (commit 763eb5b); the hub table has 17 hubs (seven suburban centres added, 1,734 pairs recorded, commit 7415140); Blacktown became a hub, so the estimate test that used it as a non-hub destination moved to Toongabbie. Staging version 63e4d5b4: the Kellyville list is unchanged (same five car parks, 3.3 s); Parramatta unchanged (0.8 s).
- 2026-10-31 Step 10, results screen: option rows cut to times, steps, one facts line, the car park's count and marks (commit d04bbd8); Sort by moved into a system sheet behind one button; the freshness banner became a caption next to Refresh; the car park disclosure became a sheet (/car-parks-considered) with station and estimate per car park. 708 app tests. Settings dedupe and the walk-through follow.
- 2026-10-31 Settings now opens the one Trip options sheet instead of a second editor with its own labels (commit 223f05c; 706 app tests after three duplicate-editor tests became one). The limit explanations say a longer walk or drive is shown with a note, not hidden. The Plan tab itself is left as it was: one control per decision (places, time, ways to travel, options, plan), and the owner's screenshots were of the results screen; recorded here so step 10's "Plan screen trimmed" is not read as done.
