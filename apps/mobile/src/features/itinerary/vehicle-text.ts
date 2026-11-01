import {
  type Coordinate,
  isTrackedVehicleMode,
  trackedServiceKey,
  type TransitMode,
} from '@hopready/core';

import { LEG_VISUALS } from '@/theme';
import type { TrackedLeg, VehiclePositions } from '@/trip/vehicle-positions';

import { serviceTitle, type Wording } from './trip-text';

// Older than this, a position says where a vehicle was rather than where it is, so it is not put
// on the map. Sydney Trains positions were over 5 minutes old for 24 of 139 trains on 2026-11-01.
export const VEHICLE_POSITION_FRESH_MS = 5 * 60_000;

export interface VehicleMarkerPlace {
  coordinate: Coordinate;
  bearingDegrees: number | null;
  mode: TransitMode;
  // Still finishing the trip before this one, so it may be far away or heading the other way.
  onPreviousTrip: boolean;
}

export interface VehicleRow {
  key: string;
  legIndex: number;
  mode: TransitMode;
  // "Bus 380 towards Bondi Beach"
  title: string;
  status: Wording;
  // Null when there is no position worth showing.
  place: VehicleMarkerPlace | null;
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

// How long before the check a position was reported: "20 s" or "3 min" on screen.
export function positionAge(ageMs: number): Wording {
  const seconds = Math.max(0, Math.round(ageMs / 1_000));
  if (seconds < 5) return { text: 'just now', spoken: 'just now' };
  if (seconds < 60) return { text: `${seconds} s ago`, spoken: `${plural(seconds, 'second')} ago` };
  const minutes = Math.round(seconds / 60);
  return { text: `${minutes} min ago`, spoken: `${plural(minutes, 'minute')} ago` };
}

function wording(text: string, spoken = text): Wording {
  return { text, spoken };
}

function joined(...parts: Wording[]): Wording {
  return {
    text: parts.map((part) => part.text).join(' · '),
    spoken: parts.map((part) => part.spoken).join('. '),
  };
}

export function vehicleTitle(tracked: TrackedLeg): string {
  return `${LEG_VISUALS[tracked.leg.mode].label} ${serviceTitle(tracked.leg)}`;
}

// One row per tracked service, saying where its vehicle is or why there is no position.
export function vehicleRows(
  trackedLegs: readonly TrackedLeg[],
  positions: VehiclePositions,
  nowMs: number,
): VehicleRow[] {
  return trackedLegs.map((tracked) => {
    const row = {
      key: `${trackedServiceKey(tracked.service)}|${tracked.legIndex}`,
      legIndex: tracked.legIndex,
      mode: tracked.leg.mode,
      title: vehicleTitle(tracked),
    };
    if (!tracked.due) {
      return { ...row, status: wording('Shows about an hour before it leaves'), place: null };
    }
    const lookup = positions.lookups.get(trackedServiceKey(tracked.service));
    if (!lookup) {
      return {
        ...row,
        status: positions.failed
          ? wording('Could not check just now. Trying again')
          : wording('Checking where it is'),
        place: null,
      };
    }
    const notUpdated = positions.failed ? [wording('not updated just now')] : [];
    switch (lookup.status) {
      case 'located': {
        const checkedAtMs = positions.checkedAt ? Date.parse(positions.checkedAt) : nowMs;
        const ageMs = checkedAtMs - Date.parse(lookup.observedAt);
        const age = positionAge(ageMs);
        if (ageMs > VEHICLE_POSITION_FRESH_MS) {
          return {
            ...row,
            status: joined(
              wording(`Last seen ${age.text}`, `Last seen ${age.spoken}`),
              wording('it may have moved since'),
            ),
            place: null,
          };
        }
        const onPreviousTrip = lookup.servingTrip === 'previous-trip';
        return {
          ...row,
          status: joined(
            ...(positions.mode === 'demo' ? [wording('Sample position')] : []),
            ...(onPreviousTrip ? [wording('Finishing its previous trip')] : []),
            wording(`Updated ${age.text}`, `Updated ${age.spoken}`),
            ...notUpdated,
          ),
          place: {
            coordinate: lookup.position,
            bearingDegrees: lookup.bearingDegrees,
            mode: lookup.mode,
            onPreviousTrip,
          },
        };
      }
      case 'not-located':
        return {
          ...row,
          status: joined(
            Date.parse(tracked.leg.start) > nowMs
              ? wording('Not on its way yet')
              : wording('Not reporting where it is'),
            ...notUpdated,
          ),
          place: null,
        };
      case 'not-tracked':
        return {
          ...row,
          status: wording('Live positions are not available for this service'),
          place: null,
        };
      case 'unavailable':
        return { ...row, status: wording('Could not get its position just now'), place: null };
    }
  });
}

// Whether a trip's timeline offers its live map: only when a service runs on a mode with a feed.
export function hasLiveMap(trackedLegs: readonly TrackedLeg[]): boolean {
  return trackedLegs.some((tracked) => isTrackedVehicleMode(tracked.leg.mode));
}

// The way from a trip's timeline to its live map: "See where your bus is", or for a trip on several
// modes, "See where your services are".
export function liveMapLinkLabel(trackedLegs: readonly TrackedLeg[]): string {
  const modes = new Set(
    trackedLegs.map((tracked) => tracked.leg.mode).filter((mode) => isTrackedVehicleMode(mode)),
  );
  const [only] = modes;
  if (modes.size !== 1 || !only) return 'See where your services are';
  return `See where your ${LEG_VISUALS[only].label.toLowerCase()} is`;
}

// VoiceOver for a marker: "Bus 380 towards Bondi Beach, updated 20 seconds ago".
export function vehicleMarkerLabel(row: VehicleRow): string {
  return `${row.title}. ${row.status.spoken}`;
}
