import {
  formatDurationMinutes,
  formatSydneyTime,
  type Itinerary,
  type Leg,
  type ParkingRules,
  secondsBetween,
  type ServiceAlert,
  SYDNEY_TIME_ZONE,
  type TransitLeg,
  type TransitMode,
} from '@hopready/core';

import type { BannerTone } from '@/components';

import { OCCUPANCY_FRESH_MINUTES } from '../shared/occupancy-wording';
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

// Train and metro stations have several ways in and out, unlike bus, light rail and ferry stops.
// Nothing HopReady reads from TfNSW names the one a person uses, and an exit is never guessed.
const STATION_MODES: ReadonlySet<TransitMode> = new Set<TransitMode>(['train', 'metro']);

// Only trains and metros always leave from a platform. A bus, ferry or light rail stop often has
// none, so there a stated stand, wharf or bay is shown and a missing one is not called missing.
export function departurePlatformOf(leg: TransitLeg): string | null {
  return STATION_MODES.has(leg.mode)
    ? describePlatform(leg.departurePlatform)
    : statedPlatform(leg.departurePlatform);
}

// The platform to show after a stop's name, or null when the name already ends with it. The first
// and last steps keep the name the trip was planned with, and a stop picked from search can be a
// platform itself ("Chatswood Station, Platform 1").
export function platformToAdd(stopName: string, platform: string | null): string | null {
  if (platform === null) return null;
  const normalise = (text: string) =>
    text
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .join(', ');
  return normalise(stopName).endsWith(`, ${normalise(platform)}`) ? null : platform;
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

// Sentences a step adds about the steps around it, shown after its own details and read after them.
export type StepNotes = readonly Wording[];

// One entry per leg. `transferBufferMinutes` is the buffer the trip was planned with, or null when
// that is not known, and the change notes then leave it out.
export function describeStepNotes(
  legs: readonly Leg[],
  transferBufferMinutes: number | null,
): StepNotes[] {
  const changes = changeNotes(legs, transferBufferMinutes);
  const stationAccess = stationAccessNotes(legs);
  return legs.map((_, index) =>
    [changes.get(index), stationAccess.get(index)].filter(
      (note): note is Wording => note !== undefined,
    ),
  );
}

// Every two services in a row are a change, as in the planner's transfer check. The note goes on
// the walk or wait that starts the change, or on the service being left when nothing comes between.
function changeNotes(
  legs: readonly Leg[],
  transferBufferMinutes: number | null,
): Map<number, Wording> {
  const services = legs.flatMap((leg, index) => (leg.kind === 'transit' ? [{ leg, index }] : []));
  const notes = new Map<number, Wording>();
  services.forEach((departing, position) => {
    const arriving = services[position - 1];
    if (!arriving) return;
    const between = legs.slice(arriving.index + 1, departing.index);
    const walks = between.some((leg) => leg.kind === 'walk');
    const noteIndex = between.length > 0 ? arriving.index + 1 : arriving.index;
    notes.set(noteIndex, describeChange(arriving.leg, departing.leg, walks, transferBufferMinutes));
  });
  return notes;
}

// The planner holds every change it offers to at least the transfer buffer, walk included, so the
// note shows how much room this one leaves. A trip joined from older times could fall short, and
// then the note says so rather than calling a missed connection tight.
function describeChange(
  arriving: TransitLeg,
  departing: TransitLeg,
  walks: boolean,
  transferBufferMinutes: number | null,
): Wording {
  const place = `Change at ${arriving.to.name}`;
  const windowSeconds = secondsBetween(arriving.end, departing.start);
  if (windowSeconds < 0) {
    const early = duration(-windowSeconds);
    return {
      text: `${place}: the next service is due to leave ${early.text} before this one arrives.`,
      spoken: `${place}: the next service is due to leave ${early.spoken} before this one arrives.`,
    };
  }
  const time = duration(windowSeconds);
  const span = walks ? 'including the walk' : 'between services';
  const text = `${place}: ${time.text} ${span}`;
  const spoken = `${place}: ${time.spoken} ${span}`;
  if (transferBufferMinutes === null) return { text: `${text}.`, spoken: `${spoken}.` };
  if (windowSeconds < transferBufferMinutes * 60) {
    return {
      text: `${text}, shorter than your ${transferBufferMinutes} min transfer buffer.`,
      spoken: `${spoken}, shorter than your ${plural(transferBufferMinutes, 'minute')} transfer buffer.`,
    };
  }
  return {
    text: `${text}; your transfer buffer is ${transferBufferMinutes} min.`,
    spoken: `${spoken}; your transfer buffer is ${plural(transferBufferMinutes, 'minute')}.`,
  };
}

type StationAccess = 'entrance' | 'exit';

// Each way into or out of a station is noted once: on the walk through it, or on the train or
// metro itself when no walk leads in or out, as after a drop-off or before a bus from a stop of
// the same name.
function stationAccessNotes(legs: readonly Leg[]): Map<number, Wording> {
  const passed = new Map<number, StationAccess[]>();
  const pass = (index: number | null, access: StationAccess) => {
    if (index !== null) passed.set(index, [...(passed.get(index) ?? []), access]);
  };
  legs.forEach((leg, index) => {
    if (!isStationService(leg)) return;
    pass(stationAccessStep(legs, index, -1), 'entrance');
    pass(stationAccessStep(legs, index, 1), 'exit');
  });
  const notes = new Map<number, Wording>();
  passed.forEach((accesses, index) => {
    const text = `${missingStationDetails(accesses)} not provided. Follow the station signs.`;
    notes.set(index, { text, spoken: text });
  });
  return notes;
}

// The step that goes through the entrance (-1) or exit (1) of the station served at `index`: the
// walk beside it, or else the service itself. Null when the person changes trains inside, or when
// the trip starts or ends at the station itself and so passes no way in or out at that end.
function stationAccessStep(legs: readonly Leg[], index: number, direction: -1 | 1): number | null {
  const besideIndex = indexBeside(legs, index, direction);
  const beside = legs[besideIndex];
  if (beside === undefined || isStationService(beside)) return null;
  if (beside.kind !== 'walk') return index;
  // A change of platform inside one station passes no entrance or exit.
  const across = legs[indexBeside(legs, besideIndex, direction)];
  return isStationService(across) && beside.from.name === beside.to.name ? null : besideIndex;
}

// Named in the order they are passed: out of one station and into the next on a walk, in and then
// out on a train or metro.
function missingStationDetails(accesses: readonly StationAccess[]): string {
  const named = accesses.join(' and ');
  return `${named.charAt(0).toUpperCase()}${named.slice(1)} details`;
}

// Where the leg before (-1) or after (1) the one at `index` is, looking past a wait at the same stop.
function indexBeside(legs: readonly Leg[], index: number, direction: -1 | 1): number {
  let position = index + direction;
  while (legs[position]?.kind === 'wait') position += direction;
  return position;
}

function isStationService(leg: Leg | undefined): boolean {
  return leg?.kind === 'transit' && STATION_MODES.has(leg.mode);
}

export const ALERT_TONES: Readonly<Record<ServiceAlert['severity'], BannerTone>> = {
  info: 'info',
  warning: 'warning',
  severe: 'error',
};

export const LIVE_TIMES_FRESH_MS = OCCUPANCY_FRESH_MINUTES * 60_000;

// Live times are only called live while they are fresh, by the limit the app already applies to
// car park counts. Returns when they were checked once that is longer ago, or null while fresh.
export function staleCheckOf(checkedAt: string | null, nowMs: number): string | null {
  if (checkedAt === null) return null;
  return nowMs - Date.parse(checkedAt) > LIVE_TIMES_FRESH_MS ? checkedAt : null;
}

// `staleCheckAt`, from staleCheckOf, words live times by when they were checked instead.
export function describeRealtimeCoverage(
  itinerary: Itinerary,
  staleCheckAt: string | null = null,
): Wording | null {
  const hasTransit = itinerary.legs.some((leg) => leg.kind === 'transit');
  if (!hasTransit) return null;
  // Sample times stay labelled as samples, however old they are.
  if (isSampleItinerary(itinerary) && itinerary.realtime !== 'none') {
    return { text: 'Sample live times', spoken: 'Sample times for demo mode, not live.' };
  }
  if (staleCheckAt && itinerary.realtime !== 'none') {
    const time = formatSydneyTime(staleCheckAt);
    return {
      text: `Checked ${time}`,
      spoken: `Public transport times were checked at ${time} and may have changed.`,
    };
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
