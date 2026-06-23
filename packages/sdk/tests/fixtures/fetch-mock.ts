/**
 * Test fixture: a fetch mock with canned responses + request log.
 *
 * Usage:
 *   const m = makeFetchMock();
 *   m.respondWith("GET", /\/sessions/, { body: [{ id: "ses_1" }] });
 *   const client = createBizarClient({ ..., fetch: m.fetch });
 *   await client.sessions.list();
 *   expect(m.lastRequest.url).toBe("http://127.0.0.1:4098/sessions");
 */

export interface FetchMockRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FetchMockRule {
  method: string;
  match: RegExp | string;
  /** Plain canned response (text/JSON). */
  response?: {
    status: number;
    body?: string;
    contentType?: string;
  };
  /** Streaming response (SSE). Overrides `response` if both set. */
  stream?: ReadableStream<Uint8Array>;
  streamStatus?: number;
  streamContentType?: string;
}

export interface FetchMock {
  fetch: typeof fetch;
  respondWith(method: string, match: RegExp | string, response: FetchMockRule["response"]): void;
  respondWithStream(
    method: string,
    match: RegExp | string,
    stream: ReadableStream<Uint8Array>,
    opts?: { status?: number; contentType?: string },
  ): void;
  respondWithError(method: string, match: RegExp | string, error: Error): void;
  lastRequest: FetchMockRequest | null;
  requests: FetchMockRequest[];
  reset(): void;
}

export function makeFetchMock(): FetchMock {
  const rules: FetchMockRule[] = [];
  const errorRules: Array<{ method: string; match: RegExp | string; error: Error }> = [];
  const requests: FetchMockRequest[] = [];
  let lastRequest: FetchMockRequest | null = null;

  const mockFetch: typeof fetch = async (input, init) => {
    const req: FetchMockRequest = {
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: parseHeaders(init?.headers),
      body: init?.body === undefined ? undefined : String(init.body),
    };
    requests.push(req);
    lastRequest = req;

    const errorMatch = errorRules.find(
      (r) => r.method.toUpperCase() === req.method && matchUrl(r.match, req.url),
    );
    if (errorMatch) throw errorMatch.error;

    const rule = rules.find(
      (r) => r.method.toUpperCase() === req.method && matchUrl(r.match, req.url),
    );
    if (!rule) {
      return new Response(JSON.stringify({ error: "no mock rule" }), { status: 404 });
    }

    if (rule.stream) {
      const headers: Record<string, string> = {};
      headers["Content-Type"] = rule.streamContentType ?? "text/event-stream";
      return new Response(rule.stream, {
        status: rule.streamStatus ?? 200,
        headers,
      });
    }

    const r = rule.response ?? { status: 200 };
    const headers: Record<string, string> = {};
    if (r.contentType) headers["Content-Type"] = r.contentType;
    else if (r.body !== undefined) headers["Content-Type"] = "application/json";

    // 204/205/304 MUST NOT have a body per the Fetch spec.
    if (r.status === 204 || r.status === 205 || r.status === 304) {
      return new Response(null, { status: r.status, headers });
    }

    return new Response(r.body ?? "", {
      status: r.status,
      headers,
    });
  };

  return {
    fetch: mockFetch,
    respondWith(method, match, response) {
      rules.push({ method: method.toUpperCase(), match, response });
    },
    respondWithStream(method, match, stream, opts) {
      rules.push({
        method: method.toUpperCase(),
        match,
        stream,
        streamStatus: opts?.status ?? 200,
        streamContentType: opts?.contentType ?? "text/event-stream",
      });
    },
    respondWithError(method, match, error) {
      errorRules.push({ method: method.toUpperCase(), match, error });
    },
    get lastRequest() {
      return lastRequest;
    },
    requests,
    reset() {
      rules.length = 0;
      errorRules.length = 0;
      requests.length = 0;
      lastRequest = null;
    },
  };
}

function matchUrl(match: RegExp | string, url: string): boolean {
  if (typeof match === "string") return url.endsWith(match) || url.includes(match);
  return match.test(url);
}

function parseHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    const out: Record<string, string> = {};
    for (const [k, v] of h) out[k] = v;
    return out;
  }
  return { ...(h as Record<string, string>) };
}
