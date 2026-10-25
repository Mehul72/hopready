import { haversineMetres, type Coordinate } from './geo';
import type { WALKING_SPEEDS } from './model';

// The walking model shared by the planner's own walks, the demo world and the TfNSW adapter.

export type WalkingSpeed = (typeof WALKING_SPEEDS)[number];

export const WALKING_METRES_PER_SECOND: Readonly<Record<WalkingSpeed, number>> = {
  slow: 0.9,
  normal: 1.3,
  fast: 1.6,
};

// Streets are not straight lines; 1.3 times the straight-line distance is a common urban estimate.
export const WALK_DISTANCE_FACTOR = 1.3;
// Closer than this, the traveller is already there and no walking leg is shown.
export const NEGLIGIBLE_WALK_METRES = 30;

const SECONDS_PER_MINUTE = 60;

export interface Walk {
  distanceMetres: number;
  // Rounded up to whole minutes, like the minute-based times TfNSW returns.
  durationSeconds: number;
}

export const NO_WALK: Walk = { distanceMetres: 0, durationSeconds: 0 };

export function walkBetween(from: Coordinate, to: Coordinate, speed: WalkingSpeed): Walk {
  const straightMetres = haversineMetres(from, to);
  if (straightMetres < NEGLIGIBLE_WALK_METRES) return NO_WALK;
  const distanceMetres = straightMetres * WALK_DISTANCE_FACTOR;
  const minutes = Math.ceil(distanceMetres / WALKING_METRES_PER_SECOND[speed] / SECONDS_PER_MINUTE);
  return { distanceMetres, durationSeconds: minutes * SECONDS_PER_MINUTE };
}

// How many times longer a walk takes at this speed than at the normal speed.
export function walkingPaceRatio(speed: WalkingSpeed): number {
  return WALKING_METRES_PER_SECOND.normal / WALKING_METRES_PER_SECOND[speed];
}

// The furthest straight-line distance that can still be walked within the time limit.
export function maxStraightLineMetres(maxWalkMinutes: number, speed: WalkingSpeed): number {
  return (
    (maxWalkMinutes * SECONDS_PER_MINUTE * WALKING_METRES_PER_SECOND[speed]) / WALK_DISTANCE_FACTOR
  );
}
