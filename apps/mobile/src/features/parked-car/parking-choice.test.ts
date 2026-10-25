import type { Itinerary } from '@hopready/core';

import type { ActiveTrip } from '@/storage';
import { parkAndRideItinerary, planRequest } from '@/test-support/trips';

import { itineraryFollowedToday } from './parking-choice';

// Tuesday 27 October 2026, 7.30 am in Sydney.
const TUESDAY_MORNING_MS = Date.parse('2026-10-26T20:30:00.000Z');

function followed(itinerary: Itinerary): ActiveTrip {
  return { request: planRequest(), itinerary, plannedAt: itinerary.departAt, mode: 'demo' };
}

describe('itineraryFollowedToday', () => {
  it('is the followed trip when it runs today in Sydney', () => {
    const trip = followed(parkAndRideItinerary({ departAt: '2026-10-26T20:40:00.000Z' }));
    expect(itineraryFollowedToday(trip, TUESDAY_MORNING_MS)).toBe(trip.itinerary);
  });

  it('is nothing for a trip followed on another day', () => {
    const trip = followed(parkAndRideItinerary({ departAt: '2026-10-22T20:40:00.000Z' }));
    expect(itineraryFollowedToday(trip, TUESDAY_MORNING_MS)).toBeNull();
  });

  it('counts a trip that left before midnight and arrives today', () => {
    // Leaves at 11.30 pm on Monday and arrives just after midnight.
    const trip = followed(parkAndRideItinerary({ departAt: '2026-10-26T12:30:00.000Z' }));
    expect(itineraryFollowedToday(trip, TUESDAY_MORNING_MS)).toBe(trip.itinerary);
  });

  it('is nothing when no trip is followed', () => {
    expect(itineraryFollowedToday(null, TUESDAY_MORNING_MS)).toBeNull();
  });
});
