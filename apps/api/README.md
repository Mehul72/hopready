# HopReady API

The backend for the HopReady iPhone app. It holds the provider keys, calls Transport for NSW and
the Apple Maps Server API, and runs the trip planner from `@hopready/core`. There are no user
accounts and nothing about a person is stored.

One Hono app (`src/app.ts`) runs in two places:

- **Cloudflare Workers** (`src/worker.ts`), for staging and production.
- **Node** (`src/node-server.ts`), for local development.

## Run it locally

1. Copy the settings file and fill in the keys you have. Missing provider keys are fine: those
   providers report `missing` and their endpoints answer 503.

   ```sh
   cp apps/api/.dev.vars.example apps/api/.dev.vars
   ```

2. Start the Node server from the repository root:

   ```sh
   pnpm api:dev
   curl http://127.0.0.1:8787/v1/health
   ```

   It reads `apps/api/.dev.vars`, keeps rate limits and daily budgets in memory, and listens on
   `127.0.0.1:8787`. Set `HOST=0.0.0.0` to reach it from a phone on the same network.

3. Or run it in the local Workers runtime, with the Rate Limiting bindings and the
   `ProviderBudget` Durable Object:

   ```sh
   cd apps/api && npx wrangler dev
   ```

Set `HOPREADY_MODE=demo` to serve the labelled demo fixtures instead of calling providers. Every
response then says `"mode": "demo"`. Live mode never falls back to fixtures.

Checks for this package:

```sh
pnpm --filter @hopready/api typecheck
pnpm --filter @hopready/api lint
pnpm --filter @hopready/api test
```

## Settings

All settings are optional. A blank value counts as not set. A value that is present but malformed
(for example `PLAN_DEADLINE_MS=soon`) stops the server: Node exits, and the Worker answers every
request with a 500 and logs which setting is wrong, never its value.

| Name                           | Default     | What it does                                                                    |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------- |
| `HOPREADY_MODE`                | `live`      | `live` calls real providers. `demo` serves labelled fixtures.                   |
| `TFNSW_API_KEY`                | not set     | Secret. Public transport, stop search and car parks.                            |
| `APPLE_MAPS_TEAM_ID`           | not set     | Secret. With the next two, enables drive times and address search.              |
| `APPLE_MAPS_KEY_ID`            | not set     | Secret. Key ID of the Apple Maps private key.                                   |
| `APPLE_MAPS_PRIVATE_KEY`       | not set     | Secret. The `.p8` contents. One line with `\n` between lines also works.        |
| `LOG_LEVEL`                    | `info`      | `debug`, `info`, `warn` or `error`.                                             |
| `TFNSW_DAILY_CALL_BUDGET`      | `50000`     | Most TfNSW requests per UTC day. TfNSW's default quota is 60,000 a day per key. |
| `APPLE_MAPS_DAILY_CALL_BUDGET` | `20000`     | Most Apple requests per UTC day. Apple allows 25,000 a day per team.            |
| `PLAN_DEADLINE_MS`             | `20000`     | Longest a trip plan may take before a 504. 1,000 to 60,000.                     |
| `PORT`                         | `8787`      | Node server only.                                                               |
| `HOST`                         | `127.0.0.1` | Node server only.                                                               |

Apple's 25,000 calls are shared with any MapKit JS use on the same team.

## Endpoints

Every response carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and an
`X-Request-Id` that matches the `requestId` in logs and error bodies. There are no CORS headers:
the only client is the native app.

The app sends `X-HopReady-Install: <random version 4 UUID>` with every request. It is used only as
a rate limit key. A request without it is limited by its address instead. A value that is not a
version 4 UUID gets a 400.

The request and response shapes are the zod schemas in `packages/core/src/model.ts`.

### `GET /v1/health`

Reports set-up only. It makes no provider calls, so uptime checks cost no quota.

```json
{
  "status": "ok",
  "service": "hopready-api",
  "version": "0.1.0",
  "mode": "live",
  "providers": {
    "transit": "configured",
    "driving": "missing",
    "carParks": "configured",
    "places": "configured"
  }
}
```

`places` is `configured` when at least one place provider is: TfNSW stop search, Apple address
search, or both.

### `POST /v1/plan`

Body: a `PlanRequest`, at most 32 KB.

