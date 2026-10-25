// Small helpers that work in Node, Cloudflare Workers and Hermes (which lacks AbortSignal.any).

export function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`Timed out after ${timeoutMs} ms`, 'TimeoutError')),
    timeoutMs,
  );
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

// Runs `task` over `items` with at most `concurrency` in flight, preserving input order.
// Each outcome is settled so one failing provider call cannot sink the others.
export async function mapSettled<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  task: (item: Item, index: number) => Promise<Result>,
): Promise<PromiseSettledResult<Result>[]> {
  const outcomes: PromiseSettledResult<Result>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        outcomes[index] = { status: 'fulfilled', value: await task(items[index]!, index) };
      } catch (reason) {
        outcomes[index] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outcomes;
}
