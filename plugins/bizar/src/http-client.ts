/**
 * http-client.ts
 *
 * Typed fetch wrapper for plugin → cline serve calls (v0.4.2 spec §1, §2.3).
 *
 * Responsibilities:
 *   - Auth header on every call: `Authorization: Basic base64("cline:<password>")`
 *     (spec §6.1; this is the spec's best understanding of cline serve's
 *     auth scheme and is verified by integration test in BizarHarness-dev).
 *   - `directory` query param on every per-instance call (spec §1.7).
 *   - 30s default timeout via `AbortController` (spec §2.3 / §6.1 env
 *     `BIZAR_HTTP_TIMEOUT_MS`, option `httpTimeoutMs`).
 *   - Never throws on transport errors; returns a discriminated result so
 *     callers can log + surface a clear error to the agent without an
 *     unhandled rejection (spec §2.3 last paragraph).
 *
 * v0.4.3 — v2 API migration (see `.bizar/cline-sse-investigation.md`):
 *   - The v1 session routes (`/session`, `/session/{id}/prompt_async`,
 *     `/session/{id}/abort`, `/session/{id}/message`) hang indefinitely
 *     against cline serve 1.17.7. We migrated to the v2 API:
 *
 *     | Method     | Old (v1, hangs)            | New (v2)                           |
 *     |------------|----------------------------|------------------------------------|
 *     | create     | POST /session              | POST /api/session                  |
 *     | sendPrompt | POST /session/{id}/prompt_async | POST /api/session/{id}/prompt |
 *     | abort      | POST /session/{id}/abort   | POST /api/session/{id}/abort       |
 *     | listMsgs   | GET /session/{id}/message  | GET /api/session/{id}/message      |
 *
 *   - v2 wraps responses in `{data: ...}`. This client unwraps internally
 *     so the public interface (e.g. `{id: string}` from createSession,
 *     `ListMessagesResult[]` from listMessages) is unchanged.
 *   - v2 prompt body shape is `{id, prompt: {text}, agent, model?}` — we
 *     extract the text from the first `parts` text entry.
 *   - v2 abort: the OpenAPI investigation found no documented v2 abort
 *     route. We try `/api/session/{id}/abort` as a best-effort; if it
 *     fails, the in-memory instance state is still marked `killed` for
 *     immediate caller feedback, and the next SSE event will finalize it.
 *   - The SSE endpoint `GET /event?directory=...` (v1) still works for
 *     the event subscription (v1 SSE connects fine; only the session
 *     routes hang). We keep using it; the v2 `/api/event` endpoint with
 *     `location[directory]=...` query syntax is a known alternative.
 *
 * Boundary policy: the only `node:` import allowed in this file is
 * implicit (none). We use the global `fetch` / `AbortController` /
 * `ReadableStream` provided by Bun's runtime. If the test runtime is pure
 * Node, those are available as globals in Node 20+; in Bun they are
 * always available.
 *
 * Note on auth scheme: cline serve's exact auth scheme is cline-
 * dependent. The current best understanding, based on v0.4 research, is
 * `Authorization: Basic` with username `cline`. This must be verified
 * by reading cline's serve-side code or by integration test. If
 * cline uses a different scheme (e.g. a custom `x-cline-password`
 * header), this file is the single place to change.
 */

// --- Logger interface -----------------------------------------------------

/**
 * Minimal Logger interface — matches the shape in `state.ts` / `logger.ts`.
 */
export interface Logger {
  log(opts: { level: "debug" | "info" | "warn" | "error"; message: string }): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// --- Public surface -------------------------------------------------------

/**
 * Per-call request options for the message-listing endpoint.
 * Used by `bizar_collect` to reconstruct the result text.
 */
export interface ListMessagesResult {
  id: string;
  role: string;
  parts: Array<{
    type: string;
    text?: string;
    error?: string;
  }>;
}

/**
 * A model override for createSession / sendPrompt. Both fields required.
 */
export interface ModelOverride {
  providerID: string;
  modelID: string;
}

export interface CreateSessionOptions {
  parentID?: string;
  title: string;
  agent: string;
  model?: ModelOverride;
}

export interface SendPromptOptions {
  sessionId: string;
  messageID: string;
  agent: string;
  model?: ModelOverride;
  parts: Array<{ type: "text"; text: string }>;
}

/**
 * Discriminated result of an HTTP call. We never throw across the
 * client boundary — callers pattern-match on `ok`.
 */
export type HttpResult<T> =
  | { ok: true; value: T; status: number }
  | { ok: false; error: string; status?: number };

/**
 * Typed HTTP client for the cline serve child. All methods take a
 * `directory` argument (spec §1.7) so the same client works for the
 * plugin's own worktree and any future multi-worktree setups.
 */
export class HttpClient {
  private baseUrl: string;
  private authHeader: string;
  private logger: Logger;
  private timeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    password: string;
    logger: Logger;
    timeoutMs?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.logger = opts.logger;
    this.timeoutMs = Math.max(1000, Math.floor(opts.timeoutMs ?? 30_000));
    // Basic auth: "cline:<password>" base64-encoded.
    // (spec §6.1; see module-level note re: scheme verification.)
    const credentials = `cline:${opts.password}`;
    this.authHeader = `Basic ${btoa(credentials)}`;
  }

