# Plan: walk from a nearby car park, and no options days after the time asked for

Status: in progress
Branch: feat/hopready-v1

## Goal

A trip whose destination is a short walk from a car park offers drive, park, walk as that car park's option, and no option leaves days after the time asked for or shows a time without its day.

Verifiable by:

- 14 James Mileham Drive, Kellyville to 24 Anson St, Nirimba Fields, leaving at 8.27 pm on a Saturday: every option leaves that night; the Schofields option is drive, park, walk, with a note that parking without a public transport trip is not free.
- No public transport option in that plan rides a school bus on Monday.
- An option on a later day than the time asked for shows its day in the app.
- Kellyville to Central (Monday 8 am) and Parramatta to Carrington St (8 minute walking limit) still give the options recorded on 2026-10-31.

## Decided already

- Preferences mark options, they never hide them (ADR-0008). This plan applies that principle to the TfNSW request and to the choice of journey from each car park, which ADR-0008 did not.
- Car parks are ranked by estimated door-to-door time and the best five checked exactly (ADR-0007).

## Root cause (verified 2026-10-31, owner's screenshot at 8.23 pm)

1. HopReady sends the walking limit to TfNSW (`trITMOTvalue100`, commit 6c5bbd4). TfNSW treats it as a cap on each walk and searches days ahead for a journey that meets it. Saturday 8.27 pm from home: without the parameter, 8 journeys that night (first arrives 9.44 pm, final walk 18 min); with 15, only Monday afternoon journeys on school bus 6627 (final walk 7 min).
2. From Schofields Station, TfNSW answers a 16 minute walk arriving 9.07 pm (with or without the parameter at 15). The planner drops walk-only answers from a car park by design (planner.ts, planThroughPoint), so the Monday school bus chain was the only journey left.
3. The planner accepts any journey after the requested time, and per car park prefers a journey within the preferences however much later it arrives.
4. The app shows "2:32 pm" with no day.

## Out of scope

- A GTFS station matrix or any change to how car parks are ranked beyond the walk.
- Destination parking for drive-only (unchanged: "Parking at your destination is not included in this time").

## Steps

- [x] 1. API: stop sending the walking preference to TfNSW (commit 92124dc; the walking limit left the provider query entirely, and the demo world now walks a fixed 15 minute reach at normal pace, as TfNSW does)
      files: apps/api/src/providers/tfnsw/transit.ts, transit.test.ts
      done when: the request test asserts no `trITMOT` parameters; a staging plan of the Anson St trip has no Monday journeys
- [x] 2. Core: from each car park, the journey that arrives first (leaves last for arrive-by) is used; one within the preferences only wins when it arrives at most 10 minutes later
      files: packages/core/src/planner.ts, planner.test.ts
      done when: a test with a within-preferences journey hours later picks the earlier one, and one 5 minutes later picks the within-preferences one
- [x] 3. Core: walk the rest from a car park near the destination (drive, park, walk), compared with the public transport journeys from that car park; the estimate counts it; a note says parking without a public transport trip is not free
      files: packages/core/src/planner.ts, estimate.ts or planner helpers, planner.test.ts, planner-scenarios.test.ts
      done when: a car park 1 km from the destination with only a much later bus offers drive, park, walk with the fee note
- [x] 4. Core: depart-at options that leave more than 12 hours after the time asked for are rejected with their own reason; the app explains it
      files: packages/core/src/planner.ts, model.ts, apps/mobile/src/features/results/plan-explanations.ts, tests
      done when: a journey 42 hours later is rejected and counted; older apps drop the unknown reason (tested since build 3)
- [x] 5. App: times on a different day from the time asked for show the day ("Mon 2:32 pm")
      files: apps/mobile route card, trip summary, steps, followed trip card, alternatives; tests
      done when: a card for a next-day option shows the day, a same-day one does not