```json
{
  "origin": {
    "name": "1 Example St, Parramatta",
    "coordinate": { "lat": -33.815, "lon": 151.0011 },
    "kind": "address"
  },
  "destination": {
    "name": "Wynyard Station",
    "coordinate": { "lat": -33.8659, "lon": 151.2058 },
    "kind": "stop",
    "stopId": "200060"
  },
  "time": { "type": "depart", "at": "2026-10-26T20:30:00.000Z" },
  "access": { "transit": true, "drive": true, "dropOff": false },
  "preferences": {
    "maxDriveMinutes": 30,
    "maxWalkMinutes": 15,
    "parkingBufferMinutes": 8,
    "dropOffBufferMinutes": 2,
    "transferBufferMinutes": 3,
    "carRetrievalBufferMinutes": 5,
    "walkingSpeed": "normal",
    "excludedTransitModes": []
  },
  "trip": { "kind": "outbound" }
}
```

Answer: a `PlanResponse`. This one is shortened to its first transit leg; an itinerary has every
leg from door to door and more summary fields (see `itinerarySchema`).

```json
{
  "mode": "live",
  "generatedAt": "2026-10-26T20:30:00.000Z",
  "itineraries": [
    {
      "id": "d9b636a4",
      "strategy": "transit-only",
      "departAt": "2026-10-26T20:32:00.000Z",
      "arriveAt": "2026-10-26T21:20:00.000Z",
      "legs": [
        {
          "id": "train-2026-10-26T20:40:00.000Z",
          "kind": "transit",
          "from": {
            "name": "Parramatta Station",
            "coordinate": { "lat": -33.8172, "lon": 151.005 },
            "kind": "stop",
            "stopId": "215020"
          },
          "to": {
            "name": "Wynyard Station",
            "coordinate": { "lat": -33.8659, "lon": 151.2058 },
            "kind": "stop",
            "stopId": "200060"
          },
          "start": "2026-10-26T20:40:00.000Z",
          "end": "2026-10-26T21:15:00.000Z",
          "source": "tfnsw-trip-planner",
          "timing": "scheduled",
          "mode": "train",
          "service": { "name": "T1", "description": null, "headsign": null, "operator": null },
          "scheduledStart": "2026-10-26T20:40:00.000Z",
          "scheduledEnd": "2026-10-26T21:15:00.000Z",
          "departurePlatform": null,
          "arrivalPlatform": null,
          "stopCount": null,
          "cancelled": false,
          "alerts": [],
          "realtimeTripId": null
        }
      ],
      "fare": { "status": "unknown" },
      "realtime": "none"
    }
  ],
  "rejected": [],
  "checkedCarParks": [],
  "unavailable": [{ "strategy": "drive-only", "reason": "Drive times took too long to respond." }],
  "notices": []
}
```

- The origin, the destination and, for `return-via-car`, the parked car must be inside Greater
  Sydney (`GREATER_SYDNEY_BOUNDS` in core), or the answer is 422 `outside-coverage`.
- Without a transit provider the answer is 503 `not-configured`.
- Planning stops at `PLAN_DEADLINE_MS`. Provider calls still running are aborted shortly before
  that (1 second before with the default deadline), so options that are already planned still
  come back, with the rest listed in `unavailable`. If nothing can be returned by the deadline,
  even from a provider that ignores the abort, the answer is 504 `deadline-exceeded`.

### `POST /v1/places/search`

A POST so search text and coordinates never appear in URLs or edge logs. Body at most 4 KB:

```json
{ "query": "Wynyard", "near": { "lat": -33.8688, "lon": 151.2093 } }
```

`query` is trimmed and must then be 2 to 80 characters with no control characters. `near` is
optional.

Every configured place provider is asked at once, with 5 seconds each. Results are merged with
TfNSW stops first, then Apple places. A suggestion with the same name as an earlier one (ignoring
case, accents and punctuation) within 150 m is dropped, places outside Greater Sydney are left out,
and at most 10 come back.

```json
{
  "mode": "live",
  "results": [
    {
      "place": {
        "name": "Wynyard Station",
        "coordinate": { "lat": -33.8659, "lon": 151.2058 },
        "kind": "stop",
        "stopId": "200060"
      },
      "detail": null
    }
  ],
  "unavailable": ["apple-maps"]
}
```

`unavailable` names the providers that failed. If some failed the answer is still 200. If all of
them failed it is 503 (`provider-busy` when all were out of quota, with `Retry-After` when known,
or `not-configured`), otherwise 502 `provider-unavailable`.

### `GET /v1/carparks`

