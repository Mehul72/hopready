import { ApiError, type ApiErrorKind } from './errors';
import { createQueryClient, retryDelayMs, shouldRetryQuery } from './query-client';

describe('query retry policy', () => {
  it.each<ApiErrorKind>(['offline', 'unreachable', 'timeout', 'server'])(
    'retries a %s failure once',
    (kind) => {
      expect(shouldRetryQuery(0, new ApiError(kind))).toBe(true);
      expect(shouldRetryQuery(1, new ApiError(kind))).toBe(false);
    },
  );

  it.each<ApiErrorKind>([
    'rate-limited',
    'not-configured',
    'outside-coverage',
    'rejected',
    'invalid-response',
    'cancelled',
    'unexpected',
  ])('never retries a %s failure, which would get the same answer again', (kind) => {
    expect(shouldRetryQuery(0, new ApiError(kind))).toBe(false);
  });

  it('never retries an error that is not an ApiError', () => {
    expect(shouldRetryQuery(0, new TypeError('bug'))).toBe(false);
  });

  it('spreads retry delays with full jitter up to a cap', () => {
    expect(retryDelayMs(0, () => 1)).toBe(500);
    expect(retryDelayMs(1, () => 0.5)).toBe(500);
    expect(retryDelayMs(10, () => 1)).toBe(4_000);
    expect(retryDelayMs(3, () => 0)).toBe(0);
  });

  it('builds a client that uses this policy and does not retry mutations', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(shouldRetryQuery);
    expect(defaults.queries?.networkMode).toBe('always');
    expect(defaults.mutations?.retry).toBe(false);
  });
});
