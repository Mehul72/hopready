import { DEFAULT_PLANNER_LIMITS, type Occupancy, secondsBetween } from '@hopready/core';

// How car park counts read everywhere in the app, so a result card and the trip screen can never
// describe the same count differently.

export const SPACES_CAN_FILL_NOTE = 'Spaces can fill before you arrive.';
// A count older than this reads as possibly out of date, the same limit the planner applies.
export const OCCUPANCY_FRESH_MINUTES = DEFAULT_PLANNER_LIMITS.occupancyFreshMinutes;

export interface Wording {
  // What the screen shows, in the short forms the app uses ("3 min ago").
  text: string;
  // The same for VoiceOver, with units written out ("3 minutes ago"), without a closing full stop.
  spoken: string;
}

export interface OccupancyWording extends Wording {
  freshness: 'current' | 'stale' | 'unknown';
  // The first of two lines: the count with its age, or the count alone when it may be out of date.
  summary: string;
  // The second line: "May be out of date (updated 2 h ago)", or why there is no count.
  detail: string | null;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
// Below this, hours read better than days ("30 h ago" is clearer than "1 day ago").
const DAYS_FROM_HOURS = 48;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function minutesSince(observedAt: string, now: Date): number {
  return Math.floor(Math.max(0, secondsBetween(observedAt, now)) / SECONDS_PER_MINUTE);
}

// How long ago a count was taken. A time ahead of the phone's clock reads as "just now".
export function describeAge(observedAt: string, now: Date): Wording {
  const minutes = minutesSince(observedAt, now);
  if (minutes < 1) return { text: 'just now', spoken: 'just now' };
  if (minutes < MINUTES_PER_HOUR) {
    return { text: `${minutes} min ago`, spoken: `${plural(minutes, 'minute', 'minutes')} ago` };
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < DAYS_FROM_HOURS) {
    return { text: `${hours} h ago`, spoken: `${plural(hours, 'hour', 'hours')} ago` };
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  const spokenDays = plural(days, 'day', 'days');
  return { text: `${spokenDays} ago`, spoken: `${spokenDays} ago` };
}

function describeSpaces(spacesAvailable: number): Wording {
  if (spacesAvailable === 0) return { text: 'No spaces free', spoken: 'No spaces free' };
  // A count is a snapshot from the car park's sensors, never a promise, so it is approximate.
  return {
    text: `~${plural(spacesAvailable, 'space', 'spaces')} free`,
    spoken: `About ${plural(spacesAvailable, 'space', 'spaces')} free`,
  };
}

// Approximate, always with its age, and never a guess when the count is missing. A count that was
// fresh when the trip was planned is flagged once it has aged past the planner's limit.
export function describeOccupancy(occupancy: Occupancy, now: Date): OccupancyWording {
  if (occupancy.status === 'unknown') {
    const reason = occupancy.reason.replace(/\.$/, '');
    return {
      freshness: 'unknown',
      text: 'Occupancy unknown',
      summary: 'Occupancy unknown',
      detail: occupancy.reason,
      spoken: `Occupancy unknown. ${reason}`,
    };
  }
  const spaces = describeSpaces(occupancy.spacesAvailable);
  const age = describeAge(occupancy.observedAt, now);
  const isOld = minutesSince(occupancy.observedAt, now) > OCCUPANCY_FRESH_MINUTES;
  if (occupancy.status === 'stale' || isOld) {
    const warning = `May be out of date (updated ${age.text})`;
    return {
      freshness: 'stale',
      text: `${spaces.text} · ${warning}`,
      summary: `${spaces.text} when last counted`,
      detail: warning,
      spoken: `${spaces.spoken} when last counted, but this may be out of date. Updated ${age.spoken}`,
    };
  }
  const current = `${spaces.text} · updated ${age.text}`;
  return {
    freshness: 'current',
    text: current,
    summary: current,
    detail: null,
    spoken: `${spaces.spoken}, updated ${age.spoken}`,
  };
}