- [ ] 6. Deploy staging; re-run Anson St, Kellyville to Central and Parramatta; record in docs/research/park-and-ride.md and PROGRESS
- [ ] 7. ADR-0009 (supersedes ADR-0008 decisions 1 and 4), routing.md, providers.md
- [ ] 8. Adversarial review of the diff; fix what it confirms
- [ ] 9. TestFlight build 6

## Open questions

- Should school buses be left out by default? Researching (blocks nothing above; a default change would be its own step).
- Ceiling for walking the rest: 20 minutes or the walking limit, whichever is longer, until the probes say otherwise.

## Log

- 2026-10-31 20:27 Reproduced on staging (version 63e4d5b4) with walking limits 15 and 8: every option leaves Monday between 13:37 and 14:33 and ends on school bus 6627; drive-only arrives 20:44 Saturday.
- 2026-10-31 Direct TfNSW probes (scratchpad probes/): Schofields Station to Anson St, Saturday 20:51: none, walk 16 min; 15, Monday school buses plus the walk; 8, Monday only; 30, walk only. Home: none, 8 Saturday journeys; 15, 2 Monday journeys. Tallawong: none, 6 Saturday journeys; 15, Monday only; 15 without school buses, none.
- 2026-10-31 Steps 2 to 4 landed as 04a5dac (mutation-checked: removing the tolerance, the walk, the 12 hour limit, the fee note or the estimate change each fails a new test), step 5 as 6c5030e, step 1 as 92124dc. Core 258, API 329, app 714 tests pass.
- 2026-10-31 The vendor's EFA JSON training (EN 2.9, page 74) defines trITMOTvalue as "the maximum time from the starting point to the first stop and also from the destination stop to the destination point" (default 10), which is the cap behaviour seen, not a preference.
- 2026-10-31 20:52 Staging c6228927, Anson St trip at 20:52 Saturday, walking limit 15 and 8: drive 17 min; drive, park at Schofields, walk 15 min (arrive 21:30, fee note); Tallawong P1 bus 748 then an 18 min walk (21:57, marked long-walk); Kellyville, Bella Vista, Hills Showground and four public transport options, all Saturday night; nothing rejected. Kellyville to Central Monday 08:00 and Parramatta to Carrington St (limit 8) give the same options as on 2026-10-31 afternoon.
- 2026-10-31 Probe matrix (126 TfNSW calls; docs/research/park-and-ride.md 1.5): at the default limit of 15 the parameter made the best arrival later in 12 of 36 trip and time pairs and earlier in none; with it, "arrive by Sunday 10:00" returned Friday arrivals, so step 4 gained an arrive-by twin (`arrives-long-before-target`, commit 0ea23d1).
- 2026-10-31 Found, not fixed here: TfNSW returns On Demand D700 as product class 10, which the adapter drops as an unsupported mode. It hides options rather than adding wrong ones; logged in docs/PROGRESS.md known limitations.
- 2026-10-31 Investigation workflow (10 agents) finished. Design critic and code audit found, and the coordinator fixed (commits c3c99d4, a2cb15b, 3f67b0b, ea3fd29): walk estimate a quarter short of TfNSW's (now 1.5 times the straight line at 1.1 m/s); gate in the person's minutes (now 1.2 km straight line); paid walk beating a free bus (now a mark); a followed walking trip flipping to the bus on a check (the chosen car park now keeps both); twins hiding a car park beside the destination; drop-off wasting a slot on a station next to the destination; build 5 left with no explanation when the 12 hour limit removed everything (now an unavailable entry); no walk back to a car TfNSW had no journey to; checked times and trips days away without a day; fee note wrong at Gosford and Beverly Hills. School buses are now off by default, as on transportnsw.info (refuters confirmed both the default and that anyone with a ticket may ride). Recorded in ADR-0010. Deferred: a 3 hour cut of next-morning options when same-night ones exist; Dee Why opening hours; On Demand class 10.
