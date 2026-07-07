/**
 * event-stream.ts
 *
 * Global SSE subscription for cline serve events (v0.4.2 spec §2.1, §4).
 *
 * Design contract:
 *   - ONE `GET /event?directory=<worktree>` connection per plugin process.
 *   - Events are filtered in-memory by `sessionID` and dispatched to
 *     per-session handlers registered via `onSessionEvent`.
 *   - The connection auto-reconnects with exponential backoff
 *     (1s, 2s, 4s, 8s, 16s, capped at 30s) on unexpected drops.
 *   - During the gap between drop and reconnect, in-flight instances are
 *     NOT marked failed (they may still complete once we reconnect).
 *   - `disconnect()` closes the stream and prevents further reconnects.
 *
 * v0.4.3 — CloudEvents-style schema support (see
 * `.bizar/cline-sse-investigation.md`):
 *   - The actual event schema on cline serve 1.17.7 has two flavors:
 *
 *     1) **Direct events** (flat JSON, native `type` field):
 *        ```
 *        { id, type: "session.idle", properties: { sessionID } }
 *        { id, type: "message.part.delta", properties: { sessionID, ... } }
 *        ```
 *
 *     2) **Sync events** (CloudEvents-style, wrapped):
 *        ```
 *        { type: "sync", syncEvent: {
 *            type: "session.created.1",   // `.1` version suffix
 *            id, seq, aggregateID,
 *            data: { sessionID, info }
 *        }}
 *        ```
 *        Sync events are the primary delivery mechanism for session and
 *        message lifecycle events. Event names like `session.created.1`,
 *        `message.part.updated.1` carry a numeric version suffix.
 *
 *   - This module unwraps sync events and strips the version suffix so
 *     downstream consumers (InstanceManager) see the same logical
 *     `StreamEvent` shape regardless of which wire format arrived.
 *
 * This module is a pure transport. The `InstanceManager` registers a
 * handler per instance that does the actual state work (tool counting,
 * loop-guard detection, status transitions, awaiting collect).
 */

import type { HttpClient, HttpResult } from "./http-client.js";

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

// --- Public event types ---------------------------------------------------

/**
 * The subset of session lifecycle events the plugin cares about. Each
 * variant carries a `sessionID` plus the event-specific payload.
 *
 * The `type` field follows cline's event namespacing
 * (`session.created`, `session.idle`, `message.part.updated`, …).
 *
 * Note: there is no catch-all variant on purpose. The catch-all would
 * have `type: string` which would defeat type narrowing on
 * `ev.type === "session.idle"` checks. Untyped events are dropped
 * silently in `dispatchEvent`.
 */
export type StreamEvent =
  | { type: "session.created"; sessionID: string; raw: unknown }
  | { type: "session.updated"; sessionID: string; raw: unknown }
  | { type: "session.deleted"; sessionID: string; raw: unknown }
  | { type: "session.idle"; sessionID: string; raw: unknown }
  | { type: "session.error"; sessionID: string; error?: string; raw: unknown }
  | { type: "message.updated"; sessionID: string; messageID: string; raw: unknown }
  | {
      type: "message.part.updated";
      sessionID: string;
      messageID: string;
      partID: string;
      part: { type: string; text?: string; error?: string; state?: { status?: string; error?: string } };
      raw: unknown;
    };

/**
 * A per-session event handler. Called for every event whose `sessionID`
 * matches the registration. Handlers are called synchronously; long
 * work should be scheduled (await / setImmediate) inside the handler.
 */
export type SessionEventHandler = (event: StreamEvent) => void;

// --- Stream class ---------------------------------------------------------

