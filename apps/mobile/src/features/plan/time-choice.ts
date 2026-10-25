import {
  formatSydneyTime,
  secondsBetween,
  sydneyDateKey,
  sydneyOffsetMinutes,
  sydneyWallClock,
  SYDNEY_TIME_ZONE,
  toIso,
} from '@hopready/core';

export const TIME_TYPES = ['now', 'depart', 'arrive'] as const;
export type TimeType = (typeof TIME_TYPES)[number];

export const TIME_TYPE_LABELS: Readonly<Record<TimeType, string>> = {
  now: 'Leave now',
  depart: 'Depart at',
  arrive: 'Arrive by',
};

export type TimeChoice = { type: 'now' } | { type: 'depart' | 'arrive'; at: string };

export interface RequestTime {
  type: 'depart' | 'arrive';
  at: string;
}

const MS_PER_MINUTE = 60_000;
// Round numbers are easier to pick and to remember than the minute the picker opened.
const PICKER_STEP_MINUTES = 5;
// Most people choosing "Arrive by" are planning ahead, so the first suggestion is an hour away.
const ARRIVE_BY_LEAD_MINUTES = 60;
// The planner allows a minute of slack, because provider times are whole minutes.
const PAST_GRACE_SECONDS = 60;

// Seconds are dropped first, so 8:30:20 suggests 8:30 rather than jumping to 8:35.
function roundUpToStep(at: Date, stepMinutes: number): string {
  const stepMs = stepMinutes * MS_PER_MINUTE;
  const wholeMinuteMs = Math.floor(at.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return new Date(Math.ceil(wholeMinuteMs / stepMs) * stepMs).toISOString();
}

export function defaultChosenAt(type: 'depart' | 'arrive', now: Date): string {
  const leadMinutes = type === 'arrive' ? ARRIVE_BY_LEAD_MINUTES : 0;
  return roundUpToStep(new Date(now.getTime() + leadMinutes * MS_PER_MINUTE), PICKER_STEP_MINUTES);
}

// Switching between "Depart at" and "Arrive by" keeps the time already picked.
export function changeTimeType(current: TimeChoice, type: TimeType, now: Date): TimeChoice {
  if (type === 'now') return { type: 'now' };
  return { type, at: current.type === 'now' ? defaultChosenAt(type, now) : current.at };
}

export function requestTimeFor(choice: TimeChoice, now: Date): RequestTime {
  return choice.type === 'now' ? { type: 'depart', at: toIso(now) } : choice;
}

export function isTimeInPast(choice: TimeChoice, now: Date): boolean {
  return choice.type !== 'now' && secondsBetween(now, choice.at) < -PAST_GRACE_SECONDS;
}

const sydneyDayFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

function nextDateKey(now: Date): string {
  const today = sydneyWallClock(now);
  // Calendar arithmetic on the date alone, so a 23 or 25 hour daylight-saving day cannot skip one.
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return tomorrow.toISOString().slice(0, 10);
}

// "today", "tomorrow" or "Tue 27 Oct", for the day in Sydney.
export function describeSydneyDay(at: string, now: Date): string {
  const key = sydneyDateKey(at);
  if (key === sydneyDateKey(now)) return 'today';
  if (key === nextDateKey(now)) return 'tomorrow';
  const parts = sydneyDayFormatter.formatToParts(new Date(at));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('weekday')} ${read('day')} ${read('month')}`;
}

// "Leave after 7:45 am", "Arrive by 9:00 am tomorrow".
export function describeRequestTime(time: RequestTime, now: Date): string {
  const day = describeSydneyDay(time.at, now);
  const dayPart = day === 'today' ? '' : day === 'tomorrow' ? ' tomorrow' : `, ${day}`;
  const verb = time.type === 'depart' ? 'Leave after' : 'Arrive by';
  return `${verb} ${formatSydneyTime(time.at)}${dayPart}`;
}

// Times are always Sydney time. Someone whose phone is set to another zone is told so.
export function phoneUsesSydneyTime(now: Date): boolean {
  return -now.getTimezoneOffset() === sydneyOffsetMinutes(now);
}
