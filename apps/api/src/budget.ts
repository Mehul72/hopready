import { ProviderError, type Clock, type ProviderName } from '@hopready/core';

import { DeadlineExceededError, runWithDeadline } from './deadline';

// One budget per provider account, because the provider's daily quota is per account or key.
// tfnsw-realtime is a cap inside tfnsw: live vehicle positions are polled while maps are open, and
// must never use up the calls trip planning needs. Its requests count against both.
export const BUDGET_NAMES = ['tfnsw', 'tfnsw-realtime', 'apple-maps'] as const;
// The most calls the ledger accepts in one report. A larger backlog, built up while the ledger
// was unreachable, goes over several flushes instead of being refused every time.
export const MAX_CALLS_PER_LEDGER_REPORT = 10_000;
export type BudgetName = (typeof BUDGET_NAMES)[number];

const MS_PER_DAY = 86_400_000;
// The longest a check waits for the shared count. A slower ledger is not waited for: the isolate
// carries on with its own count, as when the ledger fails, and uses the answer when it lands.
const FIRST_SYNC_WAIT_MS = 1_500;
// A first sync still pending after this is taken as lost and started again. On Workers it ends,
// unsettled, with the request that started it, such as a trip map closed mid-request.
const FIRST_SYNC_LOST_MS = 10_000;

// Budget days follow UTC dates. Neither provider documents when its daily quota resets, so the
// defaults stay well under the documented quotas instead of relying on a particular reset time.
export function budgetDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilNextBudgetDay(now: Date): number {
  const nextDayMs = (Math.floor(now.getTime() / MS_PER_DAY) + 1) * MS_PER_DAY;
  return Math.ceil((nextDayMs - now.getTime()) / 1000);
}

// The shared count across every Workers isolate, kept by the ProviderBudget Durable Object.
export interface BudgetLedger {
  // Adds `calls` to the day's shared count and returns the shared total, including those calls.
  add(budget: BudgetName, dayKey: string, calls: number): Promise<number>;
}

interface BudgetDay {
  key: string;
  // Last shared total the ledger reported, including this isolate's reported calls.
  sharedTotal: number;
  // Requests sent from here and not yet reported to the ledger, and reports on their way to it.
  unreported: number;
  reporting: number;
  synced: boolean;
  exhaustionLogged: boolean;
}

export interface DailyCallBudgetOptions {
  name: BudgetName;
  dailyLimit: number;
  clock: Clock;
  // Null on a single Node process, where this isolate's count is the whole count.
  ledger: BudgetLedger | null;
  onLedgerError: (error: unknown) => void;
  onExhausted: () => void;
}

// Counts a provider account's HTTP requests against a daily budget. Requests are counted where they
// are sent, because one provider method can make several (a retry, a token exchange, one request
// per car park). Each provider method checks the budget before it starts, so a spent budget fails
// fast. Checks use the in-memory count and wait on the ledger only for the first check in each
// isolate and day; flush(), run by the Workers entry after each response, reports the counts.
export class DailyCallBudget {
  readonly name: BudgetName;
  readonly dailyLimit: number;
  readonly #options: DailyCallBudgetOptions;
  #day: BudgetDay;
  #firstSync: { done: Promise<void>; startedAtMs: number } | null = null;

  constructor(options: DailyCallBudgetOptions) {
    this.name = options.name;
    this.dailyLimit = options.dailyLimit;
    this.#options = options;
    this.#day = this.#newDay(budgetDayKey(options.clock.now()));
  }

  // Throws ProviderError 'rate-limited' when the day's budget is spent; otherwise the call may go ahead.
  async ensureAvailable(provider: ProviderName): Promise<void> {
    let day = this.#today();
    if (this.#options.ledger && !day.synced) {
      await this.#waitForFirstSync(day);
      day = this.#today();
    }
    if (this.#knownTotal(day) < this.dailyLimit) return;
    if (!day.exhaustionLogged) {
      day.exhaustionLogged = true;
      this.#options.onExhausted();
    }
    const retryAfterSeconds = secondsUntilNextBudgetDay(this.#options.clock.now());
    throw new ProviderError(
      provider,
      'rate-limited',
      `HopReady's daily ${this.name} call budget is used up`,
      { retryAfterSeconds },
    );
  }

  // One HTTP request sent to the provider. A provider method that was allowed to start may finish
  // its requests, so the count can pass the limit by what one method sends.
  recordRequest(): void {
    this.#today().unreported += 1;
  }

  // Sends unreported calls to the ledger and learns what other isolates have used. Never throws:
  // a ledger failure is reported through onLedgerError and the calls are sent again next time.
  async flush(): Promise<void> {
    const ledger = this.#options.ledger;
    const day = this.#today();
    if (!ledger || day.unreported === 0) return;
    const calls = Math.min(day.unreported, MAX_CALLS_PER_LEDGER_REPORT);
    day.unreported -= calls;
    day.reporting += calls;
    try {
      const total = await ledger.add(this.name, day.key, calls);
      day.sharedTotal = Math.max(day.sharedTotal, total);
      day.synced = true;
    } catch (error) {
      // A report that timed out may still have landed, so this can count those calls twice.
      // That errs towards stopping early, which is the safe side for a quota.
      day.unreported += calls;
      this.#options.onLedgerError(error);
    } finally {
      day.reporting -= calls;
    }
  }

  usedToday(): number {
    return this.#knownTotal(this.#today());
  }

  #knownTotal(day: BudgetDay): number {
    return day.sharedTotal + day.reporting + day.unreported;
  }

  #today(): BudgetDay {
    const key = budgetDayKey(this.#options.clock.now());
    if (this.#day.key !== key) {
      this.#day = this.#newDay(key);
      this.#firstSync = null;
    }
    return this.#day;
  }

  #newDay(key: string): BudgetDay {
    return {
      key,
      sharedTotal: 0,
      unreported: 0,
      reporting: 0,
      synced: false,
      exhaustionLogged: false,
    };
  }

  // Learns the shared total once per isolate and day, shared by every check that arrives meanwhile.
  // Each check waits for it with a timer of its own, so a sync lost with another request's ending
  // cannot hold this one up. If the ledger cannot answer, the isolate carries on with its own count
  // and tries again on the next flush.
  async #waitForFirstSync(day: BudgetDay): Promise<void> {
    const ledger = this.#options.ledger;
    if (!ledger) return;
    const nowMs = this.#options.clock.now().getTime();
    if (!this.#firstSync || nowMs - this.#firstSync.startedAtMs > FIRST_SYNC_LOST_MS) {
      const done = ledger.add(this.name, day.key, 0).then(
        (total) => {
          day.sharedTotal = Math.max(day.sharedTotal, total);
          day.synced = true;
        },
        (error: unknown) => {
          day.synced = true;
          this.#options.onLedgerError(error);
        },
      );
      this.#firstSync = { done, startedAtMs: nowMs };
    }
    const { done } = this.#firstSync;
    try {
      await runWithDeadline(() => done, {
        deadlineMs: FIRST_SYNC_WAIT_MS,
        onLateOutcome: () => undefined,
      });
    } catch (error) {
      if (!(error instanceof DeadlineExceededError)) throw error;
    }
  }
}
