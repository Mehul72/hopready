# TfNSW schema samples

The `*.schema-sample.json` files here are **built by hand to the published schemas, not recorded**
from TfNSW. No API key was available when the adapter was written, so these samples stand in for real
responses in the unit tests.

## What they are based on

- Trip Planner Swagger, `tripplanner_v1_swag_efa11_20251002.yml` (Open Data Hub, October 2025).
- Car Park API documentation v2.4 (September 2026) and `carparkswagger_prod_2.yaml`.
- Real Trip Planner responses published as test assets in the KRAIL project (2024). They show fields
  the Swagger leaves out, such as `realtimeStatus`, `footPathInfo`, `interchange`, platform codes in
  `properties.platform`, platform and stand names inside `disassembledName`, and platform locations
  that have no `coord` of their own.
- The facility list shape (an object of facility ID to name) and numbers sent as JSON numbers in some
  car park responses, as documented by the KRAIL back end.
- Stop IDs, names and coordinates from the TfNSW GTFS timetable. Times, delays, statuses, alerts and
  occupancy counts are illustrative.

## Which sample covers what

| File                                 | Covers                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trip-tallawong-to-chatswood`        | Walk and metro legs, real time against scheduled, a `TRIP_CANCELLED` service, alerts with HTML, a taxi leg (product class 105) that is dropped                                                                               |
| `trip-kellyville-to-barangaroo`      | Arrive-by, a skipped intermediate stop, `DEPARTURE_CANCELLED` where the traveller boards, `NO_CALL_AT_STOP` where they get off                                                                                               |
| `trip-rouse-hill-to-north-sydney`    | Bus legs, a stand name against a bare stop, interchanges with and without a TfNSW walking time, On Demand (icon 23), alerts with missing parts                                                                               |
| `stop-finder-chatswood`              | Stop, platform and place results, results outside Greater Sydney, an unreadable result                                                                                                                                       |
| `carpark-list`, `carpark-facility-*` | The facility list with historical-only IDs, entrances from the feed, a missing location, a latitude missing its minus sign, an uncatalogued car park, a car park outside Greater Sydney, an over-full count, a missing count |

## Replacing them with recordings

1. Get an Open Data Hub API token: register at
   <https://opendata.transport.nsw.gov.au/data/user/register>, sign in, open the profile menu, choose
   API Tokens and create one. TfNSW shows the token only once.
2. From the repository root run
   `TFNSW_API_KEY=... npx tsx apps/api/scripts/record-tfnsw-samples.ts`.
   It saves real responses to `../__recordings__/` with a `manifest.json` of what was asked, and
   prints how the adapter reads each one, including whether `/v1/carpark/full-list` carries a
   location and `tsn` for every car park.
3. Run `pnpm --filter @hopready/api test`. `recordings.test.ts` parses every recording with the
   adapter and fails if TfNSW's real format differs from what the samples assume.
4. Where a recording shows a difference, update the matching sample here so the unit tests describe
   the real format, and keep the recordings for the parser tests.

Recordings contain data from Transport for NSW, licensed under CC BY 4.0.