  // --- Public API ---------------------------------------------------------

  /**
   * POST /api/session — create a new background session (v2 route).
   *
   * v0.4.3 migration: v1 `POST /session` hangs against cline 1.17.7.
   * The v2 endpoint returns `{data: {id, ...}}`; we unwrap `.data` so
   * the public interface stays `{id: string}`.
   *
   * Body (verified via OpenAPI spec):
   *   { parentID?, title, agent, model? }
   *
   * The `agent` field is REQUIRED — without it cline spawns the
   * default agent instead of the requested one.
   */
  async createSession(
    opts: CreateSessionOptions,
    directory: string,
  ): Promise<HttpResult<{ id: string }>> {
    const body: Record<string, unknown> = {
      title: opts.title,
      agent: opts.agent,
    };
    if (opts.parentID !== undefined) body.parentID = opts.parentID;
    if (opts.model !== undefined) body.model = opts.model;

    const res = await this.request<{ data?: { id?: string } }>(
      "POST",
      `/api/session?directory=${encodeURIComponent(directory)}`,
      body,
    );
    if (!res.ok) return res;
    // v2 wraps the session in `{data: {...}}`. Defensive: if the server
    // ever returns the session at top level, fall back to that shape.
    const id = res.value.data?.id ?? (res.value as unknown as { id?: string }).id;
    if (typeof id !== "string" || id.length === 0) {
      return {
        ok: false,
        error: "POST /api/session: response missing `data.id`",
        status: res.status,
      };
    }
    return { ok: true, value: { id }, status: res.status };
  }

