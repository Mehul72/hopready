import { ProviderError, type ProviderFailure, type ProviderName } from '@hopready/core';

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

interface RequestOptions {
  provider: ProviderName;
  url: string;
  init?: RequestInit;
  signal: AbortSignal;
  // Only idempotent requests may set this. One retry, after a short random pause.
  retryOnce?: boolean;
  // Lets a provider read its own error conventions, such as TfNSW's X-Error-Detail header.
  classifyFailure?: (response: Response) => ProviderFailure | null;
  fetchImpl?: FetchImplementation;
}

export interface ProviderRequest<T> extends RequestOptions {
  // Throws when the body is not the expected shape (for example a zod parse).
  parse: (body: unknown) => T;
}

export interface BinaryProviderRequest<T> extends RequestOptions {
  // Throws when the bytes are not the expected format.
  parse: (body: Uint8Array) => T;
  // A body larger than this is refused unread, so a runaway response cannot use up memory.
  maxBytes: number;
}

// Reads a successful response's body, or throws a ProviderError saying why it could not.
type BodyReader<Body> = (response: Response, request: RequestOptions) => Promise<Body>;

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

export function requestJson<T>(request: ProviderRequest<T>): Promise<T> {
  return requestWithRetry(request, readJsonBody, request.parse);
}

export function requestBytes<T>(request: BinaryProviderRequest<T>): Promise<T> {
  return requestWithRetry(
    request,
    (response, options) => readBytesBody(response, options, request.maxBytes),
    request.parse,
  );
}

async function requestWithRetry<Body, T>(
  request: RequestOptions,
  readBody: BodyReader<Body>,
  parse: (body: Body) => T,
): Promise<T> {
  const attempts = request.retryOnce ? 2 : 1;
  let lastError: ProviderError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await attemptRequest(request, readBody, parse);
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

async function attemptRequest<Body, T>(
  request: RequestOptions,
  readBody: BodyReader<Body>,
  parse: (body: Body) => T,
): Promise<T> {
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

  const body = await readBody(response, request);
  try {
    return parse(body);
  } catch (error) {
    throw new ProviderError(
      request.provider,
      'malformed-response',
      `${request.provider} sent a response in an unexpected shape`,
      { status: response.status, cause: error },
    );
  }
}

// The timer can fire while a large body is still arriving. That is a slow provider, worth a retry,
// not one that sent bad data.
function unfinishedBody(
  response: Response,
  request: RequestOptions,
  cause: unknown,
): ProviderError {
  return new ProviderError(
    request.provider,
    'timeout',
    `${request.provider} did not finish answering in time`,
    { status: response.status, cause },
  );
}

async function readJsonBody(response: Response, request: RequestOptions): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (request.signal.aborted) throw unfinishedBody(response, request, error);
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
}

async function readBytesBody(
  response: Response,
  request: RequestOptions,
  maxBytes: number,
): Promise<Uint8Array> {
  const tooLarge = () =>
    new ProviderError(
      request.provider,
      'malformed-response',
      `${request.provider} sent more than ${maxBytes} bytes`,
      { status: response.status },
    );
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (request.signal.aborted) throw unfinishedBody(response, request, error);
    // A connection that drops mid-body is a provider that could not be reached, worth a retry.
    throw new ProviderError(
      request.provider,
      'unavailable',
      `${request.provider} stopped answering part way through`,
      { status: response.status, cause: error },
    );
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
