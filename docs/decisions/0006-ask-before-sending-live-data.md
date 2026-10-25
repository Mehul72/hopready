# ADR-0006: Ask before the first live request, as a gate in front of the app

## Status

Accepted

## Date

2026-10-26

## Context

Live planning sends personal data off the iPhone: the places a person searches for and travels between, the time, and (for Take me home) where their car is. HopReady's server forwards locations and search text to Transport for NSW and Apple.

Constraints:

- App Store Review Guideline 5.1.2(i): personal data may not be transmitted or shared without the person's permission. The location permission prompt covers reading the device location, not sending typed addresses to third parties.
- The privacy policy (`site/privacy/`) promises that HopReady asks before the first live search sends anything, and that demo mode sends nothing.
- Some builds have no API address (local development, tests). Asking there would be meaningless.
- People who say no still need a way to use the app. Demo mode already exists for that (ADR-0004).

## Decision

1. Settings hold a versioned record, `liveDataConsent: { version, acceptedAt } | null`. Only the current `LIVE_DATA_CONSENT_VERSION` counts, so changing what is sent, or who receives it, means bumping the version and asking everyone again. Delete all data clears it.
2. While live planning is possible (the build has an API address), demo mode is off and there is no current agreement, the root layout's route guards (`Stack.Protected`) leave only the explanation screen (`/welcome`) reachable. It offers "Agree and continue" and "Use demo mode instead".
3. Settings opens the same explanation as a sheet (`/data-use`), where the agreement can be withdrawn. Withdrawing, deleting all data, or turning demo mode off without an agreement brings the gate back straight away.
4. The HTTP transport refuses to send anything without the agreement (error kind `consent-required`), so a request started by code that runs outside the screens, such as refreshing the active trip on launch, cannot slip past the gate.

## Alternatives considered

### Ask just in time, on the first search or plan

- Pros: no screen between launch and the app; the question arrives with the action that needs it.
- Cons: every screen that can start a request (place search, plan, Take me home, car park list, the background refresh of the active trip) has to handle the interruption and resume its action afterwards. Missing one sends data without permission.
- Rejected: the gate is one place to get right, and the transport check backs it up.

### Rely on the privacy policy alone

- Pros: nothing to build.
- Cons: contradicts the policy's own promise, and Guideline 5.1.2(i) asks for permission, not notice.
- Rejected.

### Show the explanation once, without storing an answer

- Pros: simpler.
- Cons: no way to withdraw, and no way to tell whether the person agreed to the current explanation after it changes.
- Rejected.

## Consequences

### Positive

- Nothing personal leaves the iPhone before an explicit yes, and the privacy policy's promise is enforced in code at two layers.
- App Review sees a plain explanation and a working alternative (demo mode) on first launch.

### Negative

- A first-time user sees one screen before the Plan tab.
- Withdrawing the agreement in Settings replaces the whole app with the explanation screen until the person agrees again or chooses demo mode. This is deliberate: live mode cannot work without it.
- Every change to what is sent needs a version bump, or the old agreement silently covers the new behaviour.

## Revisit if

- App Review asks for the question to come at the moment of use instead.
- HopReady gains accounts, sync or analytics. Those need their own consent, not this one.
