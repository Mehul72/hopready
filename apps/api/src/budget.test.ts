import { ProviderError } from '@hopready/core';
import { describe, expect, it, vi } from 'vitest';

import {
  budgetDayKey,
  DailyCallBudget,
  MAX_CALLS_PER_LEDGER_REPORT,
  secondsUntilNextBudgetDay,
  type BudgetLedger,
  type BudgetName,
} from './budget';
import { budgetedFetch } from './composition';
import { budgetInterceptor, interceptTransit } from './provider-set';
import { fakeTransit, parramattaToWynyard, planRequest, testClock } from './test-support/fakes';

function budget(options: { dailyLimit: number; ledger?: BudgetLedger | null }) {
  const clock = testClock();
  const onLedgerError = vi.fn();
  const onExhausted = vi.fn();
  const subject = new DailyCallBudget({
    name: 'tfnsw',
    dailyLimit: options.dailyLimit,
    clock,
    ledger: options.ledger ?? null,
    onLedgerError,
    onExhausted,
  });
  return { subject, clock, onLedgerError, onExhausted };
}

// A ledger kept in a map, standing in for the ProviderBudget Durable Object.
function memoryLedger(initial: Record<string, number> = {}) {
  const totals = new Map(Object.entries(initial));
  const reports: { budget: BudgetName; dayKey: string; calls: number }[] = [];
  const ledger: BudgetLedger = {
    add: vi.fn(async (budgetName: BudgetName, dayKey: string, calls: number) => {
      reports.push({ budget: budgetName, dayKey, calls });
      const key = `${budgetName}:${dayKey}`;
      const total = (totals.get(key) ?? 0) + calls;
      totals.set(key, total);
      return total;
    }),
  };
  return { ledger, reports };
}

async function useOnce(subject: DailyCallBudget, requests = 1) {
  await subject.ensureAvailable('tfnsw-trip-planner');
  for (let request = 0; request < requests; request += 1) subject.recordRequest();
}

describe('budget days', () => {
  it('run on UTC dates', () => {
    expect(budgetDayKey(new Date('2026-10-26T20:30:00Z'))).toBe('2026-10-26');
    expect(secondsUntilNextBudgetDay(new Date('2026-10-26T20:30:00Z'))).toBe(12_600);
    expect(secondsUntilNextBudgetDay(new Date('2026-10-26T23:59:59.500Z'))).toBe(1);
  });
});

describe('DailyCallBudget without a ledger', () => {
  it('allows calls until the day has used the limit, then fails fast as rate-limited', async () => {
    const { subject, onExhausted } = budget({ dailyLimit: 3 });

    await useOnce(subject);
    await useOnce(subject);
    await useOnce(subject);
    const refused = subject.ensureAvailable('tfnsw-car-park');

    await expect(refused).rejects.toBeInstanceOf(ProviderError);
    await expect(refused).rejects.toMatchObject({
      provider: 'tfnsw-car-park',
      failure: 'rate-limited',
      retryAfterSeconds: 12_600,
    });
    await expect(subject.ensureAvailable('tfnsw-trip-planner')).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(subject.usedToday()).toBe(3);
  });

  it('counts every request a call sends, such as one per car park', async () => {
    const { subject } = budget({ dailyLimit: 5 });

    await useOnce(subject, 4);
    await useOnce(subject, 3);

    expect(subject.usedToday()).toBe(7);
    await expect(subject.ensureAvailable('tfnsw-car-park')).rejects.toMatchObject({
      failure: 'rate-limited',
    });
  });

  it('starts again on the next UTC day', async () => {
    const { subject, clock } = budget({ dailyLimit: 1 });
    await useOnce(subject);
    await expect(subject.ensureAvailable('tfnsw-trip-planner')).rejects.toBeInstanceOf(
      ProviderError,
    );

    clock.set('2026-10-27T00:00:01.000Z');
    await expect(subject.ensureAvailable('tfnsw-trip-planner')).resolves.toBeUndefined();
    expect(subject.usedToday()).toBe(0);
  });
});