The Park&Ride facilities from the TfNSW Car Park API with their current occupancy, for the app's
"which car park did you use?" picker. Each isolate caches the list for 60 seconds.

```json
{
  "mode": "live",
  "fetchedAt": "2026-10-26T20:30:00.000Z",
  "carParks": [
    {
      "id": "26",
      "name": "Tallawong P1",
      "coordinate": { "lat": -33.693, "lon": 150.9053 },
      "kind": "transport-park-and-ride",
      "stationName": "Tallawong Station",
      "totalSpaces": 121,
      "rules": {
        "status": "documented",
        "summary": "...",
        "sourceUrl": "...",
        "checkedOn": "2026-10-25"
      },
      "station": {
        "name": "Tallawong Station",
        "coordinate": { "lat": -33.6916, "lon": 150.906 },
        "kind": "stop",
        "stopId": "2155384"
      },
      "occupancy": {
        "status": "known",
        "spacesAvailable": 42,
        "totalSpaces": 121,
        "observedAt": "2026-10-26T20:29:00.000Z"
      }
    }
  ],
  "notices": []
}
```

Counts older than 15 minutes when served come back as `"status": "stale"`. If the counts cannot be
fetched, every facility says `"status": "unknown"`, `notices` explains, and that answer is not
cached. Without a car park provider the answer is 503 `not-configured`.

## Errors

Every error has the same body:

```json
{
  "error": {
    "code": "provider-busy",
    "message": "Travel information services are busy right now. Try again later.",
    "retryable": true,
    "requestId": "5c0a9e1e-8a4b-4b8f-9d0e-3f2c1b7a6d54"
  }
}
```

The app should switch on `code`. Messages are for people and may change.

| Status | Code                    | Retryable | When                                                             |
| ------ | ----------------------- | --------- | ---------------------------------------------------------------- |
| 400    | `invalid-json`          | no        | The body is missing or is not JSON.                              |
| 400    | `invalid-request`       | no        | A field is missing or invalid; the message names the field path. |
| 404    | `not-found`             | no        | Unknown route.                                                   |
| 405    | `method-not-allowed`    | no        | Known route, wrong method. `Allow` lists the right ones.         |
| 413    | `payload-too-large`     | no        | Body over the endpoint's limit.                                  |
| 422    | `outside-coverage`      | no        | A place is outside Greater Sydney.                               |
| 422    | `provider-rejected`     | no        | A provider refused the request as invalid.                       |
| 429    | `too-many-requests`     | yes       | Rate limited. Wait for `Retry-After` seconds.                    |
| 500    | `internal-error`        | yes       | Unexpected fault, or invalid server settings. Logged in detail.  |
| 502    | `provider-unavailable`  | yes       | A provider failed or could not be reached.                       |
| 502    | `provider-bad-response` | no        | A provider answered in a shape HopReady could not read.          |
| 503    | `not-configured`        | no        | The provider this needs is not set up, or its key was refused.   |
| 503    | `provider-busy`         | yes       | A provider quota or HopReady's daily budget is used up.          |
| 504    | `provider-timeout`      | yes       | A provider took too long.                                        |
| 504    | `deadline-exceeded`     | yes       | The whole plan took longer than `PLAN_DEADLINE_MS`.              |

`Retry-After` is sent with 429, and with 503 `provider-busy` when the provider or the budget says
when it frees up.

## Rate limits and daily budgets

| Limit                    | Per                                | Allowed      |
| ------------------------ | ---------------------------------- | ------------ |
| `POST /v1/plan`          | install ID, or address without one | 20 a minute  |
| `POST /v1/places/search` | install ID, or address without one | 60 a minute  |
| `GET /v1/carparks`       | install ID, or address without one | 30 a minute  |
| Every request            | address                            | 120 a minute |

An address is an IPv4 address or an IPv6 /64. On Workers the limits use the Rate Limiting binding,
which counts per Cloudflare location and approximately, and answers `Retry-After: 60`. On Node a
sliding window in memory gives exact counts and exact `Retry-After` values. If the limiter itself
fails, requests go through and an error is logged: the limits protect quota, not data, and the
daily budgets still cap provider use.

Daily budgets cap the HTTP requests sent to each provider account: TfNSW (trip planner, stop
search, car parks) and Apple Maps (drive times, place search). Every request an adapter sends is
counted, including retries, Apple's token exchange and the TfNSW car park adapter's one request per
facility. Budget days follow UTC dates, because neither provider documents when its quota resets.
Each provider call checks its budget before it starts; once the budget is spent, calls fail fast
and the API answers 503 `provider-busy` with `Retry-After` set to the next UTC midnight. A call
that has started may finish its requests, so the count can pass the budget by what one call sends
(up to about 40 requests when the TfNSW facility list is refreshed).