/**
 * Owns the single global SSE connection. The plugin constructs one
 * instance at init time and disposes it on plugin shutdown.
 *
 * Public surface (interface contract for Thor's tests):
 *   - `connect()` — open the SSE stream. Idempotent (no-op if already connected).
 *   - `disconnect()` — close the stream; stop reconnecting.
 *   - `onSessionEvent(sessionId, handler)` — register a per-session handler.
 *     Returns an unsubscribe function.
 *
 * Internal lifecycle (not part of the contract):
 *   - `readLoop()` runs until disconnect; on error, schedules a reconnect.
 *   - `parseSseChunk()` splits a raw chunk into individual events.
 *   - `dispatch()` routes each event to handlers whose `sessionID` matches.
 */
export class EventStream {
  private _baseUrl: string;
  private _directory: string;
  private _authHeader: string;
  private _logger: Logger;
  private _http: HttpClient;
  private _handlers = new Map<string, Set<SessionEventHandler>>();
  /** Global handler invoked for every event regardless of session (v0.7.0). */
  private _globalHandler: SessionEventHandler | null = null;
  private _connected = false;
  private _aborted = false;
  private _abortController: AbortController | null = null;
  private _reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectPromise: Promise<void> | null = null;

  /**
   * Register a global handler invoked for every event (regardless of
   * session). Used to forward events to the dashboard publisher. Returns
   * an unsubscribe function. (v0.7.0-alpha.1 — wired into the v2
   * SDK dashboard-client.ts bridge.)
   */
  onEvent(handler: SessionEventHandler): () => void {
    this._globalHandler = handler;
    return () => {
      if (this._globalHandler === handler) {
        this._globalHandler = null;
      }
    };
  }

  constructor(opts: {
    baseUrl: string;
    directory: string;
    authHeader: string;
    logger: Logger;
    http: HttpClient;
  }) {
    this._baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this._directory = opts.directory;
    this._authHeader = opts.authHeader;
    this._logger = opts.logger;
    this._http = opts.http;
  }

  // --- Getters ------------------------------------------------------------

  get connected(): boolean {
    return this._connected;
  }

  get directory(): string {
    return this._directory;
  }

  // --- Lifecycle ----------------------------------------------------------

  /**
   * Open the SSE connection. Idempotent: a second call while a connection
   * is in progress is a no-op that returns the in-flight promise.
   *
   * The first read block-waits up to 5s for the initial event so the
   * caller can confirm the connection is alive (spec §2.1).
   */
  async connect(): Promise<void> {
    if (this._aborted) {
      throw new Error("EventStream: cannot connect after disconnect()");
    }
    if (this._connectPromise !== null) {
      return this._connectPromise;
    }
    this._connectPromise = this.openConnection();
    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  /**
   * Close the stream and stop further reconnects. Idempotent.
   */
  async disconnect(): Promise<void> {
    this._aborted = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._abortController !== null) {
      try {
        this._abortController.abort();
      } catch {
        // ignore
      }
      this._abortController = null;
    }
    if (this._reader !== null) {
      try {
        await this._reader.cancel();
      } catch {
        // ignore
      }
      try {
        this._reader.releaseLock();
      } catch {
        // ignore
      }
      this._reader = null;
    }
    this._connected = false;
  }

  /**
   * Register a handler for events of one session. Returns an unsubscribe
   * function. Multiple handlers per session are allowed.
   */
  onSessionEvent(sessionId: string, handler: SessionEventHandler): () => void {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("EventStream.onSessionEvent: sessionId must be non-empty");
    }
    let set = this._handlers.get(sessionId);
    if (!set) {
      set = new Set();
      this._handlers.set(sessionId, set);
    }
    set.add(handler);
    return () => {
      const s = this._handlers.get(sessionId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this._handlers.delete(sessionId);
    };
  }

  // --- Internal: connection lifecycle ------------------------------------

  private async openConnection(): Promise<void> {
    this._abortController = new AbortController();
    const result: HttpResult<ReadableStream> = await this._http.fetchEventStream(
      this._directory,
      this._abortController.signal,
    );
    if (!result.ok) {
      this._connected = false;
      throw new Error(`EventStream: failed to open SSE: ${result.error}`);
    }
    this._connected = true;
    this._reconnectAttempt = 0;
    this._logger.info(
      `bizar: SSE event stream open (directory=${this._directory})`,
    );
    // Start the read loop in the background.
    void this.readLoop(result.value);
  }

