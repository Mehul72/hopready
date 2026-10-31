import { formatSydneyTime, SYDNEY_TIME_ZONE, sydneyDateKey } from '@hopready/core';

import type { Wording } from './occupancy-wording';

const shortWeekday = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TIME_ZONE,
  weekday: 'short',
});
const longWeekday = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TIME_ZONE,
  weekday: 'long',
});

// "2:32 pm", or "Mon 2:32 pm" when the time falls on a different Sydney day from `sameDayAs`: the
// time the trip was asked for, the start of the trip, or today. Without the day, an option the next
// morning reads as if it left this afternoon. The planner keeps options within 12 hours of the time
// asked for, so a weekday is enough.
export function describeTripTime(instant: string, sameDayAs: string | Date | null): Wording {
  const time = formatSydneyTime(instant);
  if (sameDayAs === null || sydneyDateKey(instant) === sydneyDateKey(sameDayAs)) {
    return { text: time, spoken: time };
  }
  const at = new Date(instant);
  return {
    text: `${shortWeekday.format(at)} ${time}`,
    spoken: `${longWeekday.format(at)} ${time}`,
  };
}
