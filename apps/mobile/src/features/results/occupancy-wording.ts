import { type Occupancy, secondsBetween } from '@hopready/core';

export const SPACES_CAN_FILL_NOTE = 'Spaces can fill before you arrive.';

export interface Wording {
  // What the screen shows, in the short forms the app uses ("3 min ago").
  text: string;
  // The same for VoiceOver, with units written out ("3 minutes ago").
  spoken: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
// Below this, hours read better than days ("30 h ago" is clearer than "1 day ago").
const DAYS_FROM_HOURS = 48;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// How long ago a count was taken. A time ahead of the phone's clock reads as "just now".
export function describeAge(observedAt: string, now: Date): Wording {
  const minutes = Math.floor(Math.max(0, secondsBetween(observedAt, now)) / SECONDS_PER_MINUTE);
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

// Occupancy as a person should read it: approximate, with its age, and never a guess when the
// count is missing.
export function describeOccupancy(occupancy: Occupancy, now: Date): Wording {
  if (occupancy.status === 'unknown') {
    return { text: 'Occupancy unknown', spoken: 'Occupancy unknown' };
  }
  const spaces = describeSpaces(occupancy.spacesAvailable);
  const age = describeAge(occupancy.observedAt, now);
  if (occupancy.status === 'stale') {
    return {
      text: `${spaces.text} · May be out of date (updated ${age.text})`,
      spoken: `${spaces.spoken}, but this may be out of date. Updated ${age.spoken}`,
    };
  }
  return {
    text: `${spaces.text} · updated ${age.text}`,
    spoken: `${spaces.spoken}, updated ${age.spoken}`,
  };
}
