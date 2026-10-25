import { ProviderError } from '../providers';

export const DEMO_PROVIDER_NAME = 'demo-fixture';

// Mirrors the live adapters: a request whose signal fired is reported as a timeout.
function abortedError(signal: AbortSignal): ProviderError {
  return new ProviderError(DEMO_PROVIDER_NAME, 'timeout', 'demo-fixture did not answer in time', {
    cause: signal.reason,
  });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortedError(signal);
}

// Never resolves. Rejects when the signal fires, or after ceilingMs if nobody ever cancels, so a
// caller without a deadline cannot hang forever.
export function waitUntilAborted(signal: AbortSignal, ceilingMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortedError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      reject(
        new ProviderError(
          DEMO_PROVIDER_NAME,
          'timeout',
          `demo-fixture gave up waiting after ${ceilingMs} ms`,
        ),
      );
    }, ceilingMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
