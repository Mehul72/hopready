# ADR-0002: Use Apple Maps for drive legs, the in-app map and address search

## Status

Accepted

## Date

2026-10-25

## Context

HopReady needs time-dependent drive times (depart-at and arrive-by), a drive polyline, an in-app map, and address and place search.

Constraints:

- An iPhone-only first release, by an owner who already has a paid Apple Developer membership.
- Avoid new accounts and new billing where possible. The brief also asks not to enable paid plans without approval.
- Provider terms decide which data may appear on which map. Google's Maps Platform Terms §3.2.3(e) and Service Specific Terms §19.2 (read 2026-10-25) forbid using Routes API content with a non-Google map.
- react-native-maps on its default iOS provider (Apple Maps) needs no key. It draws dashed walking lines and fits the camera to a route; expo-maps cannot do either.

## Decision

- Drive legs come from Apple Maps Server API, called only from the backend.
  - `/v1/etas` ranks up to 10 car parks per call.
  - `/v1/directions` takes `departureDate` or `arrivalDate` and returns a traffic-inclusive duration and a polyline.
- The in-app map is react-native-maps on Apple Maps.
- Address and place search comes from Apple Maps Server API. Stop and station search comes from TfNSW `stop_finder`.

## Alternatives considered

### Google Routes API and Google Places

- Pros: well known, with a time-dependent traffic model.
- Cons:
  - Its terms forbid showing it on Apple Maps, so the app would need the Google Maps SDK.
  - It ignores `arrivalTime` for driving, so arrive-by needs repeated billable calls.
  - It needs a billing account. Pro SKUs cost US$10 per 1,000 after 5,000 free a month (price list updated 2026-10-23).
- Rejected: terms, cost and a weaker arrive-by.

### HERE Routing v8

- Pros: native car `arrivalTime`, NSW live traffic, and terms that allow showing results on a third-party map with attribution.
- Cons: needs a paid Base plan with a payment method. Time-aware routing costs US$2.92 per 1,000 after 5,000 free a month.
- Not chosen. This was the close alternative and remains the fallback if Apple's quota, accuracy or terms become a problem.

### On-device MapKit (MKDirections)

- Pros: free, and no backend key.
- Cons: throttled per device with no published limits. Planning would split between phone and server, so the backend could not bound calls or test drive logic.
- Rejected.

### Mapbox

- Rejected. Arrive-by has no live traffic, results may not be stored, and Search Box does not cover Australia.

## Consequences

### Positive

- No new account or billing: Apple gives 25,000 service calls a day per team, shared with MapKit JS.
- Native arrive-by, so the planner asks for "arrive at the car park by T" directly.
- One map, with no terms conflict.

### Negative

- Apple Map Data may only be shown with an Apple map (DPLA Attachment 6 §2.4). Screens that show drive times or Apple search results must also show a map. Results, itinerary and place search all do.
- No paid overage tier exists. Past 25,000 calls a day, Apple returns HTTP 429 until the next day, and the app shows "drive time unavailable" instead of estimating. The API enforces a daily budget below Apple's limit.
- Apple results may not be cached beyond temporary use. Only the access token is cached.
- Apple does not document drive time accuracy for Sydney. Compare it against a second provider before launch.
- Apple requires the notice "YOUR USE OF THIS REAL TIME ROUTE GUIDANCE APPLICATION IS AT YOUR SOLE RISK. LOCATION DATA MAY NOT BE ACCURATE." in the app's terms. Settings shows it.

## Revisit if

- Daily volume approaches the Apple quota and a quota increase is refused.
- Measured Sydney peak drive times are consistently worse than HERE's.
- An Android or web client is planned (Apple Map Data would constrain it).

## Correction (2026-10-26)

"Only the access token is cached" holds for the API. The app stores Apple-sourced place names and coordinates in saved places, recent trips and the followed trip until the person deletes them. That conflicts with a strict reading of §2.5 and is an open owner decision (docs/OWNER-ACTIONS.md, item 22). The decision recorded above is unchanged.
