// All instants travel as UTC ISO strings. Sydney wall-clock time exists only at the edges:
// talking to TfNSW (which takes local date and time) and showing times to people.

export const SYDNEY_TIME_ZONE = 'Australia/Sydney';

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const sydneyPartsFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function toInstant(value: string | Date): Date {
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Not a valid date-time: ${String(value)}`);
  }
  return instant;
}

export function toIso(value: string | Date): string {
  return toInstant(value).toISOString();
}

export function sydneyWallClock(value: string | Date): WallClock {
  const parts = sydneyPartsFormatter.formatToParts(toInstant(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Intl did not return a ${type} part for ${SYDNEY_TIME_ZONE}`);
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function wallClockAsUtcMs(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
}

export function sydneyOffsetMinutes(value: string | Date): number {
  const instant = toInstant(value);
  const wholeSecondMs = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallClockAsUtcMs(sydneyWallClock(instant)) - wholeSecondMs) / MS_PER_MINUTE);
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

export type Disambiguation = 'earlier' | 'later';

// Converts a Sydney wall-clock time to an instant. When clocks go back (first Sunday in April) a
// time can happen twice, so the caller picks which. When clocks go forward (first Sunday in October)
// a time does not exist; like Temporal's "compatible" mode we move it forward by the gap.
export function fromSydneyWallClock(
  clock: Omit<WallClock, 'second'> & { second?: number },
  disambiguation: Disambiguation = 'earlier',
): Date {
  const wall: WallClock = { ...clock, second: clock.second ?? 0 };
  const naiveUtcMs = wallClockAsUtcMs(wall);
  const offsetsToTry = [
    sydneyOffsetMinutes(new Date(naiveUtcMs - MS_PER_DAY)),
    sydneyOffsetMinutes(new Date(naiveUtcMs + MS_PER_DAY)),
  ];
  const matches = [...new Set(offsetsToTry)]
    .map((offsetMinutes) => new Date(naiveUtcMs - offsetMinutes * MS_PER_MINUTE))
    .filter((candidate) => sameWallClock(sydneyWallClock(candidate), wall))
    .sort((a, b) => a.getTime() - b.getTime());

  if (matches.length > 0) {
    return disambiguation === 'earlier' ? matches[0]! : matches[matches.length - 1]!;
  }

  const offsetBeforeGap = Math.min(...offsetsToTry);
  return new Date(naiveUtcMs - offsetBeforeGap * MS_PER_MINUTE);
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

// TfNSW Trip Planner takes local date (YYYYMMDD) and time (HHMM) parameters.
export function toTfnswDateTime(value: string | Date): { itdDate: string; itdTime: string } {
  const clock = sydneyWallClock(value);
  return {
    itdDate: `${clock.year}${pad(clock.month)}${pad(clock.day)}`,
    itdTime: `${pad(clock.hour)}${pad(clock.minute)}`,
  };
}

export function addMinutes(value: string | Date, minutes: number): string {
  return new Date(toInstant(value).getTime() + minutes * MS_PER_MINUTE).toISOString();
}

export function addSeconds(value: string | Date, seconds: number): string {
  return new Date(toInstant(value).getTime() + seconds * 1000).toISOString();
}

export function secondsBetween(from: string | Date, to: string | Date): number {
  return Math.round((toInstant(to).getTime() - toInstant(from).getTime()) / 1000);
}

export function isBefore(a: string | Date, b: string | Date): boolean {
  return toInstant(a).getTime() < toInstant(b).getTime();
}

export function laterOf(a: string, b: string): string {
  return isBefore(a, b) ? b : a;
}

const sydneyTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

// "8:05 am" in Sydney time, whatever time zone the device is in.
export function formatSydneyTime(value: string | Date): string {
  return sydneyTimeFormatter.format(toInstant(value)).replace(/\u202f|\s/g, '\u00a0');
}

export function sydneyDateKey(value: string | Date): string {
  const clock = sydneyWallClock(value);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

export function formatDurationMinutes(totalSeconds: number): string {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

const MS_PER_FLOOR_MINUTE = 60_000;

// TfNSW works in whole minutes. Rounding a "leave after" time up and an "arrive by" time down
// keeps legs from overlapping by a few seconds after the round trip through the provider.
export function ceilToMinute(value: string | Date): string {
  const ms = toInstant(value).getTime();
  return new Date(Math.ceil(ms / MS_PER_FLOOR_MINUTE) * MS_PER_FLOOR_MINUTE).toISOString();
}

export function floorToMinute(value: string | Date): string {
  const ms = toInstant(value).getTime();
  return new Date(Math.floor(ms / MS_PER_FLOOR_MINUTE) * MS_PER_FLOOR_MINUTE).toISOString();
}
