/**
 * http-client.ts
 *
 * Typed fetch wrapper for plugin → opencode serve calls (v0.4.2 spec §1, §2.3).
 *
 * Responsibilities:
 *   - Auth header on every call: `Authorization: Basic base64("opencode:<password>")`
 *     (spec §6.1; this is the spec's best understanding of opencode serve's
 *     auth scheme and is verified by integration test in BizarHarness-dev).
 *   - `directory` query param on every per-instance call (spec §1.7).
 *   - 30s default timeout via `AbortController` (spec §2.3 / §6.1 env
 *     `BIZAR_HTTP_TIMEOUT_MS`, option `httpTimeoutMs`).
 *   - Never throws on transport errors; returns a discriminated result so
 *     callers can log + surface a clear error to the agent without an
 *     unhandled rejection (spec §2.3 last paragraph).
 *
 * Boundary policy: the only `node:` import allowed in this file is
 * implicit (none). We use the global `fetch` / `AbortController` /
 * `ReadableStream` provided by Bun's runtime. If the test runtime is pure
 * Node, those are available as globals in Node 20+; in Bun they are
 * always available.
 *
 * Note on auth scheme: opencode serve's exact auth scheme is opencode-
 * dependent. The current best understanding, based on v0.4 research, is
 * `Authorization: Basic` with username `opencode`. This must be verified
 * by reading opencode's serve-side code or by integration test. If
 * opencode uses a different scheme (e.g. a custom `x-opencode-password`
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
 * Typed HTTP client for the opencode serve child. All methods take a
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
    // Basic auth: "opencode:<password>" base64-encoded.
    // (spec §6.1; see module-level note re: scheme verification.)
    const credentials = `opencode:${opts.password}`;
    this.authHeader = `Basic ${btoa(credentials)}`;
  }

  // --- Public API ---------------------------------------------------------

  /**
   * POST /session — create a new background session.
   *
   * Verified body per `types.gen.d.ts` line 1811 (spec §1.2, NEW-H6):
   *   { parentID?, title?, agent }
   *
   * The `agent` field is REQUIRED — without it opencode spawns the
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

    return this.request<{ id: string }>(
      "POST",
      `/session?directory=${encodeURIComponent(directory)}`,
      body,
    );
  }

  /**
   * POST /session/{id}/prompt_async — fire the initial prompt.
   *
   * Verified body per `types.gen.d.ts` line 2329 (spec §1.3):
   *   { messageID, model?, agent, parts }
   *
   * `messageID` is plugin-generated (ULID `msg_<ulid>`).
   * Response: 204 No Content on success.
   */
  async sendPrompt(
    opts: SendPromptOptions,
    directory: string,
  ): Promise<HttpResult<void>> {
    const body: Record<string, unknown> = {
      messageID: opts.messageID,
      agent: opts.agent,
      parts: opts.parts,
    };
    if (opts.model) body.model = opts.model;

    return this.request<void>(
      "POST",
      `/session/${encodeURIComponent(opts.sessionId)}/prompt_async?directory=${encodeURIComponent(directory)}`,
      body,
      // 204 No Content → no body to parse
      { expectNoBody: true },
    );
  }

  /**
   * POST /session/{id}/abort — kill a running session.
   *
   * operationId `session.abort`, returns `200: boolean` per
   * `types.gen.d.ts` line 2080 (spec §1.5). This is what `bizar_kill`
   * calls. NOT `DELETE /session/{id}`.
   */
  async abortSession(
    sessionId: string,
    directory: string,
  ): Promise<HttpResult<boolean>> {
    return this.request<boolean>(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(directory)}`,
      null,
    );
  }

  /**
   * GET /session/{id}/message — list the messages of a session.
   *
   * operationId `session.messages`, returns `Array<{ info, parts }>` per
   * `types.gen.d.ts`. We normalize the response to the flattened
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
    const res = await this.request<RawMessage[]>(
      "GET",
      `/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(directory)}`,
    );
    if (!res.ok) return res;
    const normalized: ListMessagesResult[] = res.value.map((m) => ({
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
    const url = `${this.baseUrl}/event?directory=${encodeURIComponent(directory)}`;
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
