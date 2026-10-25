import type { DurableObjectNamespace, SqlStorageValue } from '@cloudflare/workers-types';
import { z } from 'zod';

import {
  BUDGET_NAMES,
  type BudgetLedger,
  type BudgetName,
  MAX_CALLS_PER_LEDGER_REPORT,
} from './budget';
import { runWithDeadline, type LateOutcomeHandler } from './deadline';

// The subset of the Durable Object SQL API the ledger uses, so tests can run it on node:sqlite.
export interface SqlExecutor {
  exec<Row extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): { toArray(): Row[] };
}

// Enough history to compare recent days while investigating, small enough to never matter.
const RETAINED_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export function prepareLedger(sql: SqlExecutor): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS daily_calls (
      budget TEXT NOT NULL,
      day TEXT NOT NULL,
      calls INTEGER NOT NULL,
      PRIMARY KEY (budget, day)
    )`,
  );
}

const ledgerReportSchema = z.object({
  budget: z.enum(BUDGET_NAMES),
  dayKey: z.iso.date(),
  calls: z.number().int().min(0).max(MAX_CALLS_PER_LEDGER_REPORT),
});
type LedgerReport = z.infer<typeof ledgerReportSchema>;

const ledgerTotalSchema = z.object({ total: z.number().int().nonnegative() });

function earliestRetainedDay(dayKey: string): string {
  const day = new Date(`${dayKey}T00:00:00Z`);
  return new Date(day.getTime() - RETAINED_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addCalls(sql: SqlExecutor, report: LedgerReport): number {
  const rows = sql
    .exec<{ calls: number }>(
      `INSERT INTO daily_calls (budget, day, calls) VALUES (?, ?, ?)
       ON CONFLICT (budget, day) DO UPDATE SET calls = calls + excluded.calls
       RETURNING calls`,
      report.budget,
      report.dayKey,
      report.calls,
    )
    .toArray();
  sql.exec('DELETE FROM daily_calls WHERE day < ?', earliestRetainedDay(report.dayKey));
  const total = rows[0]?.calls;
  if (total === undefined) throw new Error('The budget ledger did not return a total');
  return total;
}

const LEDGER_REPORT_PATH = '/reports';

// Request handling for the ProviderBudget Durable Object. Only this Worker can reach it, through
// its binding, but the body is still checked before it touches storage.
export async function handleLedgerRequest(sql: SqlExecutor, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method !== 'POST' || pathname !== LEDGER_REPORT_PATH) {
    return Response.json({ error: 'not-found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid-json' }, { status: 400 });
  }
  const report = ledgerReportSchema.safeParse(body);
  if (!report.success) return Response.json({ error: 'invalid-report' }, { status: 400 });
  return Response.json({ total: addCalls(sql, report.data) });
}

// One object holds the whole count, placed in Oceania because the app serves Greater Sydney.
const LEDGER_OBJECT_NAME = 'provider-budget';
const LEDGER_URL = `https://provider-budget.internal${LEDGER_REPORT_PATH}`;
const LEDGER_TIMEOUT_MS = 2_000;

export type BudgetNamespace = Pick<DurableObjectNamespace, 'idFromName' | 'get'>;

export class DurableObjectBudgetLedger implements BudgetLedger {
  readonly #namespace: BudgetNamespace;
  readonly #timeoutMs: number;
  readonly #onLateOutcome: LateOutcomeHandler;

  constructor(
    namespace: BudgetNamespace,
    options: { timeoutMs?: number; onLateOutcome: LateOutcomeHandler },
  ) {
    this.#namespace = namespace;
    this.#timeoutMs = options.timeoutMs ?? LEDGER_TIMEOUT_MS;
    this.#onLateOutcome = options.onLateOutcome;
  }

  async add(budget: BudgetName, dayKey: string, calls: number): Promise<number> {
    const stub = this.#namespace.get(this.#namespace.idFromName(LEDGER_OBJECT_NAME), {
      locationHint: 'oc',
    });
    const report: LedgerReport = { budget, dayKey, calls };
    const response = await runWithDeadline(
      () =>
        stub.fetch(LEDGER_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(report),
        }),
      { deadlineMs: this.#timeoutMs, onLateOutcome: this.#onLateOutcome },
    );
    if (!response.ok) {
      throw new Error(`The budget ledger answered HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    return ledgerTotalSchema.parse(body).total;
  }
}
