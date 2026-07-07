/**
 * Cline SDK factory.
 *
 * Tries to load `@cline/sdk` dynamically. If the package is
 * installed, `createClineClient` from that package is used and its
 * result is re-wrapped. If the import fails (package not installed), a
 * thin fetch-based fallback is returned that hits the same REST endpoints.
 *
 * Auth: `Basic base64("cline:<password>")` — matches the convention
 * used by the cline serve child.
 *
 * Reference: https://docs.cline.bot/docs/sdk/
 */

import { parseSseStream } from "./events.js";
import { connectionErrorFrom, type BizarError } from "./errors.js";
import type { EventSubscription } from "./events.js";
import type { ClineEventEnvelope } from "./cline-events.js";

export interface ClineSdkConfig {
  baseUrl: string;
  /** Password for the cline serve child. */
  password?: string;
  /** Injectable fetch for testing. */
  fetch?: typeof fetch;
  /** When true, errors are thrown; default false (return BizarError). */
  throwOnError?: boolean;
}

/**
 * Thin fetch-based cline client, used when `@cline/sdk` is not
 * installed in the consumer's project.
 */
interface FallbackClineClient {
  sessions: {
    list(): Promise<unknown[]>;
    get(input: { sessionId: string }): Promise<unknown>;
    create(input: { title: string; agent: string }): Promise<{ id: string }>;
    abort(input: { sessionId: string }): Promise<null>;
    messages(input: { sessionId: string }): Promise<unknown[]>;
    prompt(input: {
      sessionId: string;
      body: { text: string };
      messageId?: string;
    }): Promise<{ messageId: string }>;
    promptAsync(input: { sessionId: string; body: { text: string } }): Promise<null>;
  };
  events: {
    subscribe(opts?: {
      signal?: AbortSignal;
      sessionID?: string;
      since?: number;
    }): Promise<EventSubscription & { sessionID?: string }>;
  };
  health: {
    check(): Promise<{ ok: boolean } | BizarError>;
  };
  server: {
    close?(): void;
  };
}

/**
 * The SDK instance returned by `createClineSdk`.
 */
export interface ClineSdk {
  sessions: FallbackClineClient["sessions"];
  events: FallbackClineClient["events"];
  health: FallbackClineClient["health"];
  server: FallbackClineClient["server"];
}

function makeAuthHeader(password: string): string {
  const encoded = Buffer.from(`cline:${password}`, "utf-8").toString("base64");
  return `Basic ${encoded}`;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  throwOnError: boolean,
): Promise<T | BizarError> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    const e = connectionErrorFrom(err);
    if (throwOnError) throw e;
    return e;
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  if (!response.ok) {
    const err: BizarError = {
      name: "APIError",
      data: {
        statusCode: response.status,
        isRetryable: response.status >= 500 || response.status === 429,
        message: `cline API returned ${response.status}`,
        responseBody: text,
      },
    };
    if (throwOnError) throw err;
    return err;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

function createFallbackClient(config: ClineSdkConfig): FallbackClineClient {
  const { baseUrl, password = "", fetch: fetchImpl = fetch, throwOnError = false } = config;
  const auth = makeAuthHeader(password);

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | BizarError> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    return fetchJson<T>(
      url,
      {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      },
      fetchImpl,
      throwOnError,
    );
  }

  return {
    sessions: {
      list: () => request<unknown[]>("GET", "/api/session") as Promise<unknown[]>,
      get: ({ sessionId }) =>
        request<unknown>("GET", `/api/session/${encodeURIComponent(sessionId)}`),
      create: (input) =>
        request<{ id: string }>("POST", "/api/session", input) as Promise<{ id: string }>,
      abort: ({ sessionId }) =>
        request<null>(
          "POST",
          `/api/session/${encodeURIComponent(sessionId)}/abort`,
        ) as Promise<null>,
      messages: ({ sessionId }) =>
        request<unknown[]>(
          "GET",
          `/api/session/${encodeURIComponent(sessionId)}/message`,
        ) as Promise<unknown[]>,
      prompt: ({ sessionId, body, messageId }) =>
        request<{ messageId: string }>(
          "POST",
          `/api/session/${encodeURIComponent(sessionId)}/prompt`,
          { id: messageId, prompt: body },
        ) as Promise<{ messageId: string }>,
      promptAsync: ({ sessionId, body }) =>
        request<null>(
          "POST",
          `/api/session/${encodeURIComponent(sessionId)}/prompt_async`,
          body,
        ) as Promise<null>,
    },
    events: {
      subscribe: async (opts = {}) => {
        const { signal, sessionID, since } = opts;
        const url = new URL("/event", baseUrl);
        if (typeof since === "number") {
          url.searchParams.set("since", String(since));
        }
        const controller = new AbortController();
        if (signal) {
          signal.addEventListener("abort", () => controller.abort(), { once: true });
        }
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          headers: {
            Authorization: auth,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`event subscribe failed: ${response.status}`);
        }
        const sub: EventSubscription & { sessionID?: string } = {
          sessionID,
          // Cast through unknown to satisfy the AsyncIterable<DashboardEvent> constraint
          // from the existing events.ts EventSubscription type. The actual yielded
          // values are ClineEventEnvelope objects which are compatible.
          stream: parseSseStream<ClineEventEnvelope>(
            response.body,
            controller,
          ) as unknown as EventSubscription["stream"],
          close: () => controller.abort(),
        };
        return sub;
      },
    },
    health: {
      check: async () => {
        const url = `${baseUrl}/health`;
        try {
          const r = await fetchImpl(url, { method: "GET" });
          if (!r.ok) {
            const text = await r.text().catch(() => "");
            const err: BizarError = {
              name: "APIError",
              data: {
                statusCode: r.status,
                isRetryable: r.status >= 500 || r.status === 429,
                message: `cline health check returned ${r.status}`,
                responseBody: text,
              },
            };
            if (throwOnError) throw err;
            return err;
          }
          return { ok: true } as const;
        } catch (err) {
          const e = connectionErrorFrom(err);
          if (throwOnError) throw e;
          return e;
        }
      },
    },
    server: {},
  };
}

