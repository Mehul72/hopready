# Plan: car park choice, route choice and a simpler results screen (v2)

Status: in progress (research and design)
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

Filled in once the research brief and the code map are in (see Log). Until then:

- [ ] 0. Research brief in docs/research/park-and-ride.md with sources; code map read
      done when: the brief exists, every design-relevant fact is marked verified, inferred or unknown
- [ ] 1. Design: ADRs for the new car park strategy and for preferences as ranking, plus the results screen design note
      done when: the ADRs are in docs/decisions and the plan steps below are concrete

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
