import {
  ProviderError,
  systemClock,
  type Clock,
  type DrivingProvider,
  type PlaceSearchProvider,
} from '@hopready/core';
import { z } from 'zod';

import type { FetchImplementation } from '../http';
import { createAppleMapsClient } from './client';
import { createAppleDrivingProvider } from './driving';
import { createApplePlaceSearch } from './places';
import { AppleMapsTokenSource } from './token';

export interface AppleMapsOptions {
  // The 10-character Team ID from the Apple Developer account.
  teamId: string;
  // The 10-character Key ID of the Maps private key.
  keyId: string;
  // Contents of the .p8 file. A one-line secret with literal "\n" sequences is accepted.
  privateKey: string;
  fetchImpl?: FetchImplementation;
  clock?: Clock;
}

export interface AppleMapsProviders {
  driving: DrivingProvider;
  places: PlaceSearchProvider;
}

const APPLE_TEN_CHARACTER_ID = /^[A-Z0-9]{10}$/;

const credentialsSchema = z.object({
  teamId: z.string().trim().regex(APPLE_TEN_CHARACTER_ID),
  keyId: z.string().trim().regex(APPLE_TEN_CHARACTER_ID),
  privateKey: z.string().trim().min(1),
});

// Both providers share one token source, so the process holds a single Apple access token.
// Bad IDs throw 'not-configured' here; an unreadable key can only fail later, on each call.
export function createAppleMapsProviders(options: AppleMapsOptions): AppleMapsProviders {
  const credentials = credentialsSchema.safeParse(options);
  if (!credentials.success) {
    const fields = credentials.error.issues.map((issue) => issue.path.map(String).join('.'));
    throw new ProviderError(
      'apple-maps',
      'not-configured',
      `Apple Maps credentials are missing or malformed: ${[...new Set(fields)].join(', ')}`,
    );
  }

  const tokens = new AppleMapsTokenSource({
    credentials: credentials.data,
    fetchImpl: options.fetchImpl,
    clock: options.clock ?? systemClock,
  });
  const client = createAppleMapsClient(tokens, options.fetchImpl);
  return { driving: createAppleDrivingProvider(client), places: createApplePlaceSearch(client) };
}
