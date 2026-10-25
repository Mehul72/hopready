# ADR-0004: Run demo mode on the device with the real planner

## Status

Accepted

## Date

2026-10-25

## Context

The brief asks for an explicit demo mode with deterministic fixtures that:

- is visibly labelled;
- exercises the complete interface and the routing orchestration;
- includes realistic timing and failure scenarios;
- stays separate from live mode.

Live mode must never fall back to fabricated routes. Development began with no provider keys.

App Review may also be done from outside Sydney, where live results are meaningless.

## Decision

The routing orchestration lives in `packages/core`, a TypeScript package with no runtime-specific APIs. That lets the same code run in three places:

- on Cloudflare Workers with live adapters;
- on Node with live adapters for development;
- inside the iPhone app with fixture adapters (`@hopready/core/fixtures`).

How the two modes are separated:

- Demo mode is a setting the user turns on. While it is on, every screen shows a banner.
- In live mode the app only talks to the API. If the API or a provider is not configured, the app says so and offers demo mode, but never switches to it on its own.
- The API can also run in demo mode (`HOPREADY_MODE=demo`) for local end-to-end runs. Responses then carry `mode: "demo"`, and the app shows the banner.

## Alternatives considered

### Demo data only on the server (a demo deployment)

- Pros: one code path in the app.
- Cons: needs a deployed backend before anyone can try the app. Reviewers and screenshots depend on network and hosting.
- Rejected as the only path. It is kept as an option for local runs.

### Recorded live responses replayed as the demo

- Pros: realistic.
- Cons: times go stale immediately. It cannot exercise arrive-by or failure scenarios deterministically, and it risks presenting old real data as current.
- Rejected.

## Consequences

### Positive

- The demo exercises the same planner rules as live mode, and works offline and outside Sydney.
- Failure scenarios (cancelled service, tight transfer, timeouts, rate limits, stale occupancy, no route) can be triggered on purpose.

### Negative

- The app bundle carries the fixture network, roughly tens of kilobytes of TypeScript data.
- Fixture timetables are plausible, not real. They must never be described as real, so names and the banner say so.
- Core code must stay Hermes-compatible: no Node-only APIs, and no `AbortSignal.any` (see `packages/core/src/async.ts`).

## Revisit if

- Bundle size or startup time is measurably affected.
- App Review objects to a demo mode in a production build. In that case keep it, but rename it "Sample trips" and explain in review notes.
