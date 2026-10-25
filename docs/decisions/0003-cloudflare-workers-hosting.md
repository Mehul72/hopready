# ADR-0003: Host the API on Cloudflare Workers

## Status

Accepted (deployment waits on the owner's Cloudflare account)

## Date

2026-10-25

## Context

The backend is a small stateless TypeScript HTTP API. A search makes 5 to 10 outbound HTTPS calls, and upstream JSON bodies run up to about 1 MB.

It must hold provider keys, rate-limit per client, bound calls with timeouts, keep short-lived caches and expose a health check.

Constraints:

- No existing hosting account is logged in on the build machine.
- The brief says to avoid unnecessary services and databases, and not to start paid plans without approval.
- The app is free and public, so non-commercial-only free tiers are a risk. Vercel Hobby says "non-commercial personal use only".

## Decision

- Run the Hono app on Cloudflare Workers.
- The Workers Rate Limiting binding limits each client (per install ID, then per IP).
- A small SQLite Durable Object keeps a global daily provider-call budget.
- Workers Logs record structured, redacted logs.
- Secrets live in Wrangler secrets.
- Deploys run through GitHub Actions (`cloudflare/wrangler-action`).
- The same app runs on Node for local development (`apps/api/src/node-server.ts`).

## Alternatives considered

### Vercel

- Pros: smooth deploys.
- Cons: Hobby is non-commercial only, so a public app means Pro at US$20/month. Rate limiting rules depend on the plan.
- Rejected on cost and terms ambiguity.

### Fly.io, Render, Railway, Cloud Run, Lambda

- Rejected:
  - no free tier (Fly)
  - no Australian region (Render, Railway)
  - a card plus extra services needed for per-client rate limiting (Cloud Run, Lambda)

### Deno Deploy

- Rejected. Its shutdown was announced on 9 October 2026.

## Consequences

### Positive

- Edge execution in Sydney with no VM cold starts.
- Native secrets, rate limiting and a small durable counter, with no extra database.
- Costs US$0 on Free, or US$5/month on Workers Paid, which covers 1k to 100k searches a month.

### Negative

- Workers Free caps CPU at 10 ms per request. Cloudflare says payload-heavy work "typically use 10-20 ms", so parsing several large TfNSW responses will likely exceed it and fail with Error 1102. Plan on Workers Paid (US$5/month) before public launch. That needs the owner's approval.
- The Rate Limiting binding is approximate and counted per location, so bursts can pass. The provider budget, not the rate limiter, protects quota.
- `workers.dev` hostnames may be renamed with a week's notice. A custom domain should be in place before the App Store build points at the API.
- Cloudflare budget alerts only notify. They never cap spend.

## Revisit if

- CPU per plan regularly exceeds Paid defaults, or a Sydney-only data residency requirement appears.
- The project needs a database or background jobs that Workers handles poorly.
