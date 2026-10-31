import { formatSydneyTimeOnDay } from '@hopready/core';

import type { Wording } from './occupancy-wording';

// "2:32 pm", or "Mon 2:32 pm" when the time falls on a different Sydney day from `sameDayAs`: the
// time the trip was asked for, the start of the trip, or today. Without the day, an option the
// next morning reads as if it left this afternoon. Six or more days away the date is added too.
export function describeTripTime(instant: string, sameDayAs: string | Date | null): Wording {
  return {
    text: formatSydneyTimeOnDay(instant, sameDayAs),
    spoken: formatSydneyTimeOnDay(instant, sameDayAs, 'long'),
  };
}
