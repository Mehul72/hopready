// Spaces out this process's calls to TfNSW. The TfNSW quota (5 requests per second and 60,000 per day
// on the default Bronze plan) is shared by every isolate and server using the same key (TfNSW has not
// said whether it counts per key or per account), so this gate only bounds one isolate. A fleet-wide
// limit needs shared state such as a Durable Object.

const WINDOW_MS = 1_000;
// Requests are spread over a slightly wider window so network jitter cannot bunch them over the limit
// by the time they reach TfNSW.
const WINDOW_MARGIN_MS = 100;
const DEFAULT_MAX_QUEUE_MS = 3_000;
// Caps a Retry-After hold so one unusual header cannot stop every request for long.
const MAX_HOLD_MS = 60_000;

export class RateGateFullError extends Error {
  readonly waitMs: number;

  constructor(waitMs: number) {
    super(`The TfNSW request queue is full; the next free slot is ${waitMs} ms away`);
    this.name = 'RateGateFullError';
    this.waitMs = waitMs;
  }
}

export interface RateGateOptions {
  requestsPerSecond: number;
  // The longest a caller may queue. Beyond it the caller is turned away at once, so a burst fails fast
  // instead of piling up requests whose callers have already given up.
  maxQueueMs?: number;
}

export class RateGate {
  private readonly requestsPerWindow: number;
  private readonly windowMs = WINDOW_MS + WINDOW_MARGIN_MS;
  private readonly maxQueueMs: number;
  // Send times already handed out, oldest first. Each new one is at least a window after the send time
  // `requestsPerWindow` places earlier, which keeps every window at or under the limit.
  private readonly slotsMs: number[] = [];
  private holdUntilMs = 0;

  constructor(options: RateGateOptions) {
    if (!Number.isInteger(options.requestsPerSecond) || options.requestsPerSecond < 1) {
      throw new RangeError('requestsPerSecond must be a whole number of at least 1');
    }
    this.requestsPerWindow = options.requestsPerSecond;
    this.maxQueueMs = options.maxQueueMs ?? DEFAULT_MAX_QUEUE_MS;
  }

  // Resolves when the caller may send. Rejects with the signal's reason if it aborts first, and with
  // RateGateFullError when the wait would be longer than maxQueueMs.
  acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);

    const nowMs = Date.now();
    this.forgetSlotsUpTo(nowMs - this.windowMs);
    const slotMs = this.nextSlotMs(nowMs);
    const waitMs = slotMs - nowMs;
    if (waitMs > this.maxQueueMs) return Promise.reject(new RateGateFullError(waitMs));

    this.slotsMs.push(slotMs);
    if (waitMs <= 0) return Promise.resolve();
    return waitUntilSlot(waitMs, signal).catch((reason: unknown) => {
      this.releaseIfLast(slotMs);
      throw reason;
    });
  }

  // TfNSW said when to come back (Retry-After), so nothing leaves this gate before then.
  holdFor(durationMs: number): void {
    const holdMs = Math.min(Math.max(0, durationMs), MAX_HOLD_MS);
    this.holdUntilMs = Math.max(this.holdUntilMs, Date.now() + holdMs);
  }

  private nextSlotMs(nowMs: number): number {
    const earliestMs = Math.max(nowMs, this.holdUntilMs);
    const anchorMs = this.slotsMs[this.slotsMs.length - this.requestsPerWindow];
    return anchorMs === undefined ? earliestMs : Math.max(earliestMs, anchorMs + this.windowMs);
  }

  // A slot that ended a full window ago can no longer push a later request back.
  private forgetSlotsUpTo(cutoffMs: number): void {
    while (this.slotsMs.length > 0 && this.slotsMs[0]! <= cutoffMs) this.slotsMs.shift();
  }

  // Only the newest slot can be handed back: later callers' slots were placed after it.
  private releaseIfLast(slotMs: number): void {
    if (this.slotsMs[this.slotsMs.length - 1] === slotMs) this.slotsMs.pop();
  }
}

function waitUntilSlot(waitMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, waitMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
