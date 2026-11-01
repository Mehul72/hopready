# Plan: airport journeys and monochrome appearance

Status: in progress
Branch: feat/rebrand

## Goal

Restore the missing public transport and drive-and-park options reported for Kellyville to Sydney Airport T1, and remove the green tint from the interface. Deliver the tested correction through the existing API and TestFlight release process.

## Decisions

- Reproduce the reported journey against the deployed API and the real TfNSW response before changing response handling.
- Use neutral white, grey and black surfaces and controls in both appearances. Preserve semantic transport and warning colours.
- Keep all trip functionality and existing navigation.
- The owner's existing permission to commit, push and publish applies to this correction.

## Out of scope

New routing strategies, new providers, public App Store release and tester access changes.

## Steps

- [x] 1. Prove the response failure and fix it with a regression test.
      done when: the regression fails before the fix, passes afterwards, and the reported real response maps into usable journeys.
- [x] 2. Replace tinted surfaces and artwork with a monochrome treatment.
      done when: contrast tests pass and both appearances are inspected in the native app.
- [x] 3. Run full checks, deploy and verify the live journey.
      done when: repository checks pass, the deployed API returns transit and drive-and-park options for the reported trip, and existing control trips remain valid.
- [ ] 4. Commit, push and publish the corrected app.
      done when: CI passes and Apple confirms the exact new build is valid and in internal beta testing.

## Log

- 2026-11-01: The screenshots show both transit-based strategies failing with an unreadable-provider-response message. The owner also rejected the green cast of the dark surfaces and information banners.

- 2026-11-01: Reproduced both missing transit strategies on the deployed API. All four returned journeys passed the wire schema but failed mapping because the airport short name was `, Platform 2`. Removing that short name in an isolated experiment restored all four journeys. Three regression cases failed before the fix; all 39 transit tests pass after falling back to the full station name and separating platform labels before a locality. The unmodified real response now maps all four journeys with no dropped entries.

## API rollout

- Existing TestFlight builds use the staging Worker. This is a read-only mapping correction with no schema or stored-data changes.
- Advance when the reported airport trip returns transit-only and park-and-ride options without malformed-response notices, and the Kellyville-to-Central control trip still works.
- Hold on any provider failure or unexpected strategy loss. Roll back on a new response-validation failure or server error in either trip.
- Previous Worker version: `c0621b2d-2b91-46ce-8084-5d4290d7725b`. Rollback command from `apps/api`: `pnpm exec wrangler rollback c0621b2d-2b91-46ce-8084-5d4290d7725b --env staging --message 'Revert airport name parsing'`. Uses the existing Keychain credentials. Verify health and the control trip afterwards. No data repair is needed.

- 2026-11-01: Full `pnpm check` passed (325 core, 332 API, 731 mobile tests; eight credential-gated live tests skipped). Deployed API fix `6c8ef5c` to the TestFlight API, Worker `fa88cec2-8250-494d-a88d-346d2a702e5f`. A fresh plan from the reported address to Airport T1 returned ten options across drive-only, transit-only and park-and-ride with no unavailable strategies. Kellyville Station to Central also returned ten options across all three strategies with no provider failures. Health reports all providers configured.

- 2026-11-01: Native build, light and dark main-screen journeys, and maximum-text dark planner check all passed. Inspected both planners and results plus light Settings; backgrounds, cards, information badges and controls are monochrome. Refreshed the nine light captures and four large-text captures, and added dark planner/results references. Restored simulator defaults.