On Workers the count is shared through the `ProviderBudget` Durable Object (SQLite storage, placed
in Oceania). Each isolate checks its in-memory count, learns the shared total on its first check
of the day, and reports its requests after each response. Isolates can overshoot by the requests
they send between reports. On Node the process count is the whole count.

## Logging and privacy

- Logs are JSON: one `request finished` line per request with `requestId`, `method`, route
  template, `status`, `durationMs` and `mode` (at `warn` for a 5xx), plus one line per failed
  provider call with `provider`, `operation`, `failure` and `providerStatus`. Successful provider
  calls are logged at `debug`.
- Only allowlisted fields are written (`LogFields` in `src/logger.ts`). Request bodies, search
  text, coordinates, place names, addresses, keys, tokens and install IDs never are.
- Error messages are not logged, because messages from `fetch`, parsers and adapters can quote URLs
  or response bodies. Unexpected errors are logged by name and stack frames.
- Routes are logged as templates. An unknown path is logged as `unmatched`, never as sent.
- Workers invocation logs are off in `wrangler.jsonc`, because they record request URLs.
- TfNSW adapter diagnostics (journeys, stops or car parks left out of a response) are logged as
  `tfnsw data left out`, at `warn` when they point at unreadable or stale data.

## Deploy

Deploys go to Cloudflare Workers with Wrangler. Log in once, or set `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in CI.

```sh
cd apps/api
npx wrangler login
```

Set the provider secrets for each environment. Each command prompts for the value; a key file can
be piped in instead:

```sh
npx wrangler secret put TFNSW_API_KEY
npx wrangler secret put APPLE_MAPS_TEAM_ID
npx wrangler secret put APPLE_MAPS_KEY_ID
npx wrangler secret put APPLE_MAPS_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8

npx wrangler secret put TFNSW_API_KEY --env staging
```

The secrets are deliberately not listed under `secrets.required`: Wrangler refuses to deploy
while a required secret is missing, and the API is meant to run with only some providers set up.

Build without deploying, then deploy:

```sh
npx wrangler deploy --dry-run --outdir dist --env=""
npx wrangler deploy --env=""          # production: hopready-api
npx wrangler deploy --env staging     # staging: hopready-api-staging
curl https://hopready-api.<your-subdomain>.workers.dev/v1/health
```

Before the first deploy:

- The rate limit `namespace_id` values (1001 to 1004, and 1101 to 1104 for staging) must be unique
  in the Cloudflare account. Change them in `wrangler.jsonc` if the account already uses them.
- The first deploy applies the `v1` migration that creates the `ProviderBudget` class. Never edit
  or remove an applied migration; add a new tag instead.
- On Workers Free, CPU time is capped at 10 ms per request. Check CPU time in Workers Logs against
  real TfNSW responses, and move to Workers Paid before launch if plans come close. On Paid,
  consider `limits.cpu_ms` in `wrangler.jsonc` as a spending guard.

## Source map

| File                   | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `src/app.ts`           | Routes, validation, error mapping, rate limit and logging middleware |
| `src/config.ts`        | Reads and checks settings                                            |
| `src/runtime.ts`       | Chooses providers for the mode and builds the app                    |
| `src/composition.ts`   | Wraps the adapter factories and the daily budgets                    |
| `src/provider-set.ts`  | Provider interceptors for budgets and logging                        |
| `src/budget.ts`        | Daily call budget counting                                           |
| `src/budget-ledger.ts` | The Durable Object's SQL ledger and its client                       |
| `src/rate-limit.ts`    | Rate limit rules, in-memory limiter, Workers binding adapter         |
| `src/places.ts`        | Place search fan-out, merge and de-duplication                       |
| `src/car-parks.ts`     | Car park listing cache and occupancy freshness                       |
| `src/deadline.ts`      | Deadlines and timeouts that hold even when a task ignores its abort  |
| `src/logger.ts`        | Structured logs with the field allowlist                             |
| `src/worker.ts`        | Workers entry and the `ProviderBudget` Durable Object                |
| `src/node-server.ts`   | Node entry for local development                                     |
| `src/providers/`       | TfNSW and Apple Maps adapters                                        |