/**
 * Create an cline SDK instance.
 *
 * Tries to use `@cline/sdk`'s `createClineClient` if installed;
 * falls back to a thin fetch-based client otherwise.
 *
 * @param opts  `{ baseUrl, password?, fetch?, throwOnError? }`
 */
export async function createClineSdk(
  opts: ClineSdkConfig,
): Promise<ClineSdk> {
  try {
    // `@cline/sdk` is an optional peer dep. If absent, the dynamic import
    // resolves to a rejected promise and we fall back to the fetch wrapper
    // below. TODO(cline-migration): rewrite this body to use Cline's
    // in-process `Agent` / `ClineCore` APIs from `@cline/sdk` instead of
    // mirroring the Cline v2 client shape.
    const mod = await import("@cline/sdk") as any;
    const createClient = mod.createClineClient;
    if (typeof createClient !== "function") throw new Error("not a function");

    const headers: Record<string, string> = {};
    if (opts.password) {
      headers["Authorization"] = makeAuthHeader(opts.password);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = createClient({
      baseUrl: opts.baseUrl,
      fetch: opts.fetch as any,
      headers,
      // The upstream SDK accepts different options; ignore unknown ones.
    } as any) as any;

    // The @cline/sdk client has a very different internal structure
    // (HeyApi pattern with .session.list(), .session.create(), etc.).
    // We wrap it to match the FallbackClineClient interface expected
    // by the dashboard.
    const wrapped: ClineSdk = {
      sessions: {
        list: async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await (inner.session?.list?.() ?? inner.sessions?.list?.()) as any;
          return r ?? [];
        },
        get: async ({ sessionId }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await (inner.session?.get?.({ sessionID: sessionId } as any) ?? inner.sessions?.get?.({ sessionId } as any))) as unknown;
        },
        create: async (input) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await (inner.session?.create?.(input as any) ?? inner.sessions?.create?.(input as any)) as any;
          return { id: r?.data?.id ?? r?.id ?? "" };
        },
        abort: async ({ sessionId }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await (inner.session?.abort?.({ sessionID: sessionId } as any) ?? inner.sessions?.abort?.({ sessionId } as any))) as null;
        },
        messages: async ({ sessionId }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await (inner.session?.messages?.({ sessionID: sessionId } as any) ?? inner.sessions?.messages?.({ sessionId } as any)) as any;
          return r?.data ?? r ?? [];
        },
        prompt: async ({ sessionId, body, messageId }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await (inner.session?.prompt?.({ sessionID: sessionId, prompt: body, id: messageId } as any) ?? inner.sessions?.prompt?.({ sessionId, body, messageId } as any)) as any;
          return { messageId: r?.messageId ?? messageId ?? "" };
        },
        promptAsync: async ({ sessionId, body }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await (inner.session?.promptAsync?.({ sessionID: sessionId, prompt: body } as any) ?? inner.sessions?.promptAsync?.({ sessionId, body } as any))) as null;
        },
      },
      events: {
        subscribe: async (opts = {}) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sub = await (inner.event?.subscribe?.(opts as any) ?? inner.events?.subscribe?.(opts as any)) as any;
          return {
            stream: sub?.stream as EventSubscription["stream"],
            close: () => sub?.close?.(),
          };
        },
      },
      health: {
        check: async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = await (inner.global?.health?.() ?? inner.health?.check?.()) as any;
            return { ok: r?.ok !== false };
          } catch {
            return { ok: false };
          }
        },
      },
      server: inner.server ?? {},
    };
    return wrapped;
  } catch {
    // `@cline/sdk` not installed or incompatible — use the fallback.
    return createFallbackClient(opts);
  }
}