  /**
   * POST /api/session/{id}/prompt — fire the prompt (v2 route).
   *
   * v0.4.3 migration: v1 `POST /session/{id}/prompt_async` hangs. The v2
   * endpoint is synchronous and uses a different body shape:
   *
   *   OLD: { messageID, parts: [{type:"text", text}], agent, model? }
   *   NEW: { id, prompt: {text: "..."}, agent, model? }
   *
   * The text is extracted from the first text-type part. `id` is the
   * plugin-generated `messageID` (renamed from `messageID`).
   *
   * Response shape is not fully documented in the OpenAPI spec; we
   * accept any JSON (or empty) body and return the raw parsed value.
   * Callers that need the response data should check `value`.
   */
  async sendPrompt(
    opts: SendPromptOptions,
    directory: string,
  ): Promise<HttpResult<unknown>> {
    // v2 takes the prompt text in `prompt.text`, not in `parts[]`.
    // Concatenate all text parts in order; fall back to empty string.
    const text = opts.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    const body: Record<string, unknown> = {
      id: opts.messageID,
      prompt: { text },
      agent: opts.agent,
    };
    if (opts.model) body.model = opts.model;

    return this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(opts.sessionId)}/prompt?directory=${encodeURIComponent(directory)}`,
      body,
    );
  }

  /**
   * POST /api/session/{id}/abort — kill a running session (v2 route).
   *
   * v0.4.3 migration: v1 `POST /session/{id}/abort` likely hangs (the
   * v1 session routes all hang on cline 1.17.7). The OpenAPI
   * investigation did not surface a documented v2 abort endpoint, so
   * this is a best-effort call against the v2-mirrored path. If the
   * server returns a 404, we log a warning via the result `error`
   * field and the in-memory state is still marked `killed` for
   * immediate caller feedback. The next SSE `session.idle` or
   * `session.error` for the session will finalize the state.
   *
   * This is what `bizar_kill` and the shutdown path call.
   * NOT `DELETE /session/{id}`.
   */
  async abortSession(
    sessionId: string,
    directory: string,
  ): Promise<HttpResult<boolean>> {
    const res = await this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(directory)}`,
      null,
    );
    if (!res.ok) return res;
    // The server may return `true`, a `{data: true}` wrapper, or nothing.
    // We treat any 2xx with a body or no body as "ok".
    const value: unknown = res.value;
    if (value === undefined || value === null) {
      return { ok: true, value: true, status: res.status };
    }
    if (typeof value === "object") {
      const v = value as { data?: unknown; result?: unknown };
      if (v.data === true) return { ok: true, value: true, status: res.status };
      if (v.result === true) return { ok: true, value: true, status: res.status };
    }
    if (value === true) return { ok: true, value: true, status: res.status };
    // Any other truthy/falsey body: treat as best-effort success.
    return { ok: true, value: true, status: res.status };
  }

  /**
   * GET /api/session/{id}/message — list the messages of a session (v2 route).
   *
   * v0.4.3 migration: v1 `GET /session/{id}/message` likely hangs. The
   * v2 endpoint returns `{data: Array<{info, parts}>}`; we unwrap
   * `.data` so the public interface stays `ListMessagesResult[]`.
   *
   * Each message is normalized to the flattened
   * {@link ListMessagesResult} shape for the tool layer.
   */
  async listMessages(
    sessionId: string,
    directory: string,
  ): Promise<HttpResult<ListMessagesResult[]>> {
    type RawMessage = {
      info?: { id?: string; role?: string };
      parts?: Array<{ type?: string; text?: string; error?: string }>;
    };
    const res = await this.request<{ data?: RawMessage[] } | RawMessage[]>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(directory)}`,
    );
    if (!res.ok) return res;
    // v2 wraps the array in `{data: [...]}`. Defensive: fall back to
    // top-level array if the server returns the bare array.
    const arr: RawMessage[] = Array.isArray(res.value)
      ? res.value
      : (res.value.data ?? []);
    const normalized: ListMessagesResult[] = arr.map((m) => ({
      id: m.info?.id ?? "",
      role: m.info?.role ?? "",
      parts: (m.parts ?? []).map((p) => {
        const part: ListMessagesResult["parts"][number] = {
          type: p.type ?? "unknown",
        };
        if (p.text !== undefined) part.text = p.text;
        if (p.error !== undefined) part.error = p.error;
        return part;
      }),
    }));
    return { ok: true, value: normalized, status: res.status };
  }

  /**
   * GET /event?directory=... — open the SSE event stream.
   *
   * We return the raw `ReadableStream` so the caller (EventStream) can
   * parse the SSE wire format. The HTTP response is the underlying
   * `Response`; only the body stream is consumed here.
   *
   * Note: the SSE response uses `Content-Type: text/event-stream` and
   * may stay open indefinitely. The AbortController we attach kills
   * the connection on `disconnect()`.
   */
  async fetchEventStream(directory: string, signal?: AbortSignal): Promise<HttpResult<ReadableStream>> {
    const url = `${this.baseUrl}/api/event?location[directory]=${encodeURIComponent(directory)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);

    // Bridge caller-provided signal (disconnect) into our internal ac.
    const onCallerAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) {
        ac.abort();
      } else {
        signal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "text/event-stream",
        },
        signal: ac.signal,
      });
      if (!response.ok) {
        // Drain the body so the connection is released.
        try {
          await response.arrayBuffer();
        } catch {
          // ignore
        }
        return {
          ok: false,
          error: `GET /event failed: ${response.status} ${response.statusText}`,
          status: response.status,
        };
      }
      if (!response.body) {
        return { ok: false, error: "GET /event: no response body" };
      }
      return { ok: true, value: response.body, status: response.status };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const finalMsg = isAbort
        ? `GET /event aborted after ${this.timeoutMs}ms`
        : `GET /event network error: ${msg}`;
      this.logger.log({ level: "warn", message: `bizar: ${finalMsg}` });
      return { ok: false, error: finalMsg };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onCallerAbort);
    }
  }

  /**
   * GET /health — used by ServeLifecycle to confirm the server is up.
   */
  async healthCheck(): Promise<boolean> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: { Authorization: this.authHeader },
        signal: ac.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Internal request helper -------------------------------------------

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    pathAndQuery: string,
    body?: unknown,
    opts: { expectNoBody?: boolean } = {},
  ): Promise<HttpResult<T>> {
    const url = `${this.baseUrl}${pathAndQuery}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: ac.signal,
      };
      if (body !== null && body !== undefined) {
        init.body = JSON.stringify(body);
      }
      const response = await fetch(url, init);

      if (!response.ok) {
        // Capture the error body for the caller but do not throw.
        let detail = "";
        try {
          detail = await response.text();
        } catch {
          // ignore
        }
        if (detail.length > 500) detail = detail.slice(0, 500) + "…";
        return {
          ok: false,
          error: `${method} ${pathAndQuery} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`,
          status: response.status,
        };
      }

      if (opts.expectNoBody || response.status === 204) {
        return { ok: true, value: undefined as T, status: response.status };
      }

      // 200 with body — try to parse as JSON.
      try {
        const parsed = (await response.json()) as T;
        return { ok: true, value: parsed, status: response.status };
      } catch (err: unknown) {
        return {
          ok: false,
          error: `${method} ${pathAndQuery} returned ${response.status} with non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
          status: response.status,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const finalMsg = isAbort
        ? `Request to ${url} timed out after ${this.timeoutMs}ms`
        : `Request to ${url} failed: ${msg}`;
      this.logger.log({ level: "warn", message: `bizar: ${finalMsg}` });
      return { ok: false, error: finalMsg };
    } finally {
      clearTimeout(timer);
    }
  }
}
