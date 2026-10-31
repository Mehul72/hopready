# Plan: neutral appearance

Status: in progress
Branch: feat/rebrand

## Goal

Replace the blue-dominated rebrand with a quiet, neutral interface, preserve discoverable controls and all trip functionality, and deliver the correction through the existing TestFlight release process.

## Decisions

- White and soft grey surfaces in light mode; neutral charcoal in dark mode, following the phone's appearance.
- Muted green is a small action accent. Everyday menu icons and surfaces stay neutral.
- Keep the route mark, recoloured on an off-white icon. Use a light launch background and a charcoal dark launch background.
- Remove decorative taglines and the Plan screen's extra branding row.
- Existing permission to commit, push and publish TestFlight continues for this correction.

## Out of scope

Routing, storage, API, permission and consent behaviour, navigation structure and tester access.

## Steps

- [x] 1. Update theme, artwork, launch assets and visual hierarchy.
      done when: contrast checks, typecheck, lint and existing tests pass; artwork inspected.
- [x] 2. Inspect the main screens in light mode and the accessible planner in dark mode.
      done when: native build and both capture journeys pass, screenshots inspected and refreshed.
- [ ] 3. Commit, push and publish the corrected build.
      done when: CI passes and Apple reports the new build valid and in internal beta testing.

## Log

- 2026-11-01: Both native capture journeys passed. Inspected the light-mode planner, results and settings, and dark-mode controls at maximum text size. Refreshed the nine main screenshots and four accessibility captures.

- 2026-11-01: Neutral artwork inspected, icon verified opaque, complete `pnpm check` passed and the native build succeeded. Launch assets include a pale mark for charcoal appearance.

- 2026-11-01: Full checks passed with the neutral palette (1,385 tests). Native icon compilation requires the translucency value even when the effect is disabled; retained an explicit zero value and reran the native build.

- 2026-11-01: The user rejected the dominant blue and navy surfaces. This revision removes that direction, including the icon and splash treatment, instead of replacing it with another coloured background.
