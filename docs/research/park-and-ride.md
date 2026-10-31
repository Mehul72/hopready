# Research: choosing car parks and routes

Written 2026-10-31 for the v2 routing work (docs/plans/routing-and-results-v2.md). Part 1 is evidence HopReady gathered itself by calling the providers. Part 2 is what the literature, the routing engines and the other apps say, with sources.

## 1. Evidence from the providers (verified by direct calls on 2026-10-31)

### 1.1 TfNSW Trip Planner API (`/v1/tp/trip`)

| Probe                                                                                                                                 | Result                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline: coordinate origin in Kellyville (Wrights Rd after Ardley Ave) to Central (stop 200060), Monday 08:00, `calcNumberOfTrips=4` | Four journeys: 8 min walk, bus 633 or 601 to Hills Showground, M1 to Central (68 to 69 min); or 12 min walk, bus 664 to Norwest, M1 (68 min)                                                                                                              |
| Same plus `itOptionsActive=1&trITMOT=100&trITMOTvalue100=5` (walk at most 5 min)                                                      | Walks fell to 5 min or less; TfNSW used the 626 bus from the doorstep instead. The parameter is not in the TfNSW swagger but the engine honours it                                                                                                        |
| Same plus `itOptionsActive=1&trITMOT=104&trITMOTvalue104=30` (car access)                                                             | Error `-303 origin: no it connection`. The deployment has no road network for car access, so park-and-ride cannot be asked for in one call                                                                                                                |
| Stop-id origin `type_origin=any&name_origin=2154392` (Hills Showground TSN) to Central                                                | Journeys are a single M1 leg from "Hills Showground Station, Platform 1", departures 4 to 5 minutes apart, no walking leg                                                                                                                                 |
| `useProxFootSearch=1&maxTime=5`                                                                                                       | No change from the baseline                                                                                                                                                                                                                               |
| 41 Hunter St, Parramatta to 50 Carrington St, Sydney, Saturday and Monday 08:27, with and without `trITMOTvalue100=8`                 | TfNSW estimates the 700 m walk to Parramatta Station at 11 minutes in every variant. With the cap of 8 it still returned those journeys but dropped a 15 minute walk to a bus. So the cap steers the search; it does not guarantee every walk is under it |

Walking legs in TfNSW's answers include station access padding: the same Hills Showground facility coordinate gave 139 m in 4 minutes and 342 m in 7 minutes at different times of day; Kellyville 105 m in 4 minutes; Gordon Henry St (south) 389 m in 6 minutes; Lindfield Village Green 50 m in 2 minutes.

### 1.2 TfNSW Car Park API (`/v1/carpark`)

- 46 facilities are listed; ids 1 to 5 are "historical only" and Kiama (7) is outside HopReady's coverage, which leaves the 40 HopReady uses.
- Each facility record carries `tsn` (the stop id of the station or bus stop it serves), its own `location` (latitude, longitude, address), `spots` (capacity) and `occupancy.total` (cars inside). Examples read on 2026-10-31 at about 6 pm: Kellyville (north) tsn 2155382, 351 spots, 28 inside; Kellyville (south) tsn 2155382, 964 spots, 271 inside, 400 m from the north car park; Hills Showground tsn 2154392, 584 spots, 316 inside; Seven Hills tsn 214710, 1613 spots, 231 inside; North Rocks tsn 2151161, 139 spots, 4 inside.
- HopReady's `/v1/carparks` currently returns one coordinate for both Kellyville car parks and `totalSpaces: null` for every facility, so neither the facility coordinates nor the capacities reach the planner today.

### 1.3 HopReady staging (planner version fa3a7952, 2026-10-28 22:05)

- Kellyville (Wrights Rd after Ardley Ave) to Central, Monday 08:00, drive and public transport, default preferences: 8 itineraries in 2.9 s. Hills Showground 60 min (drive 9, park 8, walk 4, M1 39), Cherrybrook 67, Kellyville (north) 68, four bus-plus-metro options 66 to 69, North Rocks via M2 bus 77. Car parks: 4 used; Bella Vista, Kellyville (south) and Seven Hills "not tried"; Tallawong "not towards destination"; Hornsby "too far to drive"; 29 of 40 not mentioned.
- The same trip at 21:15: public transport first (55 min, bus 626 from the doorstep), Hills Showground 59 min with a 7 minute walk from the car park.
- 41 Hunter St, Parramatta to 50 Carrington St, public transport only, Monday 08:27, walking limit 8: two itineraries (3 min walk, one stop on a bus, 4 min interchange, T1); two rejected as walk-too-long, which are the direct T1 trips with the 11 minute walk. For a Saturday time already in the past: nothing at all.

### 1.3a HopReady staging after the v2 planner (version 726a62c4, 2026-10-31 18:35)

- Kellyville (Wrights Rd after Ardley Ave) to Central, Monday 08:00: 9 itineraries in 3.3 s. Drive and park: Hills Showground 60 min (drive 9, walk 276 m), Cherrybrook 64 (drive 19), Seven Hills 66 (drive 22, T1), Bella Vista 68 (drive 8, walk 531 m), Kellyville (south) 68 (drive 10); four bus-and-metro options 66 to 69. Every facility within the driving limit is listed with an estimate: Hornsby too far (about 90), North Rocks not tried (about 79), Tallawong P1 to P3 (81 to 85), Schofields (84), Mount Druitt (89), Kellyville (north) not tried as the twin of (south) at the same station.
- Parramatta to Carrington St with the limit at 8, before step 6: every one of the five car parks tried (North Rocks, Ashfield, West Ryde, Gordon, Cherrybrook) ended "no workable connection" because each journey was rejected for a walk over 8 minutes or a change under the 3 minute buffer.
- After step 6 (version 6d48416d): public transport only, Monday 08:27, four options, including the direct T1 trips with their 632 m walk marked `long-walk`; nothing rejected. With driving allowed (Saturday evening): ten options, led by driving the whole way (27 min, marked `long-drive`), North Rocks 52 min and Ashfield 55 min; fifteen car parks listed with estimates.

### 1.4 What this settles

1. Park-and-ride stays composed by HopReady: a drive estimate plus a public transport query per car park (ADR-0001 holds).
2. The public transport query for a car park can start at its TSN. That removes the padded walking leg and makes the answer the platform's own departures. The walk from the car park to the platform becomes HopReady's own estimate from the facility's coordinate to the stop.
3. The walking limit can be passed to TfNSW as `trITMOTvalue100`, which improves the journeys it proposes, but HopReady must not discard what comes back; TfNSW already returns the most sensible journey even when it breaks the cap.
4. Capacity and live occupancy per facility are available and unused.

## 2. What others do, and what users choose

To be filled from the research brief (in progress).
