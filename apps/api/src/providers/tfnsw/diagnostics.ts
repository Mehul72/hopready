// What the TfNSW adapters left out of a response, and why, so drift in TfNSW's data shows up in logs and
// metrics instead of as quietly missing options. Events never carry places, coordinates or search text.
export type TfnswDiagnostic =
  | {
      kind: 'journeys-dropped';
      // unsupported-mode: a leg HopReady cannot show (such as product class 104, Park & Ride).
      // excluded-mode: a mode the traveller excluded that TfNSW has no exclusion parameter for.
      // unreadable: a journey missing something HopReady relies on, such as a time or a stop location.
      reason: 'unsupported-mode' | 'excluded-mode' | 'unreadable';
      count: number;
      productClasses?: number[];
    }
  | { kind: 'no-journeys'; systemMessageCodes: number[] }
  | { kind: 'alerts-dropped'; reason: 'unreadable'; count: number }
  | { kind: 'stops-dropped'; reason: 'unreadable'; count: number }
  | {
      kind: 'facilities-left-out';
      reason: 'no-usable-location' | 'outside-coverage' | 'invalid-facility';
      facilityIds: string[];
    }
  | {
      kind: 'facility-details-unavailable';
      facilityIds: string[];
    }
  | { kind: 'stale-facility-list'; ageHours: number }
  | { kind: 'empty-facility-list' }
  | { kind: 'occupancy-left-out'; reason: 'unreadable' | 'request-failed'; facilityIds: string[] }
  // The one-call list of every car park could not be read or fetched, so car parks were asked for
  // one at a time instead.
  | { kind: 'full-list-unavailable' }
  | { kind: 'full-list-entries-unreadable'; count: number };

export type DiagnosticSink = (diagnostic: TfnswDiagnostic) => void;

export const ignoreDiagnostics: DiagnosticSink = () => undefined;