  /**
   * Read the SSE stream chunk by chunk, parse events, and dispatch them.
   * On error, schedule a reconnect (unless we're aborted).
   */
  private async readLoop(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this._reader = reader;
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    try {
      while (!this._aborted) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream closed cleanly. This is unexpected unless we initiated it.
          if (!this._aborted) {
            this._logger.warn("bizar: SSE stream closed unexpectedly; will reconnect");
            this.scheduleReconnect();
          }
          return;
        }
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        // Process as many complete events as we have.
        let sep: number;
        // SSE events are separated by a blank line (\n\n or \r\n\r\n).
        while ((sep = buffer.indexOf("\n\n")) >= 0 || (sep = buffer.indexOf("\r\n\r\n")) >= 0) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + (buffer[sep] === "\r" ? 4 : 2));
          this.processSseBlock(rawEvent);
        }
      }
    } catch (err: unknown) {
      if (this._aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.warn(`bizar: SSE read error: ${msg}; will reconnect`);
      this.scheduleReconnect();
    } finally {
      this._connected = false;
      try {
        this._reader?.releaseLock();
      } catch {
        // ignore
      }
      this._reader = null;
    }
  }

  private processSseBlock(block: string): void {
    if (block.trim() === "") return;
    // An SSE block has lines like `event: <name>` and `data: <payload>`.
    // Some servers only send `data:`. We treat unknown prefix lines as
    // comments and skip them.
    let eventName: string | null = null;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this._logger.debug(`bizar: SSE: dropping non-JSON data (${data.slice(0, 80)}…)`);
      return;
    }
    this.dispatchEvent(eventName, parsed);
  }

  /**
   * Map a raw cline event to a `StreamEvent` and dispatch to handlers.
   *
   * v0.4.3: handles two wire formats.
   *   1) Direct events — `{type, properties: {sessionID, ...}}`.
   *   2) Sync events — `{type: "sync", syncEvent: {type: "x.y.1", data: {...}}}`.
   *      We unwrap the sync wrapper and set `obj` to `syncEvent.data` so
   *      downstream code can read `obj.sessionID`, `obj.part`, etc.
   *
   * After unwrapping, the event type from sync events has a version
   * suffix (e.g. `session.created.1`). We strip the suffix so
   * downstream code can match on `session.created` (the version is
   * for the wire format, not the plugin's logical event name).
   */
  private dispatchEvent(eventName: string | null, raw: unknown): void {
    let obj = raw as Record<string, unknown> | null;
    if (obj === null || typeof obj !== "object") return;

    // Step 1: Detect sync event wrapper, unwrap to the inner data.
    // Sync events have shape: {type: "sync", syncEvent: {type: "x.y.1", data: {...}}}
    // After unwrap, obj points to the inner data so the rest of this
    // method can read fields directly (obj.sessionID, obj.part, etc.).
    let innerType: string | null = null;
    if (obj.type === "sync" && obj.syncEvent) {
      const syncEvent = obj.syncEvent as Record<string, unknown> | null;
      if (syncEvent && typeof syncEvent === "object") {
        if (typeof syncEvent.type === "string") innerType = syncEvent.type;
        const syncData = syncEvent.data;
        if (syncData && typeof syncData === "object") {
          obj = syncData as Record<string, unknown>;
        }
      }
    }

    // Step 2: Resolve the event type and strip the version suffix.
    // Sync event types look like "session.created.1"; we strip to "session.created".
    const typeFromObj = innerType ?? (typeof obj.type === "string" ? obj.type : null);
    const rawType = typeFromObj ?? eventName ?? "unknown";
    const type = stripVersionSuffix(rawType);

    const sessionID = extractSessionId(obj);
    const messageID = extractMessageId(obj);
    // After unwrap, `obj.part` exists for `message.part.updated.*` events
    // (sync) and may exist on the top-level payload. We also fall back to
    // `obj.partID` on the part object itself for sync events whose
    // `data` block does not carry `partID` separately.
    const part = obj.part as { type?: string; text?: string; error?: string; state?: { status?: string; error?: string }; id?: string } | undefined;
    const partID = extractPartId(obj, part);

    // Build the typed event. We use a temporary permissive shape and only
    // assign to a strongly-typed StreamEvent at the end of each branch.
    let event: StreamEvent | null = null;
    if (type === "message.part.updated" && sessionID && part) {
      const partShape: { type: string; text?: string; error?: string; state?: { status?: string; error?: string } } = {
        type: part.type ?? "unknown",
      };
      if (part.text !== undefined) partShape.text = part.text;
      if (part.error !== undefined) partShape.error = part.error;
      if (part.state !== undefined) partShape.state = part.state;
      event = {
        type: "message.part.updated",
        sessionID,
        messageID: messageID ?? "",
        partID,
        part: partShape,
        raw,
      };
    } else if (type === "message.updated" && sessionID) {
      event = { type: "message.updated", sessionID, messageID: messageID ?? "", raw };
    } else if (type === "session.error" && sessionID) {
      // session.error may carry the error string on `properties.error`
      // (direct event) or on `data.error` (sync, but we already
      // unwrapped, so both paths land at `obj.error`).
      const props = obj.properties;
      let errorField: string | undefined =
        typeof obj.error === "string" ? obj.error : undefined;
      if (errorField === undefined && props && typeof props === "object") {
        const p = props as Record<string, unknown>;
        if (typeof p.error === "string") errorField = p.error;
      }
      event = errorField !== undefined
        ? { type: "session.error", sessionID, error: errorField, raw }
        : { type: "session.error", sessionID, raw };
    } else if (type === "session.idle" && sessionID) {
      event = { type: "session.idle", sessionID, raw };
    } else if (type === "session.created" && sessionID) {
      event = { type: "session.created", sessionID, raw };
    } else if (type === "session.updated" && sessionID) {
      event = { type: "session.updated", sessionID, raw };
    } else if (type === "session.deleted" && sessionID) {
      event = { type: "session.deleted", sessionID, raw };
    } else {
      // Unknown / untyped event — drop silently. Logged at debug level.
      // We log the *raw* type (with version suffix) for diagnostics.
      this._logger.debug(
        `bizar: SSE: dropping untyped event (rawType=${rawType}${sessionID ? ` sessionID=${sessionID}` : ""})`,
      );
      return;
    }

    if (event === null) {
      this._logger.debug(`bizar: SSE: event without sessionID (rawType=${rawType})`);
      return;
    }
    this.dispatchToHandlers(sessionID, event);
  }

  private dispatchToHandlers(sessionID: string, event: StreamEvent): void {
    // v0.7.0-alpha.1 — Forward every event to the global handler
    // (typically the dashboard publisher) BEFORE the per-session dispatch.
    // Failures here are isolated so one bad handler doesn't break the
    // dispatch chain for other subscribers.
    if (this._globalHandler) {
      try {
        this._globalHandler(event);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this._logger.warn(
          `bizar: SSE global handler threw for session ${sessionID} (type=${event.type}): ${msg}`,
        );
      }
    }

    const set = this._handlers.get(sessionID);
    if (!set || set.size === 0) {
      this._logger.debug(
        `bizar: SSE event for untracked session ${sessionID} (type=${event.type})`,
      );
      return;
    }
    // Snapshot to avoid mutation during iteration.
    for (const handler of [...set]) {
      try {
        handler(event);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this._logger.warn(
          `bizar: SSE handler threw for session ${sessionID} (type=${event.type}): ${msg}`,
        );
      }
    }
  }

  // --- Reconnect ----------------------------------------------------------

  private scheduleReconnect(): void {
    if (this._aborted) return;
    if (this._reconnectTimer !== null) return;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
    const base = 1000 * Math.pow(2, this._reconnectAttempt);
    const delay = Math.min(30_000, base);
    this._reconnectAttempt += 1;
    this._logger.warn(`bizar: SSE reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._aborted) return;
      void this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    try {
      this._abortController = new AbortController();
      const result = await this._http.fetchEventStream(
        this._directory,
        this._abortController.signal,
      );
      if (!result.ok) {
        this._logger.warn(`bizar: SSE reconnect failed: ${result.error}`);
        this.scheduleReconnect();
        return;
      }
      this._connected = true;
      this._reconnectAttempt = 0;
      this._logger.info("bizar: SSE reconnected");
      void this.readLoop(result.value);
    } catch (err: unknown) {
      if (this._aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.warn(`bizar: SSE reconnect threw: ${msg}`);
      this.scheduleReconnect();
    }
  }
}

// --- Helpers --------------------------------------------------------------

/**
 * Extract the `sessionID` from an cline event payload.
 *
 * v0.4.3: this is called AFTER sync unwrapping, so the `obj` we receive
 * is either:
 *   - A direct event: `{properties: {sessionID}}` or `{sessionID}`.
 *   - A sync event's `data` block: `{sessionID, ...}` (top-level).
 *
 * We check (in order):
 *   1. `properties.sessionID` / `properties.sessionId` (direct events)
 *   2. Top-level `sessionID` / `sessionId` (direct or post-unwrapped sync)
 *
 * Returns `undefined` if none of those is present.
 */
function extractSessionId(obj: Record<string, unknown>): string | undefined {
  const props = obj.properties;
  if (props && typeof props === "object") {
    const p = props as Record<string, unknown>;
    if (typeof p.sessionID === "string" && p.sessionID.length > 0) return p.sessionID;
    if (typeof p.sessionId === "string" && p.sessionId.length > 0) return p.sessionId;
  }
  if (typeof obj.sessionID === "string" && obj.sessionID.length > 0) return obj.sessionID;
  if (typeof obj.sessionId === "string" && obj.sessionId.length > 0) return obj.sessionId;
  return undefined;
}

function extractMessageId(obj: Record<string, unknown>): string | undefined {
  const props = obj.properties;
  if (props && typeof props === "object") {
    const p = props as Record<string, unknown>;
    if (typeof p.messageID === "string") return p.messageID;
    if (typeof p.messageId === "string") return p.messageId;
  }
  if (typeof obj.messageID === "string") return obj.messageID;
  if (typeof obj.messageId === "string") return obj.messageId;
  return undefined;
}

/**
 * Extract the `partID` from an event payload. We check (in order):
 *   1. `properties.partID` (direct events like `message.part.delta`)
 *   2. Top-level `partID` (after sync unwrap, if the data block carries it)
 *   3. `part.id` (sync `message.part.updated.1` — the part object itself
 *      carries its own id)
 */
function extractPartId(
  obj: Record<string, unknown>,
  part: { id?: string } | undefined,
): string {
  const props = obj.properties;
  if (props && typeof props === "object") {
    const p = props as Record<string, unknown>;
    if (typeof p.partID === "string" && p.partID.length > 0) return p.partID;
    if (typeof p.partId === "string" && p.partId.length > 0) return p.partId;
  }
  if (typeof obj.partID === "string" && obj.partID.length > 0) return obj.partID;
  if (typeof obj.partId === "string" && obj.partId.length > 0) return obj.partId;
  if (part && typeof part.id === "string" && part.id.length > 0) return part.id;
  return "";
}

/**
 * Strip a trailing version suffix from an event type.
 * e.g. `"session.created.1"` → `"session.created"`, `"foo.bar.baz.12"` → `"foo.bar.baz"`.
 * If the type has no `.N` suffix at the end, it is returned unchanged.
 */
function stripVersionSuffix(type: string): string {
  return type.replace(/\.\d+$/, "");
}
