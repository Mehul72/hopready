# Providers, limits and running costs

Facts below were read from official sources on 2026-10-25. Prices, quotas and terms change, so re-check before launch. The research notes and the links behind each figure are summarised in the decision records (`docs/decisions/`).

## Providers in use

| Purpose                                  | Provider                                                                                   | Auth                                                             | Free allowance                                                                                                              | Hard limit behaviour                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public transport journeys, stops, alerts | TfNSW Open Data: Trip Planner `/v1/tp/trip`, `/stop_finder`, `/departure_mon`, `/add_info` | `Authorization: apikey <token>`                                  | Bronze plan: 60,000 requests per day, 5 per second. Free; increases on request at no fee.                                   | HTTP 403 with `X-Error-Detail: Account Over Rate Limit` or `Over Quota Limit` (401, 429 and 503 also reported) |
| Park&Ride occupancy and facilities       | TfNSW Car Park API `/v1/carpark`                                                           | Same token                                                       | Shares the account plan                                                                                                     | Same as above                                                                                                  |
| Drive times and drive polylines          | Apple Maps Server API `/v1/etas`, `/v1/directions`                                         | ES256 JWT, exchanged at `/v1/token` for a 30-minute access token | 25,000 service calls per day per team, shared with MapKit JS                                                                | HTTP 429 until the next day; quota increases by request form, no paid tier published                           |
| Address and place search                 | Apple Maps Server API `/v1/searchAutocomplete`, `/v1/search`                               | Same                                                             | Same pool                                                                                                                   | Same                                                                                                           |
| Map display                              | Apple Maps through react-native-maps                                                       | None                                                             | No published limit for native MapKit                                                                                        | n/a                                                                                                            |
| API hosting                              | Cloudflare Workers                                                                         | Account API token for deploys                                    | Free: 100,000 requests per day, 10 ms CPU per request. Paid: US$5/month including 10 million requests and 30 million CPU-ms | Free: Error 1027 past the daily request cap, Error 1102 past the CPU limit                                     |
| Builds                                   | EAS (Expo)                                                                                 | `EXPO_TOKEN`                                                     | Free: 15 iOS builds a month, low-priority queue                                                                             | Builds stop until the next month; local `eas build --local` avoids the quota                                   |
| Support and privacy pages, CI            | GitHub Pages and Actions                                                                   | Repository                                                       | Free for public repositories                                                                                                | n/a                                                                                                            |

## Terms that shape the product

- **TfNSW data:**
  - Licensed under CC BY 4.0. Credit "Transport for NSW" in text, without the logo.
  - Commercial use and App Store distribution are allowed.
  - Keep keys on the server. TfNSW asks for this, and for one key per application.
- **TfNSW occupancy:**
  - Counts are estimates. TfNSW recommends showing availability as `spots − total`, with a "~" and a note that it may differ from reality.
  - Feeds have frozen for days during outages, so the app shows each figure's age and flags it as stale after 15 minutes.
- **Apple Maps:**
  - Apple data may only be shown together with an Apple map, and Apple's logo and legal link must stay visible (DPLA Attachment 6 §2.1 and §2.4).
  - Results may only be cached temporarily (§2.5). Place IDs are exempt and may be stored. HopReady's server caches only the access token. The app, however, keeps Apple-sourced names and coordinates in saved places (Home, Work, favourites, parking spots), recent trips and the followed trip, until the person deletes them. Whether to store Place IDs instead is an open owner decision (docs/OWNER-ACTIONS.md, item 22).
  - Real-time routing apps must show the notice "YOUR USE OF THIS REAL TIME ROUTE GUIDANCE APPLICATION IS AT YOUR SOLE RISK. LOCATION DATA MAY NOT BE ACCURATE." (DPLA §3.3.3(F)(iii)). It appears in Settings.
- **Opal fares:** removed from the Trip Planner API on 16 October 2023. HopReady shows fares as unknown.

## Calls per action (design figures from `planner.ts` and the API)

| Action                                               | TfNSW calls                                                                                      | Apple calls                                                              | Worker requests |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------- |
| Plan, public transport only                          | 1                                                                                                | 0                                                                        | 1               |
| Plan, with "I'll drive and park"                     | 4 (1 transit-only plus up to 3 from car parks); car park list cached 24 h, occupancy cached 60 s | up to 1 ETA + 3 routes + 1 drive-only = 5                                | 1               |
| Plan, with drop-off as well                          | up to 7                                                                                          | up to 8                                                                  | 1               |
| Take me home through the car                         | 1                                                                                                | up to 2                                                                  | 1               |
| Place search (each debounced query of 3+ characters) | 1                                                                                                | 1 autocomplete, plus up to 5 lookups for suggestions without coordinates | 1               |

## Monthly cost at three volumes

Assumptions:

- A "planned trip" is 1 plan with driving enabled plus 3 search queries.
- That makes about 7 TfNSW calls, about 11 Apple calls and about 5 Worker requests per planned trip.
- Traffic is spread over 30 days.

| Planned trips per month | TfNSW calls per day | Apple calls per day | Within free limits?                            | Hosting cost                                                    |
| ----------------------- | ------------------- | ------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 1,000                   | ~230                | ~370                | Yes                                            | US$0 on Workers Free, or US$5 on Paid                           |
| 10,000                  | ~2,300              | ~3,700              | Yes                                            | US$5 (Paid is recommended because of the 10 ms CPU cap on Free) |
| 100,000                 | ~23,000             | ~37,000             | TfNSW yes. Apple no: over the 25,000/day limit | US$5                                                            |

What this means:

- Apple is the first limit to bind, at roughly 65,000 to 70,000 planned trips a month. Before that point:
  - ask Apple for a quota increase (no published price);
  - reduce search calls, for example resolving only the chosen suggestion;
  - or add HERE as a second driving provider (US$2.92 per 1,000 time-aware routes after 5,000 free a month).
- TfNSW's 5 requests per second can bind at busy peaks before the daily quota does. Ask TfNSW for a free increase before launch.
- Fixed costs:
  - Apple Developer Program, which the owner already pays for.
  - A domain for the API, recommended before release; registry price depends on the name.
  - Workers Paid at US$5/month, recommended.
- HopReady does not promise free unlimited operation. The API enforces daily budgets (`TFNSW_DAILY_CALL_BUDGET`, `APPLE_MAPS_DAILY_CALL_BUDGET`) so a burst of traffic degrades to "temporarily unavailable" instead of exceeding a provider's limits.
