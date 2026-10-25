import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateGate, RateGateFullError } from './rate-gate';
import { neverAborted } from './test-support';

const START_MS = Date.parse('2026-10-25T21:00:00Z');

function busiestSecond(startTimesMs: readonly number[]): number {
  return Math.max(
    ...startTimesMs.map(
      (windowStartMs) =>
        startTimesMs.filter((ms) => ms >= windowStartMs && ms < windowStartMs + 1_000).length,
    ),
  );
}

describe('RateGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never starts more than N requests in any one second, even in a burst', async () => {
    const gate = new RateGate({ requestsPerSecond: 5, maxQueueMs: 60_000 });
    const startTimesMs: number[] = [];
    const waits = Array.from({ length: 23 }, () =>
      gate.acquire(neverAborted()).then(() => {
        startTimesMs.push(Date.now());
      }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(waits);

    expect(startTimesMs).toHaveLength(23);
    expect(busiestSecond(startTimesMs)).toBe(5);
    expect(startTimesMs.slice(0, 5)).toEqual(Array(5).fill(START_MS));
    expect(Math.max(...startTimesMs) - START_MS).toBeLessThan(5_000);
  });

  it('keeps to the limit when requests arrive spread out', async () => {
    const gate = new RateGate({ requestsPerSecond: 3, maxQueueMs: 60_000 });
    const startTimesMs: number[] = [];
    const waits: Promise<void>[] = [];
    const arrive = (count: number) => {
      for (let index = 0; index < count; index++) {
        waits.push(gate.acquire(neverAborted()).then(() => void startTimesMs.push(Date.now())));
      }
    };

    arrive(2);
    await vi.advanceTimersByTimeAsync(400);
    arrive(3);
    await vi.advanceTimersByTimeAsync(700);
    arrive(4);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(waits);

    expect(startTimesMs).toHaveLength(9);
    expect(busiestSecond(startTimesMs)).toBeLessThanOrEqual(3);
  });

  it('lets an aborted caller leave the queue at once and hands its slot to the next caller', async () => {
    const gate = new RateGate({ requestsPerSecond: 1 });
    await gate.acquire(neverAborted());

    const controller = new AbortController();
    const abandoned = gate.acquire(controller.signal);
    const abandonedOutcome = abandoned.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    const reason = await abandonedOutcome;
    expect(reason).toBeInstanceOf(DOMException);
    expect((reason as DOMException).name).toBe('AbortError');
    expect(Date.now()).toBe(START_MS + 100);

    let nextStartedAtMs = 0;
    const next = gate.acquire(neverAborted()).then(() => {
      nextStartedAtMs = Date.now();
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await next;
    expect(nextStartedAtMs).toBe(START_MS + 1_100);
  });

  it('rejects straight away when the signal has already aborted, without taking a slot', async () => {
    const gate = new RateGate({ requestsPerSecond: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(gate.acquire(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(gate.acquire(neverAborted())).resolves.toBeUndefined();
  });

  it('turns callers away when the wait would be longer than maxQueueMs', async () => {
    const gate = new RateGate({ requestsPerSecond: 1, maxQueueMs: 2_000 });
    const first = gate.acquire(neverAborted());
    const second = gate.acquire(neverAborted());

    await expect(gate.acquire(neverAborted())).rejects.toBeInstanceOf(RateGateFullError);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('holds every request until a Retry-After has passed', async () => {
    const gate = new RateGate({ requestsPerSecond: 5 });
    gate.holdFor(1_500);
    let startedAtMs = 0;
    const waiting = gate.acquire(neverAborted()).then(() => {
      startedAtMs = Date.now();
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await waiting;
    expect(startedAtMs).toBe(START_MS + 1_500);
  });

  it('fails fast while a Retry-After hold is longer than the queue allows', async () => {
    const gate = new RateGate({ requestsPerSecond: 5, maxQueueMs: 3_000 });
    gate.holdFor(30_000);

    await expect(gate.acquire(neverAborted())).rejects.toBeInstanceOf(RateGateFullError);
  });

  it.each([0, -1, 2.5, Number.NaN])('refuses a rate of %s requests per second', (rate) => {
    expect(() => new RateGate({ requestsPerSecond: rate })).toThrow(RangeError);
  });
});
