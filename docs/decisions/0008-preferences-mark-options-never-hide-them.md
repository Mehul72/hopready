# ADR-0008: Walking, driving and transfer preferences mark options, they never hide them

## Status

Accepted

## Date

2026-10-31

## Context

The walking limit, the driving limit and the transfer buffer were feasibility rules: an itinerary with a walk over the limit, a drive over the limit or a change shorter than the buffer was rejected and counted, never shown. On 2026-10-31 the owner searched from 41 Hunter St, Parramatta to 50 Carrington St, Sydney with an 8 minute walking limit and got "No trip options found". TfNSW estimates the 700 m walk to Parramatta Station at 11 minutes, so every direct T1 trip failed the limit, and the bus-hop alternatives failed the transfer buffer.

What the research found (docs/research/park-and-ride.md, part 2):

- No reference planner applies a walking limit as a rejection. Google's `LESS_WALKING`, Citymapper's Walk Less, TfNSW's Least walking and Transit's Minimize walking are rankings or cost weights. The one engine study that capped origin and destination walking at 15 minutes measured result quality falling to 38 percent.
- TfNSW's own engine takes the walking limit as a preference (`trITMOTvalue100`) and still returns an 11 minute walk when it is the only way to the station.
- Appraisal guidance converts walking and waiting into weighted minutes (1.5 and 1.4), never into cut-offs.

Constraints:

- The app before build 5 ignores fields it does not know, so new markers must be additive.
- A change whose walk ends after the next service has left cannot be made at all, whatever the buffer, and a cancelled service cannot be taken; those are not preferences.

## Decision

1. The walking limit is sent to TfNSW as a preference, which shapes the journeys it proposes. An itinerary with a walk over the limit is kept and carries the concern `long-walk`.
2. The driving limit decides which car parks are considered (a car park whose drive runs past it is not tried). An itinerary whose drive still turns out longer, and the drive-the-whole-way option, are kept and carry `long-drive`.
3. A change shorter than the transfer buffer carries `tight-change`. A change that cannot be made (the walk between the services ends after the next one leaves) is still rejected as `transfer-too-short`.
4. From a car park, the journey within the preferences is preferred over one outside them when both exist.
5. Options are sorted by arrival time as before; concerns are shown on the option, not used to hide or demote it. The app shows the concern in the option's row (build 5); older builds show the option without it.
6. `walk-too-long` and `drive-too-long` are no longer sent as rejection reasons. They stay in the schema so older answers parse.

## Alternatives considered

### Keep the limits as filters and raise the defaults

- Pros: no app change.
- Cons: any limit hides the only sensible trip for someone; the default was already 15 minutes and the owner chose 8 on purpose.
- Rejected.

### Relax a limit automatically when nothing passes

- Pros: never an empty list.
- Cons: still hides the direct train when a worse bus-hop happens to pass; the person cannot tell what was relaxed.
- Rejected.

### Sort marked options after unmarked ones

- Pros: respects the preference visibly.
- Cons: a two hour trip with no marks would precede a thirty minute trip with a nine minute walk.
- Rejected; the mark is enough, and the app's sort menu can still offer "least walking".

### A strict mode on request

- Pros: some people need a hard limit (Transit offers a strict accessibility mode).
- Not chosen now; see Revisit if.

## Consequences

### Positive

- Parramatta to Carrington St with an 8 minute limit returns the direct T1 trips, marked, next to the bus-hop ones. Nothing is rejected (staging version 6d48416d).
- The results list is honest about trade-offs instead of silently smaller.

### Negative

- Lists are longer, and the drive-the-whole-way option appears even when long; the results screen must carry the marks and keep the list readable (plan step 10).
- The Settings copy, the store description and the support page said "walk at most N minutes"; they now have to say the limit is a preference that marks options (docs/plans/routing-and-results-v2.md step 9).
- The empty-state explanations for walking and driving limits are dead text until removed.

## Revisit if

- People ask to hide marked options outright: add a strict toggle in Settings rather than changing the default.
- TfNSW stops honouring `trITMOTvalue100`, in which case the mark still works but TfNSW's proposals get worse.
