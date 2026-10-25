import type { SqlStorageValue } from '@cloudflare/workers-types';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

import {
  addCalls,
  DurableObjectBudgetLedger,
  handleLedgerRequest,
  prepareLedger,
  type BudgetNamespace,
  type SqlExecutor,
} from './budget-ledger';
import { never } from './test-support/fakes';

// Runs the ledger's SQL on SQLite in Node, the same engine Durable Objects use. Like the Durable
// Object API, a statement runs when exec is called, whether or not its rows are read.
function sqliteLedger(): SqlExecutor {
  const database = new DatabaseSync(':memory:');
  const sql: SqlExecutor = {
    exec<Row extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ) {
      const values = bindings.map((binding) =>
        binding instanceof ArrayBuffer ? new Uint8Array(binding) : binding,
      );
      const rows = database.prepare(query).all(...values) as unknown as Row[];
      return { toArray: () => rows };
    },
  };
  prepareLedger(sql);
  return sql;
}

function rowsOf(sql: SqlExecutor) {
  return sql
    .exec<{ budget: string; day: string; calls: number }>(
      'SELECT budget, day, calls FROM daily_calls ORDER BY budget, day',
    )
    .toArray();
}

describe('addCalls', () => {
  it('keeps a running total per budget and day', () => {
    const sql = sqliteLedger();

    expect(addCalls(sql, { budget: 'tfnsw', dayKey: '2026-10-26', calls: 3 })).toBe(3);
    expect(addCalls(sql, { budget: 'tfnsw', dayKey: '2026-10-26', calls: 4 })).toBe(7);
    expect(addCalls(sql, { budget: 'apple-maps', dayKey: '2026-10-26', calls: 2 })).toBe(2);
    expect(addCalls(sql, { budget: 'tfnsw', dayKey: '2026-10-27', calls: 0 })).toBe(0);
  });

  it('forgets days more than two weeks old', () => {
    const sql = sqliteLedger();
    addCalls(sql, { budget: 'tfnsw', dayKey: '2026-10-01', calls: 9 });
    addCalls(sql, { budget: 'tfnsw', dayKey: '2026-10-12', calls: 8 });
    addCalls(sql, { budget: 'tfnsw', dayKey: '2026-10-26', calls: 1 });

    expect(rowsOf(sql)).toEqual([
      { budget: 'tfnsw', day: '2026-10-12', calls: 8 },
      { budget: 'tfnsw', day: '2026-10-26', calls: 1 },
    ]);
  });
});

describe('handleLedgerRequest', () => {
  const report = (body: unknown, path = '/reports') =>
    new Request(`https://provider-budget.internal${path}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('adds a valid report and answers with the total', async () => {
    const sql = sqliteLedger();
    const response = await handleLedgerRequest(
      sql,
      report({ budget: 'tfnsw', dayKey: '2026-10-26', calls: 5 }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: 5 });
  });

  it('refuses malformed reports without touching storage', async () => {
    const sql = sqliteLedger();
    const bad = [
      report('not json'),
      report({ budget: 'google', dayKey: '2026-10-26', calls: 1 }),
      report({ budget: 'tfnsw', dayKey: '26/10/2026', calls: 1 }),
      report({ budget: 'tfnsw', dayKey: '2026-10-26', calls: -1 }),
      report({ budget: 'tfnsw', dayKey: '2026-10-26', calls: 1.5 }),
    ];
    for (const request of bad) {
      expect((await handleLedgerRequest(sql, request)).status).toBe(400);
    }
    expect((await handleLedgerRequest(sql, report({ budget: 'tfnsw' }, '/elsewhere'))).status).toBe(
      404,
    );
    expect(rowsOf(sql)).toEqual([]);
  });
});

describe('DurableObjectBudgetLedger', () => {
  function namespaceServing(fetchImpl: (request: Request) => Promise<Response>) {
    const get = vi.fn(() => ({
      fetch: (url: string, init?: RequestInit) => fetchImpl(new Request(url, init)),
    }));
    const namespace = {
      idFromName: vi.fn((name: string) => ({ name })),
      get,
    } as unknown as BudgetNamespace;
    return { namespace, get };
  }

  it('reports calls to the single Durable Object placed in Oceania', async () => {
    const sql = sqliteLedger();
    const { namespace, get } = namespaceServing((request) => handleLedgerRequest(sql, request));
    const ledger = new DurableObjectBudgetLedger(namespace, { onLateOutcome: vi.fn() });

    expect(await ledger.add('tfnsw', '2026-10-26', 3)).toBe(3);
    expect(await ledger.add('tfnsw', '2026-10-26', 2)).toBe(5);
    expect(get).toHaveBeenCalledWith({ name: 'provider-budget' }, { locationHint: 'oc' });
  });

  it('fails when the object answers with an error', async () => {
    const { namespace } = namespaceServing(async () => new Response('nope', { status: 500 }));
    const ledger = new DurableObjectBudgetLedger(namespace, { onLateOutcome: vi.fn() });

    await expect(ledger.add('tfnsw', '2026-10-26', 1)).rejects.toThrow('HTTP 500');
  });

  it('gives up on an object that does not answer', async () => {
    const { namespace } = namespaceServing(() => never());
    const ledger = new DurableObjectBudgetLedger(namespace, {
      timeoutMs: 20,
      onLateOutcome: vi.fn(),
    });

    await expect(ledger.add('tfnsw', '2026-10-26', 1)).rejects.toMatchObject({
      name: 'DeadlineExceededError',
    });
  });
});
