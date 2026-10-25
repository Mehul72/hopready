# HopReady progress

Read this first when picking the work up. The plan with step-level detail is docs/plans/hopready-v1.md. Owner-side blockers are in docs/OWNER-ACTIONS.md.

## Where things stand (2026-10-26, morning AEDT)

- Branch `feat/hopready-v1`, local only (nothing pushed). `git log --oneline` lists every step.
- **The app is feature complete for v1** and runs end to end on the iOS simulator in demo mode. Live mode is built and tested against fakes, schema-derived samples and a local API serving demo data. It has not met the real Transport for NSW or Apple Maps services, because there are no keys yet. HopReady is not production ready until it has.
- **Done and tested:**
  - Core: model, Sydney time, the planner (every strategy, buffers applied once, the feasibility rules) and the demo world built on real TfNSW stops. `pnpm --filter @hopready/core test`.
  - API: routes, validation, rate limits, daily provider budgets, redacted logs, Workers config, TfNSW and Apple Maps adapters. `pnpm --filter @hopready/api test`.
  - App: Plan, place search, trip options, results, trip timeline with Start driving, parked car and Take me home, Saved, Settings, the first-launch live data agreement (ADR-0006), demo mode. `pnpm --filter @hopready/mobile test`.
  - Two independent reviews (API and planner; the app), with each finding checked by a second reviewer. Every confirmed finding is fixed with a test that fails without the fix.
  - A third review traced the brief requirement by requirement and found 24 gaps. The documentation gaps are fixed; the code gaps are being fixed and reviewed one by one (docs/plans/hopready-v1.md, log).
- **Blocked on the owner** (docs/OWNER-ACTIONS.md, "Fastest path to TestFlight"): provider keys, the Cloudflare and Expo accounts, the App Store Connect record, one interactive signing setup, the support email, and decisions 22 to 24.
- **Next, once the owner has acted:**
  1. Record real TfNSW responses (`apps/api/scripts/record-tfnsw-samples.ts`) and run the live provider checks (docs/testing.md). In the recorded trips, look for station entrance and exit details in `footPathInfo[].footPathElem` and walking legs' `pathDescriptions`, which HopReady drops today; if they name entrances or exits reliably, parse them in `apps/api/src/providers/tfnsw/transit.ts` and show them on the walk step.
  2. Deploy the API to staging and check `/v1/health` and one real plan.
  3. Create the EAS project, set `EXPO_PUBLIC_API_BASE_URL`, build with EAS and upload to TestFlight; report Apple's processing state.
  4. The on-device checklist in docs/release.md, including the Sydney drive time comparison before any public release.

## Resume

```sh
cd ~/hopready
git switch feat/hopready-v1
# pnpm can stop at a prompt in automation; run it non-interactively.
CI=true pnpm install --frozen-lockfile --config.confirm-modules-purge=false < /dev/null
pnpm check                      # typecheck, lint, tests, format
pnpm --filter @hopready/api dev # local API on http://localhost:8787 (see apps/api/README.md)
cd apps/mobile && npx expo run:ios   # simulator development build (needs CocoaPods)
```

Live provider keys are read from the macOS Keychain (service `hopready`). See docs/OWNER-ACTIONS.md. The UI tests are in docs/testing.md.

## Environment notes for this Mac

| Thing     | State                                                            | Why it matters                                                                                                                     |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Xcode     | 27.0; iOS 26.5 and 27.0 simulators                               | SDK 58 needs Xcode 26.4 or later. UI tests run on the iPhone 18 Pro simulator                                                      |
| CocoaPods | 1.17.0 on Homebrew's bundled Ruby, wrapper at `~/.local/bin/pod` | System Ruby 2.6 is too old for `ffi`. The Intel Homebrew under Rosetta refuses to build on macOS 27 without new Command Line Tools |
| pnpm      | 11.20 with a minimum release age                                 | Versions published in the last day are rejected. Pin slightly older ones                                                           |
| ESLint    | 9.39                                                             | `eslint-plugin-react` does not support ESLint 10 yet                                                                               |
| JDK       | Temurin 17 (x86_64)                                              | Installed for Maestro, which is no longer used; nothing needs it now                                                               |

## Verification status

