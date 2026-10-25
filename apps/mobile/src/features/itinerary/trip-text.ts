import {
  formatDurationMinutes,
  type Itinerary,
  type ParkingRules,
  secondsBetween,
  type ServiceAlert,
  SYDNEY_TIME_ZONE,
  type TransitLeg,
} from '@hopready/core';

import type { BannerTone } from '@/components';

import { isSampleItinerary, isSampleLeg } from '../shared/sample-data';

// Plain words for itinerary data. Everything a screen shows about a trip is worded here, so the
// same fact reads the same everywhere, and VoiceOver gets whole words instead of abbreviations.

const MINUTES_PER_HOUR = 60;
export const UNKNOWN_RULES_TEXT = 'Check signs for parking rules';
export const PLATFORM_NOT_PROVIDED = 'Platform not provided';

export { STRATEGY_LABELS } from '../shared/option-labels';

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
export function statedPlatform(platform: string | null): string | null {
  const trimmed = platform?.trim() ?? '';
  if (trimmed === '') return null;
  return BARE_PLATFORM_NUMBER.test(trimmed) ? `Platform ${trimmed}` : trimmed;
}

// People need the departure platform to board, so a missing one is said rather than left out.
export function describePlatform(platform: string | null): string {
  return statedPlatform(platform) ?? PLATFORM_NOT_PROVIDED;
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
  const delay = liveDelay(leg);
  return isSampleLeg(leg)
    ? { text: `${delay.text} (sample)`, spoken: `${delay.spoken} in the sample data` }
    : delay;
}

function liveDelay(leg: TransitLeg): Wording {
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
  if (isSampleItinerary(itinerary) && itinerary.realtime !== 'none') {
    return { text: 'Sample live times', spoken: 'Sample times for demo mode, not live.' };
  }
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
