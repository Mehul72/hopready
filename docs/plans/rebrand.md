# Plan: HopReady rebrand

Status: done
Branch: feat/rebrand

## Goal

Give the iPhone app a calm, minimal visual identity and make planning understandable at a glance, while preserving every existing planning, parking, saved-place and settings capability. Verify the flows, commit and push the changes, then deliver a production build through the existing TestFlight setup.

## Decided already

- Keep the HopReady name, bundle identity, API and on-device data formats.
- Use cobalt blue, quiet neutral surfaces, generous rounded groups and system typography in light and dark mode.
- Keep the four labelled native tabs. Show route entry and the main action prominently; disclose timing and travel controls through clearly labelled rows with summaries.
- Use a new continuous-route mark for the icon, splash screen and in-app signature. Generate all assets from the same vector geometry.
- Preserve data consent, optional location, demo labels, transport distinctions, accessibility labels, Dynamic Type and 44-point touch targets.
- The user explicitly authorized a short unattributed commit, push and TestFlight publication. This overrides earlier user and skill defaults against publishing.

## Out of scope

- Renaming the app, changing routing algorithms, API contracts or stored data.
- An App Store public release or external tester invitations.

## Steps

- [x] 1. Establish the identity and shared components.
      files: theme, components, brand generator/assets, app config
      done when: generated assets inspected; colour contrast, component tests and typecheck pass.
- [x] 2. Rework planning and screen hierarchy across the app.
      files: plan, results, itinerary, parked-car, saved, settings, navigation
      done when: timing/travel disclosures work, every feature remains reachable, screen-flow tests pass.
- [x] 3. Verify and document the finished interface.
      files: affected flow tests, iOS UI tests, design notes, screenshots
      done when: pnpm check passes, simulator journeys pass, light/dark and large-text screens visually inspected.
- [x] 4. Commit, push and deliver TestFlight.
      done when: reviewed commit is on origin, production build uploaded, App Store Connect reports Testing or Ready to Submit (not Processing).

## Open questions

- Expo and App Store Connect access verified through the existing release setup. No input is needed from the owner.

## Log

- 2026-11-01: Committed and pushed `db7f2b7` (`feat: rebrand HopReady`) on `feat/rebrand`; GitHub CI passed. Production build 0.1.0 (7), EAS `73512ecf-896b-47c7-8b91-63f993a677ba`, uploaded through submission `208fe6cc-d617-4279-9382-5894b4fa4254`. Apple reports `VALID` and `IN_BETA_TESTING`, confirming availability to the existing internal testers. The optional CLI changelog field was rejected as Enterprise-only; the standard submission succeeded.

- 2026-11-01: Final accessibility run passed at the largest Dynamic Type size in dark mode. Visually inspected all four captures: full-width place fields, vertically stacked time choices, wrapping travel chips and the complete Plan trip button above the tab bar. Simulator settings restored to light/large. `pnpm check` passed again on the final app code (1,385 tests total); physical-device GPS and spoken VoiceOver remain device checks.

- 2026-11-01: Final light-mode walk-through passed with the native header restored; visually confirmed the results map starts directly below the header. Refreshed all nine review screenshots. The icon generator now shares every route coordinate between vector and raster output; regenerated assets have identical SHA-256 hashes.
- 2026-11-01: Native suite completed with 6 passed, 1 skipped (the live API journey, intentionally unavailable in the no-API simulator build), 0 failures. This includes parking persistence, Take me home through the car, location permission, planning, map expansion and Apple Maps handoff. The final header/chip style changes are being rebuilt for screenshot and large-text verification.

- 2026-11-01: Visual review found the explicit opaque header background added extra top space above the results map. Restored the native header material; the final capture will verify its insets.

- 2026-11-01: Native screenshot and location journeys passed. The next setup hit iOS 27’s missing animation-completion notification when removing the demo strip as the reset alert closed. Added a relaunch after the data reset to clear the native animation waiter before the next journey.

- 2026-11-01: Inspected the production archive. EAS ignores `.git/info/exclude` and would include the local `.codegraph` database, so added explicit build exclusions in `.easignore` while preserving the existing secret/native/dependency exclusions.
- 2026-11-01: Plan timing and travel disclosures, Saved categories, and Settings groups passed their flows. `pnpm check` passed across core, API and mobile, including 731 mobile tests; provider health reports all four live providers configured.

- 2026-11-01: Shared identity and generated icon inspected; 137 contrast/component checks passed, TypeScript and lint passed. Expo prebuild regenerated the native directory and removed its derived build cache; pods were restored and a fresh simulator build is running.
- 2026-11-01: New disclosure tests initially used a matcher absent from Testing Library 14. The failure was in the assertions, not the controls; switched to the existing `toHaveProp` matcher and reran them.

- 2026-11-01: Reviewed the existing screens, component system, flow tests and release instructions. The current Plan page shows timing, three travel toggles and advanced preferences at the same level. Progressive disclosure will shorten this first screen.
- Reference patterns: Apple Maps uses place cards and a searchable library (https://www.apple.com/maps/). Google Maps' Explore interface emphasizes relevant choices and expands detail when needed (https://blog.google/products-and-platforms/products/maps/holiday-gemini-tips-new-explore-tab/).
