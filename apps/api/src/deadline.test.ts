import { ProviderError } from '@hopready/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callProvider, DeadlineExceededError, runWithDeadline, toProviderError } from './deadline';
import { never, untilAborted } from './test-support/fakes';

describe('runWithDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result of a task that finishes in time', async () => {
    const result = runWithDeadline(async () => 'done', { deadlineMs: 100, onLateOutcome: vi.fn() });
    await expect(result).resolves.toBe('done');
  });

  it('gives up at the deadline on a task that never settles', async () => {
    const onLateOutcome = vi.fn();
    const result = runWithDeadline(() => never(), { deadlineMs: 100, onLateOutcome });
    const settled = expect(result).rejects.toBeInstanceOf(DeadlineExceededError);

    await vi.advanceTimersByTimeAsync(99);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(onLateOutcome).not.toHaveBeenCalled();
  });

  it('aborts the task early by the settle time so it can return what it has', async () => {
    let abortedAtMs: number | null = null;
    const result = runWithDeadline(
      async (signal) => {
        await untilAborted(signal).catch(() => {
          abortedAtMs = Date.now();
        });
        return 'partial';
      },
      { deadlineMs: 1_000, settleMs: 200, onLateOutcome: vi.fn() },
    );
    const startedAtMs = Date.now();

    await vi.advanceTimersByTimeAsync(800);
    await expect(result).resolves.toBe('partial');
    expect(abortedAtMs).toBe(startedAtMs + 800);
  });

  it('reports what a task did after the caller stopped waiting', async () => {
    const onLateOutcome = vi.fn();
    const result = runWithDeadline(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('late failure')), 150);
        }),
      { deadlineMs: 100, onLateOutcome },
    );
    const settled = expect(result).rejects.toBeInstanceOf(DeadlineExceededError);

    await vi.advanceTimersByTimeAsync(100);
    await settled;
    await vi.advanceTimersByTimeAsync(50);
    expect(onLateOutcome).toHaveBeenCalledWith({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'late failure' }),
    });
  });

  it("passes the caller's abort on to the task", async () => {
    const caller = new AbortController();
    const result = runWithDeadline((signal) => untilAborted(signal), {
      deadlineMs: 1_000,
      signal: caller.signal,
      onLateOutcome: vi.fn(),
    });
    const settled = expect(result).rejects.toMatchObject({ name: 'AbortError' });

    caller.abort(new DOMException('client went away', 'AbortError'));
    await settled;
  });

  it('rejects straight away when the task throws before returning a promise', async () => {
    const result = runWithDeadline(
      () => {
        throw new RangeError('bad input');
      },
      { deadlineMs: 100, onLateOutcome: vi.fn() },
    );
    await expect(result).rejects.toBeInstanceOf(RangeError);
  });
});

describe('toProviderError', () => {
  it('keeps a ProviderError as it is', () => {
    const error = new ProviderError('apple-maps', 'rejected-request', 'bad request', {
      status: 400,
    });
    expect(toProviderError(error, 'tfnsw-trip-planner')).toBe(error);
  });

  it('turns deadlines and aborts into timeouts, and anything else into unavailable', () => {
    expect(toProviderError(new DeadlineExceededError(5), 'apple-maps').failure).toBe('timeout');
    expect(toProviderError(new DOMException('stop', 'TimeoutError'), 'apple-maps').failure).toBe(
      'timeout',
    );
    const unexpected = toProviderError(new TypeError('boom'), 'apple-maps');
    expect(unexpected).toMatchObject({ provider: 'apple-maps', failure: 'unavailable' });
    expect(unexpected.cause).toBeInstanceOf(TypeError);
  });
});

describe('callProvider', () => {
  it('fails a hanging provider with a timeout ProviderError', async () => {
    const result = callProvider('apple-maps', () => never(), {
      timeoutMs: 20,
      onLateOutcome: vi.fn(),
    });
    await expect(result).rejects.toMatchObject({ provider: 'apple-maps', failure: 'timeout' });
  });
});