describe('DailyCallBudget with a shared ledger', () => {
  it('learns the shared total before its first check of the day', async () => {
    const { ledger } = memoryLedger({ 'tfnsw:2026-10-26': 5 });
    const { subject } = budget({ dailyLimit: 5, ledger });

    await expect(subject.ensureAvailable('tfnsw-trip-planner')).rejects.toMatchObject({
      failure: 'rate-limited',
    });
  });

  it('syncs once however many checks arrive together', async () => {
    const { ledger } = memoryLedger();
    const { subject } = budget({ dailyLimit: 100, ledger });

    await Promise.all([
      subject.ensureAvailable('tfnsw-trip-planner'),
      subject.ensureAvailable('tfnsw-trip-planner'),
      subject.ensureAvailable('tfnsw-car-park'),
    ]);

    expect(ledger.add).toHaveBeenCalledTimes(1);
    expect(ledger.add).toHaveBeenCalledWith('tfnsw', '2026-10-26', 0);
  });

  it('reports its requests on flush and counts what other isolates sent', async () => {
    const shared = memoryLedger();
    const first = budget({ dailyLimit: 5, ledger: shared.ledger });
    const second = budget({ dailyLimit: 5, ledger: shared.ledger });

    await useOnce(first.subject, 3);
    await first.subject.flush();
    expect(shared.reports.at(-1)).toEqual({ budget: 'tfnsw', dayKey: '2026-10-26', calls: 3 });

    await useOnce(second.subject);
    await useOnce(second.subject);
    await expect(second.subject.ensureAvailable('tfnsw-trip-planner')).rejects.toMatchObject({
      failure: 'rate-limited',
    });
  });

  it('keeps requests for the next flush when the ledger cannot be reached', async () => {
    const ledger: BudgetLedger = {
      add: vi
        .fn<BudgetLedger['add']>()
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(new Error('ledger unreachable'))
        .mockResolvedValueOnce(2),
    };
    const { subject, onLedgerError } = budget({ dailyLimit: 10, ledger });

    await useOnce(subject, 2);
    await subject.flush();
    expect(onLedgerError).toHaveBeenCalledTimes(1);
    expect(subject.usedToday()).toBe(2);

    await subject.flush();
    expect(ledger.add).toHaveBeenLastCalledWith('tfnsw', '2026-10-26', 2);
    expect(subject.usedToday()).toBe(2);
  });

  it('carries on with its own count when the first sync fails', async () => {
    const ledger: BudgetLedger = { add: vi.fn(async () => Promise.reject(new Error('down'))) };
    const { subject, onLedgerError } = budget({ dailyLimit: 2, ledger });

    await useOnce(subject, 2);
    await expect(subject.ensureAvailable('tfnsw-trip-planner')).rejects.toMatchObject({
      failure: 'rate-limited',
    });
    expect(onLedgerError).toHaveBeenCalledTimes(1);
  });

  it('sends a backlog bigger than one report over several flushes', async () => {
    const shared = memoryLedger();
    const { subject } = budget({ dailyLimit: 50_000, ledger: shared.ledger });

    await useOnce(subject, MAX_CALLS_PER_LEDGER_REPORT + 500);
    await subject.flush();
    await subject.flush();

    expect(shared.reports.slice(-2).map((report) => report.calls)).toEqual([
      MAX_CALLS_PER_LEDGER_REPORT,
      500,
    ]);
    expect(subject.usedToday()).toBe(MAX_CALLS_PER_LEDGER_REPORT + 500);
  });

  it('does nothing on flush when there is nothing to report', async () => {
    const { ledger } = memoryLedger();
    const { subject } = budget({ dailyLimit: 2, ledger });
    await subject.flush();
    expect(ledger.add).not.toHaveBeenCalled();
  });
});

describe('budget guard and counted fetch together', () => {
  it('count what a provider sends and stop calling it once the budget is spent', async () => {
    const { subject } = budget({ dailyLimit: 1 });
    const baseFetch = vi.fn(async () => Response.json([]));
    const sendThroughBudget = budgetedFetch(subject, baseFetch);
    const transit = fakeTransit(async () => {
      await sendThroughBudget('https://api.transport.nsw.gov.au/v1/tp/trip');
      return [parramattaToWynyard()];
    });
    const guarded = interceptTransit(transit, budgetInterceptor(subject));
    const request = planRequest();
    const query = {
      from: request.origin,
      to: request.destination,
      time: request.time,
      maxJourneys: 4,
      walkingSpeed: 'normal' as const,
      excludedModes: [],
    };

    await guarded.planJourneys(query, new AbortController().signal);
    await expect(guarded.planJourneys(query, new AbortController().signal)).rejects.toMatchObject({
      failure: 'rate-limited',
    });

    expect(transit.queries).toHaveLength(1);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledWith(
      'https://api.transport.nsw.gov.au/v1/tp/trip',
      undefined,
    );
    expect(guarded.name).toBe('tfnsw-trip-planner');
  });
});
