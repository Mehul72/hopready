import { ProviderError, type ProviderFailure, type ProviderName } from '@hopready/core';

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderRequest<T> {
  provider: ProviderName;
  url: string;
  init?: RequestInit;
  signal: AbortSignal;
  // Throws when the body is not the expected shape (for example a zod parse).
  parse: (body: unknown) => T;
  // Only idempotent requests may set this. One retry, after a short random pause.
  retryOnce?: boolean;
  // Lets a provider read its own error conventions, such as TfNSW's X-Error-Detail header.
  classifyFailure?: (response: Response) => ProviderFailure | null;
  fetchImpl?: FetchImplementation;
}

const RETRY_BASE_DELAY_MS = 150;
const RETRY_JITTER_MS = 150;

export function failureForStatus(status: number): ProviderFailure {
  if (status === 401) return 'not-configured';
  if (status === 403 || status === 429) return 'rate-limited';
  if (status >= 500) return 'unavailable';
  return 'rejected-request';
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export async function requestJson<T>(request: ProviderRequest<T>): Promise<T> {
  const attempts = request.retryOnce ? 2 : 1;
  let lastError: ProviderError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await attemptRequest(request);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      lastError = error;
      const worthRetrying = error.failure === 'unavailable' && !request.signal.aborted;
      if (attempt === attempts || !worthRetrying) throw error;
      await wait(RETRY_BASE_DELAY_MS + Math.random() * RETRY_JITTER_MS, request.signal).catch(
        () => {
          throw error;
        },
      );
    }
  }
  throw (
    lastError ?? new ProviderError(request.provider, 'unavailable', 'Request was not attempted')
  );
}

async function attemptRequest<T>(request: ProviderRequest<T>): Promise<T> {
  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(request.url, { ...request.init, signal: request.signal });
  } catch (error) {
    if (request.signal.aborted) {
      throw new ProviderError(
        request.provider,
        'timeout',
        `${request.provider} did not answer in time`,
        {
          cause: error,
        },
      );
    }
    throw new ProviderError(
      request.provider,
      'unavailable',
      `${request.provider} could not be reached`,
      {
        cause: error,
      },
    );
  }

  if (!response.ok) {
    const failure = request.classifyFailure?.(response) ?? failureForStatus(response.status);
    // Drain the body so the connection can be reused; its content is not trusted or logged.
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderError(
      request.provider,
      failure,
      `${request.provider} returned HTTP ${response.status}`,
      {
        status: response.status,
        retryAfterSeconds: retryAfterSeconds(response),
      },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ProviderError(
      request.provider,
      'malformed-response',
      `${request.provider} sent invalid JSON`,
      {
        status: response.status,
        cause: error,
      },
    );
  }

  try {
    return request.parse(body);
  } catch (error) {
    throw new ProviderError(
      request.provider,
      'malformed-response',
      `${request.provider} sent a response in an unexpected shape`,
      { status: response.status, cause: error },
    );
  }
}
