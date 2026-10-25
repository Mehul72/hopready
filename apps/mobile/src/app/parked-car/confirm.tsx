import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { ConfirmParkingScreen } from '@/features/parked-car';

// Route parameters can come from any link, so they are checked like other outside input.
const confirmParamsSchema = z.object({
  itineraryId: z.string().trim().min(1).max(128).nullable().catch(null),
  choice: z.enum(['parked', 'dropped-off']).catch('parked'),
});

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ?? null;
}

// Opened as /parked-car/confirm, optionally with ?itineraryId=<trip>&choice=dropped-off.
export default function ConfirmParkingRoute() {
  const params = useLocalSearchParams<{
    itineraryId?: string | string[];
    choice?: string | string[];
  }>();
  const { itineraryId, choice } = confirmParamsSchema.parse({
    itineraryId: firstParam(params.itineraryId),
    choice: firstParam(params.choice),
  });
  return <ConfirmParkingScreen itineraryId={itineraryId} initialArrival={choice} />;
}
