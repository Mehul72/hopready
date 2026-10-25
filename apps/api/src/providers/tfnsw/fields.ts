import { coordinateSchema, type Coordinate } from '@hopready/core';

// Small readers for TfNSW fields that arrive in more than one form.

export function nonEmptyText(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

// TfNSW coordinate pairs are [latitude, longitude].
export function coordinateFromLatLon(
  pair: readonly unknown[] | null | undefined,
): Coordinate | null {
  if (!pair) return null;
  const parsed = coordinateSchema.safeParse({ lat: pair[0], lon: pair[1] });
  return parsed.success ? parsed.data : null;
}

export function hasStatus(
  statuses: string | readonly string[] | null | undefined,
  token: string,
): boolean {
  if (!statuses) return false;
  const tokens = typeof statuses === 'string' ? statuses.split(/[\s,]+/) : statuses;
  return tokens.includes(token);
}
