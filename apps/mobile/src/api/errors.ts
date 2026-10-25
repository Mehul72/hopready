export const API_ERROR_KINDS = [
  // The device reports no network connection.
  'offline',
  // The device is online but the request never got an answer (DNS, TLS, server down).
  'unreachable',
  'timeout',
  // The caller gave up, for example because a newer search replaced this one.
  'cancelled',
  'rate-limited',
  // Live planning has no server address in this build, or the server has no provider keys.
  'not-configured',
  'outside-coverage',
  // Any other 4xx: the server could not use this request.
  'rejected',
  'server',
  // The answer was not JSON, or not the shape this app version expects.
  'invalid-response',
  // A bug rather than a network or server condition.
  'unexpected',
] as const;
export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

const RETRYABLE_KINDS: readonly ApiErrorKind[] = ['offline', 'unreachable', 'timeout', 'server'];

// "30 seconds", "2 minutes": how long to wait before trying again.
export function describeWait(seconds: number): string {
  if (seconds < 60) {
    const whole = Math.max(1, Math.ceil(seconds));
    return whole === 1 ? '1 second' : `${whole} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function messageForApiError(kind: ApiErrorKind, retryAfterSeconds: number | null): string {
  switch (kind) {
    case 'offline':
      return "You're offline. Connect to the internet, then try again.";
    case 'unreachable':
      return "HopReady couldn't reach its server. Check your connection, then try again.";
    case 'timeout':
      return 'HopReady took too long to answer. Try again.';
    case 'cancelled':
      return 'The request was cancelled.';
    case 'rate-limited':
      return retryAfterSeconds === null
        ? 'HopReady is busy right now. Try again shortly.'
        : `HopReady is busy right now. Try again in ${describeWait(retryAfterSeconds)}.`;
    case 'not-configured':
      return "Live trip planning isn't set up yet. To try HopReady with sample trips, turn on demo mode in Settings.";
    case 'outside-coverage':
      return 'HopReady plans trips within Greater Sydney only. Choose places inside Greater Sydney.';
    case 'rejected':
      return "HopReady couldn't use this request. Check the places and time, then try again.";
    case 'server':
      return "HopReady couldn't get travel information just now. Try again in a moment.";
    case 'invalid-response':
      return 'HopReady received an answer it could not read. Try again, and update the app if this keeps happening.';
    case 'unexpected':
      return 'Something went wrong. Try again.';
  }
}

export interface ApiErrorOptions {
  // Overrides the standard message for this kind, for example to describe a demo scenario.
  message?: string;
  status?: number | null;
  retryAfterSeconds?: number | null;
  // True when turning on demo mode is the sensible next step (live planning is not set up).
  suggestsDemoMode?: boolean;
  cause?: unknown;
}

// One error type for everything that can go wrong fetching data, so screens can show a message
// and pick the right action (retry, wait, open Settings) from `kind` alone.
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly suggestsDemoMode: boolean;

  constructor(kind: ApiErrorKind, options: ApiErrorOptions = {}) {
    const retryAfterSeconds = options.retryAfterSeconds ?? null;
    super(options.message ?? messageForApiError(kind, retryAfterSeconds), {
      cause: options.cause,
    });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryAfterSeconds = retryAfterSeconds;
    this.suggestsDemoMode = options.suggestsDemoMode ?? false;
  }

  // Worth one automatic retry: the same request can succeed a moment later.
  get isRetryable(): boolean {
    return RETRYABLE_KINDS.includes(this.kind);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// Anything thrown that is not already an ApiError is a bug; it keeps the original as the cause.
export function toApiError(error: unknown): ApiError {
  return isApiError(error) ? error : new ApiError('unexpected', { cause: error });
}
