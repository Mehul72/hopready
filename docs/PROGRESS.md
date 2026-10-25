# HopReady progress

Read this first when picking the work up. The plan with step-level detail is docs/plans/hopready-v1.md. Owner-side blockers are in docs/OWNER-ACTIONS.md.

## Where things stand (2026-10-26, just after midnight AEDT)

- Branch `feat/hopready-v1`, local only (nothing pushed). `git log --oneline` lists every step.
- **Done and tested.** Each item lists the commit and test command:
  - Core model, Sydney time and planner (`pnpm --filter @hopready/core test`)
  - Documented Park&Ride catalogue
  - Provider HTTP client
  - TfNSW adapters, commit 3a9a2ae: 119 tests, plus three real public Trip Planner responses mapped cleanly
  - Apple Maps adapters, commit e4189b0: 49 tests
  - API platform, commit d99d3d6: routes, validation, rate limits, daily budgets counting real HTTP requests, redacted logs, Workers config and Node server. 303 API tests pass, and `wrangler deploy --dry-run` builds.
  - Car park picker no longer polls occupancy, and search keeps room for addresses (8b6b03a)
- **In progress (parallel build, wave 1):**
  - demo fixtures
  - mobile foundation, then the screens
- **Next:**
  - extend the Park&Ride catalogue to all 40 live facilities from the Car Park API documentation, so the car park list needs no per-facility calls (draft in the session scratchpad)
  - integration and the iOS simulator run
  - XCUITest end-to-end (Maestro install was refused)
  - review pass

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

Live provider keys are read from the macOS Keychain (service `hopready`). See docs/OWNER-ACTIONS.md.

## Environment notes for this Mac

| Thing     | State                                                            | Why it matters                                                                                                                     |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Xcode     | 27.0; iOS 26.5 and 27.0 simulators                               | SDK 58 needs Xcode 26.4 or later. Maestro 2.11 has issues with Xcode 27.1, so hold at 27.0                                         |
| CocoaPods | 1.17.0 on Homebrew's bundled Ruby, wrapper at `~/.local/bin/pod` | System Ruby 2.6 is too old for `ffi`. The Intel Homebrew under Rosetta refuses to build on macOS 27 without new Command Line Tools |
| pnpm      | 11.20 with a minimum release age                                 | Versions published in the last day are rejected. Pin slightly older ones                                                           |
| ESLint    | 9.39                                                             | `eslint-plugin-react` does not support ESLint 10 yet                                                                               |
| JDK       | Temurin 17 (x86_64)                                              | Maestro needs Java 17 or later                                                                                                     |

## Verification status

| Claim                            | Status           | How                                                                                                                 |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Core planner rules (25 cases)    | Verified         | `pnpm --filter @hopready/core test`, 63 tests passing at commit f2bf488                                             |
| Sydney DST and midnight handling | Verified         | `time.test.ts` under Node ICU                                                                                       |
| CI workflow runs on GitHub       | Not verified     | Nothing pushed. Workflow YAML was parsed and checked locally (SHA-pinned actions, timeouts)                         |
| Live TfNSW and Apple calls       | Not verified     | No keys yet. Live tests skip without keys, and the "Live provider checks" workflow fails loudly instead of skipping |
| iOS build and simulator run      | Not yet          | Comes after wave 1                                                                                                  |
| API deployment                   | Not possible yet | Needs the owner's Cloudflare account                                                                                |
| TestFlight                       | Not possible yet | Needs the App Store Connect app record and one interactive signing setup                                            |
