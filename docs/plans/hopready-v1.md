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
- [x] 4. Demo fixtures, with scenario tests for every case in brief section 10 running the real planner. Commit e3dcc60; the network uses real TfNSW GTFS stops with generated timetables.
- [x] 5. TfNSW adapters: trip, stop search and car parks, with schema-derived parser tests and a recording script. Commit 3a9a2ae, then the full Park&Ride catalogue (223fe3b, a140157).
- [x] 6. Apple Maps adapters: token, ETAs, directions and search. Commit e4189b0.
- [x] 7. API platform: routes, validation, rate limits, budgets, logging, Workers config, Node server. Commit d99d3d6.
- [x] 8. Mobile foundation, then the screens (plan, search, results, itinerary, car, saved, settings). Commits c4c6e1b, 2977e10 and the trip, car, saved and settings commit.
- [x] 9. Integration: consent gate (ADR-0006), Safari links, store-build demo gate, Release simulator build, XCUITest journeys (Maestro dropped: its install was refused, and XCUITest covers the journeys).
- [x] 10. Review pass: two review workflows (API and planner; mobile), each finding checked by a skeptic. Confirmed findings fixed with tests; see the log.
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
- 2026-10-25: Installing Maestro (Homebrew tap mobile-dev-inc/tap) was refused by the session's permission policy. Simulator checks used `xcrun simctl` screenshots at first. No Maestro flows were written: XCUITest replaced Maestro (see 2026-10-26).
- 2026-10-25: Planner now reports nearby car parks skipped for direction, and explains empty transit and return-to-car results (commit 2cb1bfc).
- 2026-10-26: Wave 1 finished. The screens landed in two commits after tsc, lint and 529 app tests passed.
- 2026-10-26: Added the live data agreement (ADR-0006): a gate in the root layout, plus a transport check so background refreshes cannot send without it.
- 2026-10-26: Release simulator builds with the UI test target work. Three XCUITest journeys pass: launch, planning a drive-and-park demo trip, and parked car plus relaunch plus Take me home. A failing UI test makes xcodebuild collect a sysdiagnose for many minutes; pass -collect-test-diagnostics never.
- 2026-10-26: Apple requires privacy manifests for SDWebImage and hermes (third-party SDK list, fetched). The unused expo-image (SDWebImage) was removed; Hermes ships without its own manifest and is recorded as an upload risk in docs/release.md.
- 2026-10-26: API review: 4 findings confirmed and fixed (cross-site POST quota spend, body timeouts, empty car park cache, oversized budget reports). Privacy review: the policy now discloses saved parking spots, the search location hint, iOS street lookups and Apple map tiles.
- 2026-10-26: Planner review: 8 of 9 findings confirmed (one refuted as documented design). Fixed by a dedicated agent, including Take me home being rejected by the drive limit and walking speed being ignored for live TfNSW journeys.
- 2026-10-26: Mobile review: 24 findings. 23 confirmed and fixed; 1 refuted (the followed trip keeps Apple's route line, which is covered by owner decision 22).
- 2026-10-26: Traceability review against the brief: 24 gaps, unverified because the verifiers hit a session limit. Fixed directly: provider call counts and sources, owner setup steps (GitHub environments, EAS project ID, Pages), Maestro references, the runbook (Cloudflare errors 1102 and 1027), a bad-build section, location triggers in the privacy policy, an arrive-by Apple live check, the testing log and known limitations. Code gaps went to one agent each, every fix reviewed before merging.
- 2026-10-26: UI tests: XCUITest's picker wheel adjustment stops short on the iOS 27 simulator, so planning journeys ran at whatever time the wheels reached (the app kept that time correctly). The helper now repeats the adjustment and checks the time. Added a trip map check and a journey that allows location access; each test resets the location permission first.
- 2026-10-26: The traceability review's code gaps went to one agent each, in its own git worktree, then an independent review, then a repair round where the review found problems (4 of 6 needed one). Fixed: arrival platforms, each change set against the transfer buffer, a station entrance and exit fallback; pinning where the car is with location denied; trips home re-planned through the car as it is now, and marked out of date when it changes; checks of a followed trip after it starts, and old live times labelled with when they were checked; a saved spot as the preferred car park; options matched or beaten by a shown one left out, never the one asked for; answers from a demo-mode API labelled as demo. All six worktrees were created at main's first commit instead of the feature branch, and each agent fast-forwarded before starting.
- 2026-10-26: Merged by cherry-pick. The planner's "ask for the followed car park on refresh" change overlapped the re-planning change; resolved so that only whole-trip checks ask for it, and the request kept with the trip stays as the traveller made it (mutation-checked).
- 2026-10-26: A second independent review of the merged fixes, with each serious finding verified separately, found 21 issues. Fixed: a started trip counted as still on, or an alternative offered, when its next service now leaves before the traveller reaches the stop; a delay that only adds a wait reported as a replaced trip; a drop-off silently switching station; old alternatives spoken as live, and the 15 minute live rule judged in whole minutes; a car park count judged fresh at planning rather than at parking (cross-station fallbacks now stay unless the count will hold), car parks at a station asked for hidden behind another station, and options cut by the 10-option cap reported as used; "Platform not provided" on buses and On Demand, drop-off wording that assumed a platform, and change notes that could call a missed connection tight; seven parked-car issues on the correct and confirm screens. Not fixed (low): when a followed trip is gone, its alternatives come from a check that asked for the followed car park, so a car park the traveller asked for can be missing from them.
- 2026-10-26: Four runs of the API-backed UI journey stalled in XCTest (taps and swipes not acknowledged for minutes, the app idle in every spindump) while the review agents ran test suites on the same Mac; it passed in 89 s once they had finished. Cause not proven.