| Claim                                         | Status                                            | How                                                                               |
| --------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Core rules, planner and demo scenarios        | Verified                                          | `pnpm --filter @hopready/core test`: 191 tests                                    |
| API routes, adapters and limits               | Verified against fakes and schema-derived samples | `pnpm --filter @hopready/api test`: 315 passed, 8 live tests skipped without keys |
| App screens and flows                         | Verified in Jest                                  | `pnpm --filter @hopready/mobile test`: 552 tests in 42 suites                     |
| Typecheck, lint and format                    | Verified                                          | `pnpm check`                                                                      |
| iOS Release simulator build                   | Verified                                          | `xcodebuild build-for-testing` (docs/testing.md)                                  |
| UI journeys on the simulator                  | Verified (demo mode)                              | XCUITest, 5 journeys; see the testing log                                         |
| App against a local API (demo data over HTTP) | Verified                                          | `HopReadyLiveApiTests`; see the testing log                                       |
| Expo project health                           | Verified                                          | `npx expo-doctor`: 20 of 20 checks                                                |
| CI workflows on GitHub                        | Not verified                                      | Nothing pushed. YAML parsed locally; actions pinned to full SHAs                  |
| Live TfNSW and Apple calls                    | Not verified                                      | No keys. Live tests skip without them                                             |
| API deployment, TestFlight                    | Not possible yet                                  | Needs the owner's accounts                                                        |
| Physical iPhone                               | Not verified                                      | Simulator only                                                                    |

## Testing log

Fixture and simulator results only. No test has reached the real TfNSW or Apple services.

| When (AEDT)      | What                                                                                                                          | Result                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-26 02:55 | XCUITest against a build pointed at a local API serving demo data (`HopReadyLiveApiTests`, iPhone 18 Pro simulator, iOS 27.0) | Passed: agreed to the live data agreement, then planned the drive-and-park trip with searches and the plan going over HTTP                                                                                            |
| 2026-10-26 02:55 | All UI tests on the demo build                                                                                                | 4 passed, 1 skipped (the API test, by design). The planning journey took 21 minutes, waiting 60 s per step for animations to finish; this did not recur in any later run, cause not found                             |
| 2026-10-26 07:27 | All UI tests on the demo build, final code at the time                                                                        | 4 passed, 1 skipped, planning journey 70 s. Its screenshot showed "Leave after 9:09 am" although the test asked for 10:00 am                                                                                          |
| 2026-10-26 07:35 | Diagnostic test on the time picker                                                                                            | XCUITest's wheel adjustment stopped short (hour 7 to 9, minutes 30 to 12), and the app kept exactly what the wheels showed. A test problem, not an app bug; the helper now repeats the adjustment and checks the time |
| 2026-10-26 07:45 | All UI tests on the demo build, with the trip map check and the new allowed-location journey                                  | 5 passed, 1 skipped, no animation waits                                                                                                                                                                               |
| 2026-10-26 07:42 | `pnpm typecheck`, `pnpm lint`, `pnpm test`, format check                                                                      | Passed: core 191; API 315 passed, 8 live tests skipped; app 552 in 42 suites                                                                                                                                          |

## Known limitations

- **Live providers are unverified.** The TfNSW parser is tested against samples built from the published schema, not recorded responses, and no Apple Maps call has been made (docs/testing.md).
- **The demo world** uses real stops but generated timetables. It shows the planner's rules hold, not what TfNSW will return (docs/testing.md).
- **Station entrances and exits** are never named. TfNSW may send details in fields HopReady does not read yet, so the timeline says they are not provided and to follow the station signs (docs/design/routing.md).
- **Fares and accessibility** are always shown as unknown. TfNSW removed Opal fares from the Trip Planner API in October 2023 (docs/design/routing.md).
- **Only the three best car parks** by drive time are checked per plan (docs/decisions/0001).
- **Walking speed** is not sent to TfNSW, because no parameter for it has been verified; slow walkers get TfNSW's walking times stretched instead (docs/design/routing.md).
- **Apple's drive times** have no published accuracy for Sydney; compare them with real drives before a public release (docs/release.md).
- **Apple-sourced places** (saved places, recent trips, the followed trip) are kept on the phone until deleted, which a strict reading of Apple's terms does not allow (owner decision 22).
- **Hermes** ships without its own privacy manifest, so App Store Connect may reject the first upload (docs/release.md).
- **Workers Free** may fail slow requests with Error 1102 and caps requests at 100,000 a day (docs/runbook.md). Workers Paid needs the owner's approval.
- **TfNSW's 5 requests a second** is enforced per Worker isolate only, so busy periods can exceed it across isolates (docs/providers.md).
- **All native testing is on the simulator.** GPS, real networks, performance and VoiceOver on a device are on the TestFlight checklist (docs/release.md).
