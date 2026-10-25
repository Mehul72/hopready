# Plan: HopReady v1 (iPhone, Greater Sydney)

Status: in progress
Branch: feat/hopready-v1 (local only; not pushed)

## Goal

A first release that someone in Greater Sydney can use on an iPhone.

- Enter an origin, a destination and a depart-at or arrive-by time.
- Compare real options: public transport only; drive, park at a documented or user-saved car park, then public transport; get dropped off, then public transport; drive only.
- Open a timeline and map for one option, and hand the drive leg to a navigation app.
- Confirm where the car was actually parked, and get "Take me home" through that car.
- Live mode uses real providers through the API. Demo mode uses labelled, deterministic fixtures on the device.

Verifiable by:

- the scenario tests from brief section 10 passing;
- the app running on an iOS simulator in demo mode, and in live mode against the API;
- live provider tests passing with real keys;
- a TestFlight build reaching Apple processing, when access allows.

## Decided already

- Stack: ADR-0005.
- Orchestration: ADR-0001.
- Apple Maps: ADR-0002.
- Workers hosting: ADR-0003.
- On-device demo mode: ADR-0004.
- Routing rules: docs/design/routing.md.
- Bundle ID default `au.hopready.HopReady`, matching the owner's existing `au.kerbside.Kerbside` pattern. The owner can override it until the first App Store Connect upload.

## Out of scope for v1

- Background location, turn-by-turn navigation, accounts or sync.
- An Android release.
- Fare purchase, and fares shown at all (TfNSW removed Opal fares from the API).
- Areas outside Greater Sydney.
- Any LLM-generated routing data.

## Steps

- [x] 1. Workspace scaffold, checks and CI. Done when local typecheck, lint, test and format all pass, and the CI workflow runs the same scripts. Commits ae158e1 and 1bbe081. CI itself has not run yet because nothing is pushed.
- [x] 2. Core model, Sydney time and provider contracts, with DST and midnight tests. Commit e0f0b23.
- [x] 3. Planner: strategies, candidate search, buffers, feasibility, return through the car. 25 unit tests. Commit f2bf488.
- [ ] 4. Demo fixtures, with scenario tests for every case in brief section 10 running the real planner. Wave 1: fixtures agent.
- [ ] 5. TfNSW adapters: trip, stop search and car parks, with schema-derived parser tests and a recording script. Wave 1.
- [ ] 6. Apple Maps adapters: token, ETAs, directions and search. Wave 1.
- [ ] 7. API platform: routes, validation, rate limits, budgets, logging, Workers config, Node server. Wave 1.
- [ ] 8. Mobile foundation, then the screens (plan, search, results, itinerary, car, saved, settings). Wave 1.
- [ ] 9. Integration: wire the composition roots, add the mobile test script, run the full check, simulator build, demo-mode walkthrough with screenshots, Maestro E2E.
- [ ] 10. Review pass: adversarial review of routing correctness, security and accessibility, then fix the findings.
- [ ] 11. Release preparation: app icon, privacy and support pages, store metadata, App Review notes, TestFlight checklist, runbook, EAS profiles. Deploy and TestFlight upload once the owner provides the accounts.

## Open questions (owner)

See docs/OWNER-ACTIONS.md. None of them blocks steps 4 to 10.

## Log

- 2026-10-25: Repo inspected. The research workflow covered TfNSW, driving, maps, Expo, Apple release and hosting, each with a fact-checker.
- 2026-10-25: The owner went away and asked for the app to be as finished as possible. Defaults were adopted:
  - no push or PR (the owner's AGENTS.md wins over the brief);
  - free tiers only;
  - Australia-only storefront;
  - no analytics.
- 2026-10-25: pnpm 11 rejected `hono@4.13.14` (published that day) under its minimum release age, so hono is pinned to `^4.13.13`.
- 2026-10-25: `pnpm install` waited at a prompt after `allowBuilds` changed. Run it non-interactively (see ADR-0005).
- 2026-10-25: Homebrew under Rosetta cannot build CocoaPods on macOS 27. Installed CocoaPods 1.17.0 on Homebrew's bundled Ruby with a wrapper at `~/.local/bin/pod`.
- 2026-10-25: Downloading and running actionlint was refused by the session's permission policy. Workflows were checked by parsing them with js-yaml instead: every action is pinned to a full SHA, and every job has a timeout.
