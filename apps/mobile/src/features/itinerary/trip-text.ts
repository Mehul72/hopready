import {
  DEFAULT_PLANNER_LIMITS,
  formatDurationMinutes,
  type Itinerary,
  type Occupancy,
  type ParkingRules,
  secondsBetween,
  type ServiceAlert,
  type Strategy,
  SYDNEY_TIME_ZONE,
  type TransitLeg,
} from '@hopready/core';

import type { BannerTone } from '@/components';

// Plain words for itinerary data. Everything a screen shows about a trip is worded here, so the
// same fact reads the same everywhere, and VoiceOver gets whole words instead of abbreviations.

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
// Occupancy older than this reads as possibly out of date, the same limit the planner applies.
export const OCCUPANCY_FRESH_MINUTES = DEFAULT_PLANNER_LIMITS.occupancyFreshMinutes;
export const SPACES_CAN_FILL_NOTE = 'Spaces can fill before you arrive.';
export const UNKNOWN_RULES_TEXT = 'Check signs for parking rules';
export const PLATFORM_NOT_PROVIDED = 'Platform not provided';

export const STRATEGY_LABELS: Readonly<Record<Strategy, string>> = {
  'transit-only': 'Public transport',
  'park-and-ride': 'Drive and park',
  'drop-off': 'Drop-off',
  'drive-only': 'Drive',
  'return-via-car': 'Back via your car',
  'transit-home': 'Public transport home',
};

export interface Wording {
  text: string;
  spoken: string;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// "49 min" on screen, "49 minutes" for VoiceOver. Under half a minute shows as "under 1 min"
// rather than a misleading zero.
export function duration(seconds: number): Wording {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes === 0) return { text: 'under 1 min', spoken: 'less than a minute' };
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;
  const spokenParts = [
    hours > 0 ? plural(hours, 'hour') : null,
    remainder > 0 ? plural(remainder, 'minute') : null,
  ].filter((part): part is string => part !== null);
  return { text: formatDurationMinutes(seconds), spoken: spokenParts.join(' ') };
}

export function distance(metres: number): Wording {
  const roundedMetres = Math.round(metres / 10) * 10;
  if (roundedMetres < 1_000) {
    return { text: `${roundedMetres} m`, spoken: plural(roundedMetres, 'metre') };
  }
  const tenths = Math.round(metres / 100) / 10;
  const value = tenths < 10 ? tenths.toFixed(1) : String(Math.round(metres / 1_000));
  return { text: `${value} km`, spoken: `${value} kilometres` };
}

export interface OccupancyWording {
  freshness: 'current' | 'stale' | 'unknown';
  // "~120 spaces free · updated 3 min ago", "~40 spaces free when last counted", "Occupancy unknown"
  summary: string;
  // "May be out of date (updated 2 h ago)" for an old count, or why the count is unknown.
  detail: string | null;
  spoken: string;
}

function updatedAgo(ageMinutes: number): Wording {
  if (ageMinutes < 1) return { text: 'updated just now', spoken: 'updated just now' };
  if (ageMinutes < MINUTES_PER_HOUR) {
    return {
      text: `updated ${ageMinutes} min ago`,
      spoken: `updated ${plural(ageMinutes, 'minute')} ago`,
    };
  }
  const hours = Math.floor(ageMinutes / MINUTES_PER_HOUR);
  return { text: `updated ${hours} h ago`, spoken: `updated ${plural(hours, 'hour')} ago` };
}

function spacesFree(count: number): Wording {
  if (count === 0) return { text: 'Full', spoken: 'Full' };
  return {
    text: `~${plural(count, 'space')} free`,
    spoken: `About ${plural(count, 'space')} free`,
  };
}

