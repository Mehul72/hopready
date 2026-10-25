import { fromSydneyWallClock, sydneyOffsetMinutes, sydneyWallClock } from '../time';

// Sydney calendar helpers for the demo timetable, traffic and car park models. Timetables are
// written in local wall-clock time, so a 7.30 am service stays at 7.30 am across daylight saving.
// NSW public holidays are not modelled: they run the normal timetable for their day of the week.

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export type ServiceDay = 'weekday' | 'friday' | 'saturday' | 'sunday';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
// Service days run past midnight; the latest demo trip leaves at 1.25 am, so 4 am bounds them all.
const SERVICE_DAY_END_HOUR = 4;

export function sydneyDateOf(instant: Date | string): CalendarDate {
  const { year, month, day } = sydneyWallClock(instant);
  return { year, month, day };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function dateKey(date: CalendarDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function serviceDayOf(date: CalendarDate): ServiceDay {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  if (weekday === 0) return 'sunday';
  if (weekday === 6) return 'saturday';
  if (weekday === 5) return 'friday';
  return 'weekday';
}

export function isWeekend(day: ServiceDay): boolean {
  return day === 'saturday' || day === 'sunday';
}

export function sydneyMinuteOfDay(instant: Date | string): number {
  const clock = sydneyWallClock(instant);
  return clock.hour * MINUTES_PER_HOUR + clock.minute;
}

export function serviceDayAt(instant: Date | string): ServiceDay {
  return serviceDayOf(sydneyDateOf(instant));
}

// "HH:MM" after the start of a service day. Hours past 23 mean the next morning ("24:45" is 12.45 am).
export function minutesFromClockText(text: string): number {
  const match = /^(\d{2}):([0-5]\d)$/.exec(text);
  if (!match) throw new Error(`Demo timetable time "${text}" is not in HH:MM form`);
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

export interface ServiceDayClock {
  // The instant of a time written as minutes after midnight of the service date, or null when that
  // local time does not exist because clocks went forward.
  instantMs(minutesAfterMidnight: number): number | null;
}

export function serviceDayClock(date: CalendarDate): ServiceDayClock {
  const naiveUtcMs = (minutes: number) => Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const offsetAtStart = sydneyOffsetMinutes(fromSydneyWallClock({ ...date, hour: 0, minute: 0 }));
  const nextDay = addDays(date, 1);
  const offsetAtEnd = sydneyOffsetMinutes(
    fromSydneyWallClock({ ...nextDay, hour: SERVICE_DAY_END_HOUR, minute: 0 }),
  );

  // Most service days keep one offset throughout, so the slower per-time conversion runs only on
  // the few that span a daylight-saving change.
  if (offsetAtStart === offsetAtEnd) {
    return { instantMs: (minutes) => naiveUtcMs(minutes) - offsetAtStart * MS_PER_MINUTE };
  }

  return {
    instantMs(minutes) {
      const wall = new Date(naiveUtcMs(minutes));
      const local = {
        year: wall.getUTCFullYear(),
        month: wall.getUTCMonth() + 1,
        day: wall.getUTCDate(),
        hour: wall.getUTCHours(),
        minute: wall.getUTCMinutes(),
      };
      const instant = fromSydneyWallClock(local);
      const roundTrip = sydneyWallClock(instant);
      const exists =
        roundTrip.day === local.day &&
        roundTrip.hour === local.hour &&
        roundTrip.minute === local.minute;
      return exists ? instant.getTime() : null;
    },
  };
}
