import type { RateLimit } from '@cloudflare/workers-types';
import type { Clock } from '@hopready/core';

import { runWithDeadline, type LateOutcomeHandler } from './deadline';

export const RATE_LIMIT_POLICIES = ['plan', 'places', 'carparks', 'ip'] as const;
export type RateLimitPolicy = (typeof RATE_LIMIT_POLICIES)[number];

export interface RateLimitRule {
  limit: number;
  periodSeconds: number;
}

// The Workers bindings in wrangler.jsonc carry the same numbers; a test keeps the two in step.
export const RATE_LIMIT_RULES: Readonly<Record<RateLimitPolicy, RateLimitRule>> = {
  plan: { limit: 20, periodSeconds: 60 },
  places: { limit: 60, periodSeconds: 60 },
  carparks: { limit: 30, periodSeconds: 60 },
  // Coarse backstop per address. Many phones can share one carrier address, so it stays generous.
  ip: { limit: 120, periodSeconds: 60 },
};

// Names of the Workers Rate Limiting bindings in wrangler.jsonc, one per policy.
export const RATE_LIMIT_BINDING_NAMES = {
  plan: 'PLAN_RATE_LIMITER',
  places: 'PLACES_RATE_LIMITER',
  carparks: 'CARPARKS_RATE_LIMITER',
  ip: 'IP_RATE_LIMITER',
} as const satisfies Record<RateLimitPolicy, string>;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision>;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

// Sliding window log kept in memory, for the Node server and tests. Each key remembers when its
// recent requests were allowed; least recently seen keys are dropped first when too many are tracked.
export class SlidingWindowRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #rules: Readonly<Record<RateLimitPolicy, RateLimitRule>>;
  readonly #maxTrackedKeys: number;
  readonly #windows = new Map<string, number[]>();

  constructor(options: {
    clock: Clock;
    rules?: Readonly<Record<RateLimitPolicy, RateLimitRule>>;
    maxTrackedKeys?: number;
  }) {
    this.#clock = options.clock;
    this.#rules = options.rules ?? RATE_LIMIT_RULES;
    this.#maxTrackedKeys = options.maxTrackedKeys ?? 10_000;
  }

  async check(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision> {
    const rule = this.#rules[policy];
    const windowMs = rule.periodSeconds * 1000;
    const nowMs = this.#clock.now().getTime();
    const windowKey = `${policy}\u0000${key}`;

    const allowedAt = (this.#windows.get(windowKey) ?? []).filter(
      (timestampMs) => timestampMs > nowMs - windowMs,
    );
    // Re-inserting moves the key to the end, so the map's first keys are the least recently seen.
    this.#windows.delete(windowKey);

    const oldest = allowedAt[0];
    if (allowedAt.length >= rule.limit && oldest !== undefined) {
      this.#windows.set(windowKey, allowedAt);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)),
      };
    }

    allowedAt.push(nowMs);
    this.#windows.set(windowKey, allowedAt);
    this.#forgetLeastRecentKeys();
    return ALLOWED;
  }

  #forgetLeastRecentKeys() {
    for (const windowKey of this.#windows.keys()) {
      if (this.#windows.size <= this.#maxTrackedKeys) return;
      this.#windows.delete(windowKey);
    }
  }
}

export type RateLimitBinding = Pick<RateLimit, 'limit'>;

// The binding answers from a cache in the same location, so a slow answer means something is wrong.
const BINDING_TIMEOUT_MS = 1_000;

// Adapter for the Workers Rate Limiting binding. Its counts are per Cloudflare location and
// approximate, and it does not say when a key frees up, so Retry-After is the full period.
export class WorkersRateLimiter implements RateLimiter {
  readonly #bindings: Readonly<Record<RateLimitPolicy, RateLimitBinding>>;
  readonly #onLateOutcome: LateOutcomeHandler;
  readonly #rules: Readonly<Record<RateLimitPolicy, RateLimitRule>>;
  readonly #timeoutMs: number;

  constructor(options: {
    bindings: Readonly<Record<RateLimitPolicy, RateLimitBinding>>;
    onLateOutcome: LateOutcomeHandler;
    rules?: Readonly<Record<RateLimitPolicy, RateLimitRule>>;
    timeoutMs?: number;
  }) {
    this.#bindings = options.bindings;
    this.#onLateOutcome = options.onLateOutcome;
    this.#rules = options.rules ?? RATE_LIMIT_RULES;
    this.#timeoutMs = options.timeoutMs ?? BINDING_TIMEOUT_MS;
  }

  async check(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision> {
    const outcome = await runWithDeadline(() => this.#bindings[policy].limit({ key }), {
      deadlineMs: this.#timeoutMs,
      onLateOutcome: this.#onLateOutcome,
    });
    return outcome.success
      ? ALLOWED
      : { allowed: false, retryAfterSeconds: this.#rules[policy].periodSeconds };
  }
}

export const INSTALL_HEADER = 'X-HopReady-Install';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InstallId =
  { status: 'absent' } | { status: 'invalid' } | { status: 'valid'; id: string };

export function parseInstallId(header: string | undefined): InstallId {
  if (header === undefined) return { status: 'absent' };
  const candidate = header.trim();
  return UUID_V4.test(candidate)
    ? { status: 'valid', id: candidate.toLowerCase() }
    : { status: 'invalid' };
}

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV6_PREFIX_HEXTETS = 4;

// Rate limits apply per IPv4 address and per IPv6 /64, since one device usually holds a whole /64.
export function addressRateLimitKey(address: string | null): string {
  if (!address) return 'ip:unknown';
  const withoutZone = address.trim().toLowerCase().split('%')[0] ?? '';
  if (withoutZone.startsWith(IPV4_MAPPED_PREFIX) && withoutZone.includes('.')) {
    return `ip:${withoutZone.slice(IPV4_MAPPED_PREFIX.length)}`;
  }
  if (!withoutZone.includes(':')) return `ip:${withoutZone}`;
  return `ip6:${ipv6Prefix(withoutZone)}`;
}

function ipv6Prefix(address: string): string {
  const [head = '', tail] = address.split('::', 2);
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const hextets =
    tail === undefined
      ? headParts
      : [...headParts, ...Array<string>(missing).fill('0'), ...tailParts];
  return hextets
    .slice(0, IPV6_PREFIX_HEXTETS)
    .map((part) => part.replace(/^0+(?=.)/, ''))
    .join(':');
}
