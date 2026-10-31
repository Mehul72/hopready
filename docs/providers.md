# Providers, limits and running costs

Facts below were read from official sources on 2026-10-25. Prices, quotas and terms change, so re-check before launch. [Sources](#sources) lists every page relied on.

## Providers in use

| Purpose                                  | Provider                                                                                         | Auth                                                             | Free allowance                                                                                                              | Hard limit behaviour                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public transport journeys, stops, alerts | TfNSW Open Data: Trip Planner `/v1/tp/trip` (alerts come with each leg) and `/v1/tp/stop_finder` | `Authorization: apikey <token>`                                  | Bronze plan: 60,000 requests per day, 5 per second. Free; increases on request at no fee.                                   | HTTP 403 with `X-Error-Detail: Account Over Rate Limit` or `Over Quota Limit` (401, 429 and 503 also reported) |
| Park&Ride occupancy and facilities       | TfNSW Car Park API `/v1/carpark`                                                                 | Same token                                                       | Shares the account plan                                                                                                     | Same as above                                                                                                  |
| Drive times and drive polylines          | Apple Maps Server API `/v1/etas`, `/v1/directions`                                               | ES256 JWT, exchanged at `/v1/token` for a 30-minute access token | 25,000 service calls per day per team, shared with MapKit JS                                                                | HTTP 429 until the next day; quota increases by request form, no paid tier published                           |
| Address and place search                 | Apple Maps Server API `/v1/searchAutocomplete`, `/v1/search`                                     | Same                                                             | Same pool                                                                                                                   | Same                                                                                                           |
| Map display                              | Apple Maps through react-native-maps                                                             | None                                                             | No published limit for native MapKit                                                                                        | n/a                                                                                                            |
| API hosting                              | Cloudflare Workers                                                                               | Account API token for deploys                                    | Free: 100,000 requests per day, 10 ms CPU per request. Paid: US$5/month including 10 million requests and 30 million CPU-ms | Free: Error 1027 past the daily request cap, Error 1102 past the CPU limit                                     |
| Builds                                   | EAS (Expo)                                                                                       | `EXPO_TOKEN`                                                     | Free: 15 iOS builds a month, low-priority queue                                                                             | Builds stop until the next month; local `eas build --local` avoids the quota                                   |
| Support and privacy pages, CI            | GitHub Pages and Actions                                                                         | Repository                                                       | Free for public repositories                                                                                                | n/a                                                                                                            |

TfNSW's `/departure_mon` (departure boards) and `/add_info` (all current alerts) are not used. Each `/v1/tp/trip` journey already carries real-time times and the alerts that affect its legs, and v1 has no departure board or network-wide alerts screen.

Station entrances and exits are not read either. The Trip Planner Swagger (`tripplanner_v1_swag_efa11_20251002.yml`, behind the Open Data Hub login) documents in-station steps in `footPathInfo[].footPathElem` (stairs, escalators, lifts and level changes) and turn-by-turn walking steps in `pathDescriptions` (with ENTER and LEAVE manoeuvres), but no field that names an entrance or exit. HopReady keeps only the walking time from `footPathInfo`, so the app says entrance and exit details are not provided (docs/design/routing.md). The trips recorded on 2026-10-28 (Tallawong P1 to Chatswood, Kellyville to Barangaroo) bear this out: their walking steps name the service boarded and mention escalators and levels, never an entrance or exit.

## Terms that shape the product

- **TfNSW data:**
  - Licensed under CC BY 4.0. Credit "Transport for NSW" in text, without the logo.
  - Commercial use and App Store distribution are allowed.
  - Keep keys on the server. TfNSW asks for this, and for one key per application.
  - No caching rule. The Hub Terms and the Acceptable Use Policy set none; they forbid excessive use. The API caches the car park list for 24 hours and each car park's occupancy for 60 seconds. The Car Park API documentation says occupancy updates every 15 seconds, on each counter change, or every 10 minutes, depending on the car park, so a cached figure is at most a minute behind the feed.
- **TfNSW occupancy:**
  - Counts are estimates. TfNSW recommends showing availability as `spots − total`, with a "~" and a note that it may differ from reality.
  - Feeds have frozen for days during outages, so the app shows each figure's age and flags it as stale after 15 minutes.
- **Apple Maps:**
  - Apple data may only be shown together with an Apple map, and Apple's logo and legal link must stay visible (DPLA Attachment 6 §2.1 and §2.4).
  - Results may only be cached temporarily (§2.5). Place IDs are exempt and may be stored. HopReady's server caches only the access token. The app, however, keeps Apple-sourced names and coordinates in saved places (Home, Work, favourites, parking spots), recent trips and the followed trip, until the person deletes them. Whether to store Place IDs instead is an open owner decision (docs/OWNER-ACTIONS.md, item 22).
  - Real-time routing apps must show the notice "YOUR USE OF THIS REAL TIME ROUTE GUIDANCE APPLICATION IS AT YOUR SOLE RISK. LOCATION DATA MAY NOT BE ACCURATE." (DPLA §3.3.3(F)(iii)). It appears in Settings.
- **Opal fares:** removed from the Trip Planner API on 16 October 2023. HopReady shows fares as unknown.

## Calls per action

The maxima below follow from the planner's limits (`packages/core/src/planner.ts`: 20 car parks sent for drive times, 5 asked for journeys, per strategy) with the real catalogue of 40 car parks. The measured figures come from running the planner against the demo providers with a counter on every provider method on 2026-10-31: Box Hill to Chatswood at 7.30 am on a Tuesday, with and without drop-off, and Rouse Hill to Barangaroo with drop-off. The demo world has 7 to 8 car parks, so fewer reach the exact check than the real catalogue allows.

| Action                                               | TfNSW calls                                                                                                                                                                                                                | Apple calls                                                                                                                                                                       | Worker requests |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Plan, public transport only                          | 1                                                                                                                                                                                                                          | 0                                                                                                                                                                                 | 1               |
| Plan, with "I'll drive and park"                     | up to 7: 1 public transport journey, up to 5 journeys from car park stations, and 1 occupancy request for every car park at once (`/v1/carpark/full-list`, cached 60 s). The car park list comes from the same call daily. | 8 to 13: 2 drive time estimate requests (20 car parks, 10 a request), up to 5 routes to car parks, 1 drive-only route, and up to 5 more routes when traffic moves a start earlier | 1               |
| Plan, with drop-off as well                          | up to 12 (up to 5 more journeys, from drop-off stations)                                                                                                                                                                   | 15 to 25 (2 more estimate requests, up to 5 more routes, up to 5 more re-routes)                                                                                                  | 1               |
| Take me home through the car                         | 1                                                                                                                                                                                                                          | up to 2                                                                                                                                                                           | 1               |
| Place search (each debounced query of 3+ characters) | 1                                                                                                                                                                                                                          | 1 autocomplete, plus up to 5 lookups for suggestions without coordinates                                                                                                          | 1               |
| Refresh of results, or of a followed trip            | the same as the plan it repeats (occupancy may come from the 60 s cache)                                                                                                                                                   | the same as the plan it repeats                                                                                                                                                   | 1               |

Measured on 2026-10-31 in the demo world: drive and park made 3 journeys from car parks, 1 occupancy request, 1 estimate call and 3 routes; with drop-off as well, 5 to 9 journeys, 1 occupancy request, 2 estimate calls and 5 to 9 routes. On staging with the real catalogue (Kellyville to Central, 2026-10-31), a plan with driving answered in 3.3 s and listed 13 car parks. The extra routes when traffic moves a start are the most the code can make, not a measured figure.

A plan with driving sends up to 7 TfNSW requests at once, more than TfNSW's 5 per second. The API's rate gate (`apps/api/src/providers/tfnsw/rate-gate.ts`) queues the excess for up to 3 seconds, so it shows as well under a second of extra wait, not a refusal. The gate only covers one Worker isolate, so busy periods can still exceed 5 per second across isolates.

## Monthly cost at three volumes

Assumptions, stated so they can be checked against real use:

- A "planned trip" is 3 place searches, 1 plan with driving, and 1 refresh of that plan (pull to refresh, or reopening the app while following the trip).
- Each search makes 1 Apple autocomplete and, on average, 1 lookup.
- A plan with driving makes about 10 Apple calls (8 to 13) and 7 TfNSW calls.
- That makes about 17 TfNSW calls (3 + 7 + 7), about 26 Apple calls (6 + 10 + 10) and 5 Worker requests per planned trip.
- Traffic is spread evenly over 30 days. Real traffic peaks in the morning and evening, so the per-second limits bind before the daily ones.

| Planned trips per month | TfNSW calls per day | Apple calls per day | Within free limits?                                | Hosting cost                                                    |
| ----------------------- | ------------------- | ------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 1,000                   | ~570                | ~870                | Yes                                                | US$0 on Workers Free, or US$5 on Paid                           |
| 10,000                  | ~5,700              | ~8,700              | Yes                                                | US$5 (Paid is recommended because of the 10 ms CPU cap on Free) |
| 100,000                 | ~57,000             | ~87,000             | No: Apple over 25,000 a day; TfNSW close to 60,000 | US$5                                                            |

What this means:

- Apple is the first limit to bind, at roughly 29,000 planned trips a month (25,000 calls a day at 26 per trip). Before that point:
  - ask Apple for a quota increase (no published price);
  - reduce search calls, for example resolving only the chosen suggestion;
  - or add HERE as a second driving provider (US$2.92 per 1,000 time-aware routes after 5,000 free a month).
- TfNSW's daily quota binds at roughly 105,000 planned trips a month, and its 5 requests per second can bind at busy peaks well before that. Ask TfNSW for a free increase before launch.
- Fixed costs:
  - Apple Developer Program, which the owner already pays for.
  - A domain for the API, recommended before release; registry price depends on the name.
  - Workers Paid at US$5/month, recommended.
- HopReady does not promise free unlimited operation. The API enforces daily budgets (`TFNSW_DAILY_CALL_BUDGET`, `APPLE_MAPS_DAILY_CALL_BUDGET`) so a burst of traffic degrades to "temporarily unavailable" instead of exceeding a provider's limits.

## Sources

Read on 2026-10-25 unless marked otherwise. Re-check prices, quotas and terms before launch.

Transport for NSW:

- Trip Planner APIs: https://opendata.transport.nsw.gov.au/data/dataset/trip-planner-apis
- Car Park API, and its documentation (v2.4, update frequency per car park): https://opendata.transport.nsw.gov.au/data/dataset/car-park-api
- API basics (authentication, rate limit errors): https://opendata.transport.nsw.gov.au/developers/api-basics
- Data licence (CC BY 4.0): https://opendata.transport.nsw.gov.au/datalicence
- Open Data Hub Terms: https://opendata.transport.nsw.gov.au/sites/default/files/2024-09/TfNSW-Open-Data-Portal-Terms.pdf
- Acceptable Use Policy: https://opendata.transport.nsw.gov.au/sites/default/files/2024-09/TfNSW-Acceptable-Use-Policy.pdf
- Open Data forum (quota increases, outages): https://opendataforum.transport.nsw.gov.au

Apple:

- Maps Server API tokens and keys: https://developer.apple.com/documentation/applemapsserverapi/creating-and-using-tokens-with-maps-server-api and https://developer.apple.com/documentation/applemapsserverapi/creating-a-maps-identifier-and-a-private-key
- Estimated times of arrival: https://developer.apple.com/documentation/applemapsserverapi/-v1-etas
- Daily usage and the quota increase request form: https://developer.apple.com/account/resources/services/maps-usage and https://developer.apple.com/contact/request/mapkitjs/
- Place IDs (the storage exemption): https://developer.apple.com/documentation/mapkit/identifying-unique-locations-with-place-ids
- Apple Developer Program License Agreement, including Attachment 6 (Apple Maps Service): https://developer.apple.com/support/terms/apple-developer-program-license-agreement/

Alternatives considered (docs/decisions/0002):

- HERE pricing and Routing v8: https://www.here.com/get-started/pricing and https://docs.here.com/routing/docs/routing-v8-get-started
- Google Maps Platform pricing and service terms: https://developers.google.com/maps/billing-and-pricing/pricing and https://cloud.google.com/maps-platform/terms/maps-service-terms

Hosting, builds and pages:

- Cloudflare Workers pricing and limits (Errors 1027 and 1102): https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/workers/platform/limits/
- Expo plans and EAS Build: https://expo.dev/pricing and https://docs.expo.dev/build/setup/
- GitHub Pages publishing sources and limits: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site and https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