// Counts are a snapshot from when they were taken, so the age is always shown, and a count older
// than the planner's freshness limit is flagged even if it was fresh when the trip was planned.
export function describeOccupancy(occupancy: Occupancy, nowMs: number): OccupancyWording {
  if (occupancy.status === 'unknown') {
    return {
      freshness: 'unknown',
      summary: 'Occupancy unknown',
      detail: occupancy.reason,
      spoken: `Occupancy unknown. ${occupancy.reason}`,
    };
  }
  const ageMinutes = Math.max(
    0,
    Math.floor((nowMs - new Date(occupancy.observedAt).getTime()) / MS_PER_MINUTE),
  );
  const age = updatedAgo(ageMinutes);
  const spaces = spacesFree(occupancy.spacesAvailable);
  if (occupancy.status === 'stale' || ageMinutes > OCCUPANCY_FRESH_MINUTES) {
    return {
      freshness: 'stale',
      summary: `${spaces.text} when last counted`,
      detail: `May be out of date (${age.text})`,
      spoken: `${spaces.spoken} when last counted. May be out of date, ${age.spoken}.`,
    };
  }
  return {
    freshness: 'current',
    summary: `${spaces.text} · ${age.text}`,
    detail: null,
    spoken: `${spaces.spoken}, ${age.spoken}.`,
  };
}

export interface RulesWording {
  summary: string;
  // Where the rules come from, for a link next to them.
  source: { url: string; label: string } | null;
  spoken: string;
}

const HOST_PATTERN = /^https?:\/\/(?:www\.)?([^/?#:]+)/i;

const checkedOnFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

// "2026-10-25" to "25 Oct 2026". The date has no time of day, so it is read as UTC.
function formatCheckedOn(isoDate: string): string {
  const parts = checkedOnFormatter.formatToParts(new Date(`${isoDate}T00:00:00Z`));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month')} ${read('year')}`;
}

export function describeRules(rules: ParkingRules): RulesWording {
  if (rules.status === 'unknown') {
    return { summary: UNKNOWN_RULES_TEXT, source: null, spoken: `${UNKNOWN_RULES_TEXT}.` };
  }
  const host = HOST_PATTERN.exec(rules.sourceUrl)?.[1] ?? rules.sourceUrl;
  const label = `Source: ${host}, checked ${formatCheckedOn(rules.checkedOn)}`;
  return {
    summary: rules.summary,
    source: { url: rules.sourceUrl, label },
    spoken: `Parking rules: ${rules.summary}`,
  };
}

const BARE_PLATFORM_NUMBER = /^\d{1,3}[A-Z]?$/;

// TfNSW states platforms as "Platform 2" or "Stand A"; demo data and some feeds give just "2".
export function describePlatform(platform: string | null): string {
  if (platform === null || platform.trim() === '') return PLATFORM_NOT_PROVIDED;
  const trimmed = platform.trim();
  return BARE_PLATFORM_NUMBER.test(trimmed) ? `Platform ${trimmed}` : trimmed;
}

export function serviceTitle(leg: TransitLeg): string {
  const { name, headsign } = leg.service;
  return headsign ? `${name} towards ${headsign}` : name;
}

export function stopCount(count: number | null): string | null {
  return count === null ? null : plural(count, 'stop');
}

// Only live legs have a delay to report; a timetable time says nothing about running late.
export function describeDelay(leg: TransitLeg): Wording | null {
  if (leg.timing !== 'realtime') return null;
  const minutes = Math.round(secondsBetween(leg.scheduledStart, leg.start) / 60);
  if (minutes === 0) return { text: 'On time', spoken: 'on time' };
  if (minutes > 0) {
    return { text: `${minutes} min late`, spoken: `${plural(minutes, 'minute')} late` };
  }
  const early = -minutes;
  return { text: `${early} min early`, spoken: `${plural(early, 'minute')} early` };
}

export const ALERT_TONES: Readonly<Record<ServiceAlert['severity'], BannerTone>> = {
  info: 'info',
  warning: 'warning',
  severe: 'error',
};

export function describeRealtimeCoverage(itinerary: Itinerary): Wording | null {
  const hasTransit = itinerary.legs.some((leg) => leg.kind === 'transit');
  if (!hasTransit) return null;
  switch (itinerary.realtime) {
    case 'full':
      return { text: 'Live times', spoken: 'Public transport times are live.' };
    case 'partial':
      return {
        text: 'Some times live',
        spoken: 'Some public transport times are live, others are from the timetable.',
      };
    case 'none':
      return {
        text: 'Timetable times',
        spoken: 'Public transport times are from the timetable, not live.',
      };
  }
}

const sydneyDayFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

// "Sat 24 Oct" in Sydney, built from parts so every JavaScript engine words it the same way.
export function formatSydneyDay(value: string | Date): string {
  const parts = sydneyDayFormatter.formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('weekday')} ${read('day')} ${read('month')}`;
}
