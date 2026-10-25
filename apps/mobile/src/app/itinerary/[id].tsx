import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { ItineraryScreen } from '@/features/itinerary';

// An id from a link is only ever used to look the trip up; anything unusable finds nothing.
const itineraryIdSchema = z.string().trim().min(1).max(128).catch('');

export default function ItineraryRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const itineraryId = itineraryIdSchema.parse(Array.isArray(id) ? id[0] : id);
  return <ItineraryScreen itineraryId={itineraryId} />;
}
