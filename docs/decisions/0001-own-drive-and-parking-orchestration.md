# ADR-0001: Build drive and parking legs ourselves on top of TfNSW transit

## Status

Accepted

## Date

2026-10-25

## Context

HopReady must plan drive, park, walk and public transport trips in Greater Sydney, plus drop-off and the return through a parked car.

Constraints:

- TfNSW's Trip Planner API (Swagger dated 2025-10-02) documents no request parameter for car, taxi, Park&Ride or Kiss&Ride legs. Its response enums still list classes 103 to 106. A 2017 spec briefly documented `trITMOT` (walk or taxi/drive to the stop), and it was gone by January 2018. Source: research notes, TfNSW claims Q3-01 to Q3-05.
- TfNSW's own website offers "Drive" to the nearest stop without traffic, and no Park&Ride option.
- The brief forbids inventing routes or times, and asks for a small, explainable candidate search instead of every combination across Sydney.
- Parking transfers may only happen at documented car parks or at a spot the user saved.

## Decision

- Use TfNSW `/v1/tp/trip` only for walking and public transport, with documented parameters only.
- Build the drive leg, the parking or drop-off buffer, the car retrieval buffer and the return through the car in our own planner (`packages/core/src/planner.ts`).
- Candidate car parks come from the TfNSW Car Park API, plus spots the user saved.
- Candidates are filtered by straight-line bounds, then ranked with one driving ETA call. Only the best 3 are asked for transit journeys.

## Alternatives considered

### Undocumented TfNSW car parameters (`trITMOT=105` and similar)

- Pros: one call per option, and TfNSW's own walking legs from the car park.
- Cons: undocumented for nearly nine years, with no traffic and no Park&Ride car park selection. They could change or vanish without notice.
- Rejected: we cannot ship correctness on an undocumented parameter.

### A general multimodal router (OpenTripPlanner with GTFS plus OSM, self-hosted)

- Pros: true optimisation across modes, plus park-and-ride support.
- Cons: a stateful service to run, GTFS and realtime feed ingestion, and no traffic-aware driving. It costs far more to operate than the first release justifies.
- Rejected for v1. It is the closest alternative, and the one to revisit (see below).

## Consequences

### Positive

- Every leg has a known data source. Transit comes straight from TfNSW, with no reinterpretation.
- The candidate search is explainable: the response lists which car parks were checked and why each was used or dropped.
- Providers can be replaced behind adapters without touching routing rules.

### Negative

- Results are not globally optimal. A good car park outside the top 3 candidates, or off the straight-line corridor, will be missed. The UI says which car parks were checked rather than claiming the best route.
- More provider calls per plan: one ETA call, up to 3 transit calls and up to 3 drive-route calls for park and ride. This adds latency and uses quota.
- The planner owns buffer and feasibility rules (transfer windows, walk limits and time windows), so they need their own tests. Those live in `planner.test.ts` and the fixture scenario tests.

## Revisit if

- TfNSW documents a supported Park&Ride or car access parameter.
- Users regularly report a better car park that HopReady did not check.
- Plan volume makes per-plan provider calls a cost or quota problem. A self-hosted router becomes cheaper per plan at high volume.

## Correction (2026-10-26)

The research notes cited under Context (TfNSW claims Q3-01 to Q3-05) were not committed. The Trip Planner Swagger they rest on is named in `apps/api/src/providers/tfnsw/__fixtures__/README.md`, and docs/providers.md lists the pages every provider figure came from. The decision is unchanged.
