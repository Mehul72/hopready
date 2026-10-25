import { describe, expect, it, vi } from 'vitest';

import {
  addressRateLimitKey,
  parseInstallId,
  SlidingWindowRateLimiter,
  WorkersRateLimiter,
  type RateLimitBinding,
} from './rate-limit';
import { never, testClock } from './test-support/fakes';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit in any 60 seconds and says when the oldest request expires', async () => {
    const clock = testClock();
    const limiter = new SlidingWindowRateLimiter({ clock });

    for (let request = 1; request <= 20; request += 1) {
      expect(await limiter.check('plan', 'install:a')).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
      clock.advanceMs(500);
    }
    expect(await limiter.check('plan', 'install:a')).toEqual({
      allowed: false,
      retryAfterSeconds: 50,
    });

    clock.advanceMs(50_000);
    expect((await limiter.check('plan', 'install:a')).allowed).toBe(true);
  });

  it('counts each policy and each key separately', async () => {
    const clock = testClock();
    const limiter = new SlidingWindowRateLimiter({
      clock,
      rules: {
        plan: { limit: 1, periodSeconds: 60 },
        places: { limit: 1, periodSeconds: 60 },
        carparks: { limit: 1, periodSeconds: 60 },
        ip: { limit: 1, periodSeconds: 60 },
      },
    });

    expect((await limiter.check('plan', 'install:a')).allowed).toBe(true);
    expect((await limiter.check('plan', 'install:a')).allowed).toBe(false);
    expect((await limiter.check('places', 'install:a')).allowed).toBe(true);
    expect((await limiter.check('plan', 'install:b')).allowed).toBe(true);
  });

  it('forgets the least recently seen keys beyond its tracking limit', async () => {
    const clock = testClock();
    const limiter = new SlidingWindowRateLimiter({
      clock,
      maxTrackedKeys: 2,
      rules: {
        plan: { limit: 1, periodSeconds: 60 },
        places: { limit: 1, periodSeconds: 60 },
        carparks: { limit: 1, periodSeconds: 60 },
        ip: { limit: 1, periodSeconds: 60 },
      },
    });

    await limiter.check('plan', 'first');
    await limiter.check('plan', 'second');
    await limiter.check('plan', 'third');

    expect((await limiter.check('plan', 'third')).allowed).toBe(false);
    expect((await limiter.check('plan', 'first')).allowed).toBe(true);
  });
});

describe('WorkersRateLimiter', () => {
  it('uses the binding for the policy and answers Retry-After with the full period', async () => {
    const binding = (success: boolean): RateLimitBinding => ({
      limit: vi.fn(async () => ({ success })),
    });
    const plan = binding(false);
    const places = binding(true);
    const limiter = new WorkersRateLimiter({
      bindings: { plan, places, carparks: binding(true), ip: binding(true) },
      onLateOutcome: vi.fn(),
    });

    expect(await limiter.check('plan', 'install:a')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(await limiter.check('places', 'install:a')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(plan.limit).toHaveBeenCalledWith({ key: 'install:a' });
  });

  it('gives up on a binding that does not answer, so the app can let the request through', async () => {
    const stuck: RateLimitBinding = { limit: () => never() };
    const limiter = new WorkersRateLimiter({
      bindings: { plan: stuck, places: stuck, carparks: stuck, ip: stuck },
      onLateOutcome: vi.fn(),
      timeoutMs: 20,
    });

    await expect(limiter.check('plan', 'install:a')).rejects.toMatchObject({
      name: 'DeadlineExceededError',
    });
  });
});

describe('parseInstallId', () => {
  it('accepts a version 4 UUID in any case and normalises it', () => {
    expect(parseInstallId(' 3F0C8A52-6B1E-4D3A-9C7E-2B5D8F1A4E60 ')).toEqual({
      status: 'valid',
      id: '3f0c8a52-6b1e-4d3a-9c7e-2b5d8f1a4e60',
    });
  });

  it('rejects other UUID versions and anything that is not a UUID', () => {
    expect(parseInstallId('3f0c8a52-6b1e-1d3a-9c7e-2b5d8f1a4e60').status).toBe('invalid');
    expect(parseInstallId('3f0c8a52-6b1e-4d3a-7c7e-2b5d8f1a4e60').status).toBe('invalid');
    expect(parseInstallId('').status).toBe('invalid');
    expect(parseInstallId('install-1').status).toBe('invalid');
  });

  it('reports a missing header as absent', () => {
    expect(parseInstallId(undefined)).toEqual({ status: 'absent' });
  });
});

describe('addressRateLimitKey', () => {
  it('keys IPv4 addresses as they are, including IPv4 mapped into IPv6', () => {
    expect(addressRateLimitKey('203.0.113.7')).toBe('ip:203.0.113.7');
    expect(addressRateLimitKey('::ffff:203.0.113.7')).toBe('ip:203.0.113.7');
  });

  it('keys IPv6 addresses by their /64', () => {
    expect(addressRateLimitKey('2001:db8:85a3:12:8a2e:370:7334:1')).toBe('ip6:2001:db8:85a3:12');
    expect(addressRateLimitKey('2001:DB8:85A3:0012::1')).toBe('ip6:2001:db8:85a3:12');
    expect(addressRateLimitKey('2001:db8::1')).toBe('ip6:2001:db8:0:0');
    expect(addressRateLimitKey('fe80::1%en0')).toBe('ip6:fe80:0:0:0');
    expect(addressRateLimitKey('::1')).toBe('ip6:0:0:0:0');
  });

  it('puts clients with no known address in one shared bucket', () => {
    expect(addressRateLimitKey(null)).toBe('ip:unknown');
    expect(addressRateLimitKey('')).toBe('ip:unknown');
  });
});
