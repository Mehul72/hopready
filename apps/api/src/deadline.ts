import { ProviderError, type ProviderName } from '@hopready/core';

export class DeadlineExceededError extends Error {
  readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(`Gave up after ${deadlineMs} ms`);
    this.name = 'DeadlineExceededError';
    this.deadlineMs = deadlineMs;
  }
}

// What happened to a task after its caller stopped waiting for it.
export type LateOutcomeHandler = (outcome: PromiseSettledResult<unknown>) => void;

export interface DeadlineOptions {
  deadlineMs: number;
  // Gap between aborting the task's signal and giving up on it. A task that honours the abort can
  // still return the partial work it has; the deadline itself still holds for one that ignores it.
  settleMs?: number;
  // The caller's own signal, such as the client disconnecting.
  signal?: AbortSignal;
  onLateOutcome: LateOutcomeHandler;
}

// Resolves with the task's result, or rejects with DeadlineExceededError once the deadline passes,
// even if the task never settles.
export function runWithDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: DeadlineOptions,
): Promise<T> {
  const { deadlineMs, signal: parentSignal, onLateOutcome } = options;
  const settleMs = Math.min(Math.max(options.settleMs ?? 0, 0), deadlineMs);
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    const abortTimer = setTimeout(() => {
      controller.abort(
        new DOMException(`Timed out after ${deadlineMs - settleMs} ms`, 'TimeoutError'),
      );
    }, deadlineMs - settleMs);
    const giveUpTimer = setTimeout(() => {
      finish();
      reject(new DeadlineExceededError(deadlineMs));
    }, deadlineMs);

    function finish() {
      finished = true;
      clearTimeout(abortTimer);
      clearTimeout(giveUpTimer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }

    if (parentSignal?.aborted) controller.abort(parentSignal.reason);
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

    let running: Promise<T>;
    try {
      running = task(controller.signal);
    } catch (error) {
      finish();
      reject(error);
      return;
    }

    running.then(
      (value) => {
        if (finished) {
          onLateOutcome({ status: 'fulfilled', value });
          return;
        }
        finish();
        resolve(value);
      },
      (reason: unknown) => {
        if (finished) {
          onLateOutcome({ status: 'rejected', reason });
          return;
        }
        finish();
        reject(reason);
      },
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

// Every failure of a provider call becomes a ProviderError, the same way the core planner treats them.
export function toProviderError(error: unknown, provider: ProviderName): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof DeadlineExceededError || isAbortError(error)) {
    return new ProviderError(provider, 'timeout', `${provider} did not answer in time`, {
      cause: error,
    });
  }
  return new ProviderError(provider, 'unavailable', `${provider} call failed`, { cause: error });
}

export interface ProviderCallOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onLateOutcome: LateOutcomeHandler;
}

// One provider call with a hard timeout. Rejects only with ProviderError.
export async function callProvider<T>(
  provider: ProviderName,
  task: (signal: AbortSignal) => Promise<T>,
  options: ProviderCallOptions,
): Promise<T> {
  try {
    return await runWithDeadline(task, {
      deadlineMs: options.timeoutMs,
      signal: options.signal,
      onLateOutcome: options.onLateOutcome,
    });
  } catch (error) {
    throw toProviderError(error, provider);
  }
}
