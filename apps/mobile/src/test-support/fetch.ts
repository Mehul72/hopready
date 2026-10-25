import type { FetchFunction, FetchRequest, FetchResponse } from '@/api/http';

// A response as the API client sees it, without depending on a global Response in Jest.
export function textResponse(
  status: number,
  text: string,
  headers: Record<string, string> = {},
): FetchResponse {
  const lowerCaseHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lowerCaseHeaders.get(name.toLowerCase()) ?? null },
    text: async () => text,
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FetchResponse {
  return textResponse(status, JSON.stringify(body), {
    'Content-Type': 'application/json',
    ...headers,
  });
}

export interface RecordedRequest {
  url: string;
  init: FetchRequest;
}

// A fetch that answers from a script and records every request it was given.
export function scriptedFetch(
  ...answers: ((request: RecordedRequest) => Promise<FetchResponse>)[]
): FetchFunction & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchStub = async (url: string, init: FetchRequest) => {
    const request = { url, init };
    requests.push(request);
    const answer = answers[requests.length - 1];
    if (!answer) throw new Error(`No scripted answer for request ${requests.length}`);
    return answer(request);
  };
  return Object.assign(fetchStub, { requests });
}

// Never settles until the request is aborted, like a server that accepted the connection and went
// quiet. The rejection mirrors what React Native's fetch does on abort.
export function hangingUntilAborted(request: RecordedRequest): Promise<FetchResponse> {
  return new Promise((_, reject) => {
    request.init.signal.addEventListener('abort', () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
}
