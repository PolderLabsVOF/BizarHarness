/**
 * background.ts
 *
 * InstanceManager — owns the in-memory map of background instances and
 * orchestrates the per-instance event handlers (v0.4.2 spec §2.2, §4, §5.4, §6.2).
 *
 * Responsibilities:
 *   - `add()` is the single entry point for inserting a new instance. The
 *     cap check and the map insertion happen inside one async mutex, so
 *     concurrent `add()` calls can never exceed the cap (HIGH-10 / HIGH-12 /
 *     HIGH-21 / HIGH-38).
 *   - `update()` patches the in-memory state and persists to disk. The
 *     per-instance mutex from {@link BackgroundStateStore} serializes
 *     concurrent updates to the same instance.
 *   - `kill()` and `collect()` operate on the in-memory state; the HTTP
 *     calls go through {@link HttpClient}.
 *   - `rebuildInMemoryMap()` is called on init (spec §5.4). Any in-flight
 *     `running` or `pending` instance is marked `failed` because the
 *     serve child is new and the opencode sessions are gone.
 *   - `shutdownAll()` is called on `dispose` / SIGTERM. Marks all in-memory
 *     instances `failed` with `error: "plugin shutting down"`, aborts
 *     each via `POST /session/{id}/abort` (best-effort, 5s timeout per
 *     call), then waits for the serve child to exit.
 *
 * Per-instance event handler (spec §4.1, §4.3, §6.2):
 *   - For every `EventMessagePartUpdated` of `type: "tool"`, increment
 *     `toolCallCount`. If the count reaches the per-instance cap, abort
 *     the session and mark the instance `failed` with
 *     `error: "Tool-call cap reached (N). Aborted to prevent cost runaway."`.
 *   - If the tool part's error matches the loop-guard regex
 *     `Loop protection: 12 identical calls to (\S+)`, capture the tool
 *     name into `loopGuardTool`, set `error` to the canonical string,
 *     and mark the instance `failed`.
 *   - For every `EventMessagePartUpdated` of `type: "text"` on an
 *     assistant message, refresh `resultPreview` (last 200 chars).
 *   - On `EventSessionIdle`, mark the instance `done`.
 *   - On `EventSessionError`, mark the instance `failed` with the error.
 *
 * "Track BEFORE HTTP" invariant (spec §2.2 / HIGH-21):
 *   - The instance is added to the map (status `pending`) BEFORE any HTTP
 *     call. If the HTTP call fails, the instance is marked `failed`. The
 *     map is never left in a half-state.
 */

import type { BackgroundState, BackgroundStateStore, Logger } from "./background-state.js";
import { TERMINAL_STATUSES } from "./background-state.js";
import type { HttpClient } from "./http-client.js";
import type { EventStream, StreamEvent, SessionEventHandler } from "./event-stream.js";
import type { ServeLifecycle } from "./serve.js";

// --- Public surface -------------------------------------------------------

/** A snapshot of an instance for the `bizar_status` tool. */
export interface InstanceView {
  instanceId: string;
  agent: string;
  status: BackgroundState["status"];
  startedAt: number;
  completedAt?: number;
  toolCallCount: number;
  promptPreview: string;
  resultPreview?: string;
  error?: string;
  parentAgent: string;
  parentInstanceId?: string;
  sessionId: string;
}

/** The return shape of `bizar_collect`. */
export interface CollectResult {
  status: BackgroundState["status"];
  result: string;
  toolCallCount: number;
  durationMs: number;
  error?: string;
}

/** Filter shape for `list()`. */
export interface InstanceListFilter {
  agent?: string;
  status?: BackgroundState["status"];
}

/** Shape passed to `add()`. The status is forced to `pending` and the
 *  startedAt is stamped by the manager. */
export type AddDraft = Omit<BackgroundState, "status" | "startedAt">;

/** Return type of `add()`. `"cap_reached"` is a sentinel for the
 *  overshoot path; the populated state is the success path. */
export type AddResult = BackgroundState | "cap_reached";

// --- Constants ------------------------------------------------------------

/** Maximum length of `resultPreview` per spec §3.2. */
const RESULT_PREVIEW_MAX = 200;
/** Maximum length of `promptPreview` stored in the JSON. */
const PROMPT_PREVIEW_MAX = 200;
/** Tool-call cap regex (spec §4.1, NEW-H8 pin). */
const LOOP_GUARD_RE = /Loop protection: 12 identical calls to (\S+)/;

// --- Class ---------------------------------------------------------------

/**
 * Manages the in-memory map of background instances. Created once at
 * plugin init; lives for the life of the plugin process.
 */
export class InstanceManager {
  private instances = new Map<string, BackgroundState>();
  private addLock: Promise<unknown> = Promise.resolve();
  private stateStore: BackgroundStateStore;
  private maxConcurrent: number;
  private toolCallCap: number;
  private logger: Logger;
  private serve: ServeLifecycle;
  private http: HttpClient;
  private stream: EventStream;
  private worktree: string;

  constructor(opts: {
    stateStore: BackgroundStateStore;
    maxConcurrent: number;
    toolCallCap: number;
    logger: Logger;
    serve: ServeLifecycle;
    http: HttpClient;
    stream: EventStream;
  }) {
    this.stateStore = opts.stateStore;
    this.maxConcurrent = Math.max(1, Math.floor(opts.maxConcurrent));
    this.toolCallCap = Math.max(1, Math.floor(opts.toolCallCap));
    this.logger = opts.logger;
    this.serve = opts.serve;
    this.http = opts.http;
    this.stream = opts.stream;
    this.worktree = opts.serve.worktree;
  }

  // --- Getters ------------------------------------------------------------

  get size(): number {
    return this.instances.size;
  }

  // --- Atomic add (spec §2.2) ---------------------------------------------

  /**
   * Add a new instance. The cap check and the map insertion are inside
   * one async mutex — no half-state on overshoot. Returns `"cap_reached"`
   * on overshoot; the full `BackgroundState` on success.
   */
  async add(draft: AddDraft): Promise<AddResult> {
    return (await (this.addLock = this.addLock.then(async () => {
      // Count "live" instances: anything not yet terminal.
      let live = 0;
      for (const inst of this.instances.values()) {
        if (!TERMINAL_STATUSES.has(inst.status)) live += 1;
      }
      if (live >= this.maxConcurrent) {
        this.logger.warn(
          `bizar: max concurrent instances reached (${this.maxConcurrent}); rejecting add`,
        );
        return "cap_reached" as const;
      }
      const now = Date.now();
      const full: BackgroundState = {
        ...draft,
        status: "pending",
        startedAt: now,
        toolCallCount: draft.toolCallCount ?? 0,
        // Trim the prompt preview so the JSON stays small.
        promptPreview: (draft.promptPreview ?? "").slice(0, PROMPT_PREVIEW_MAX),
      };
      this.instances.set(draft.instanceId, full);
      // Persist asynchronously; failure is logged but does not roll back
      // the in-memory insert (the instance is "tracked" either way).
      this.stateStore.save(full).catch((err: unknown) => {
        this.logger.warn(
          `bizar: failed to persist new instance ${draft.instanceId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      // Subscribe to events for this session so we can update state and
      // forward terminal events to awaiters.
      this.attachEventHandler(full);
      return full;
    }))) as AddResult;
  }

  // --- Read access --------------------------------------------------------

  /**
   * Look up an instance by id. Returns null if not found.
   */
  async get(instanceId: string): Promise<BackgroundState | null> {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * Snapshot of in-memory instances, filtered. Used by `bizar_status`.
   */
  async list(filter?: InstanceListFilter): Promise<InstanceView[]> {
    const out: InstanceView[] = [];
    for (const inst of this.instances.values()) {
      if (filter?.agent && inst.agent !== filter.agent) continue;
      if (filter?.status && inst.status !== filter.status) continue;
      out.push(toView(inst));
    }
    // Sort by startedAt ascending so callers see the oldest first.
    out.sort((a, b) => a.startedAt - b.startedAt);
    return out;
  }

  // --- Update -------------------------------------------------------------

  /**
   * Patch an instance in-memory and persist. Returns silently if the
   * instance is not found. Mutations that would set a terminal state
   * stamp `completedAt` automatically.
   */
  async update(instanceId: string, patch: Partial<BackgroundState>): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    await this.stateStore.withLock(instanceId, async () => {
      const current = this.instances.get(instanceId);
      if (!current) return;
      Object.assign(current, patch);
      if (TERMINAL_STATUSES.has(patch.status ?? current.status) && !current.completedAt) {
        current.completedAt = Date.now();
      }
      try {
        await this.stateStore.save(current);
      } catch (err: unknown) {
        this.logger.warn(
          `bizar: failed to persist update for ${instanceId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  // --- Kill ---------------------------------------------------------------

  /**
   * Abort the opencode session and mark the instance `killed`. If the
   * instance is already in a terminal state, this is a no-op (spec §1.5,
   * MEDIUM-40).
   */
  async kill(instanceId: string): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    if (TERMINAL_STATUSES.has(inst.status)) {
      this.logger.debug(
        `bizar: kill(${instanceId}) is a no-op (status=${inst.status})`,
      );
      return;
    }
    // Abort the opencode session. The next SSE event for this session
    // (EventSessionIdle or EventSessionError) will finalize the status.
    const abort = await this.http.abortSession(inst.sessionId, this.worktree);
    if (!abort.ok) {
      this.logger.warn(
        `bizar: kill(${instanceId}): abort failed: ${abort.error}`,
      );
      // Even if the abort call failed, we still want the in-memory state
      // to reflect a deliberate kill so the user sees it. The next SSE
      // event will overwrite if it disagrees.
    }
    await this.update(instanceId, {
      status: "killed",
      completedAt: Date.now(),
    });
    this.logger.info(`bizar: killed background instance ${instanceId}`);
  }
  // --- Collect ------------------------------------------------------------

  /**
   * Wait for the instance to reach a terminal state (or until
   * `timeoutMs` elapses), then build the result string per spec §4.4.
   *
   * If the instance is already terminal on entry, we skip the wait and
   * go straight to result construction.
   */
  async collect(instanceId: string, timeoutMs: number): Promise<CollectResult> {
    const inst = this.instances.get(instanceId);
    if (!inst) {
      throw new Error(`collect: instance ${instanceId} not found`);
    }
    const startedAt = inst.startedAt;
    const deadline = Date.now() + Math.max(0, timeoutMs);

    // 1. Wait for terminal state.
    if (!TERMINAL_STATUSES.has(inst.status)) {
      const reachedTerminal = await new Promise<boolean>((resolve) => {
        const remaining = Math.max(0, deadline - Date.now());
        if (remaining === 0) {
          resolve(false);
          return;
        }
        const timer = setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, remaining);
        const unsubscribe = this.stream.onSessionEvent(inst.sessionId, (ev) => {
          if (
            ev.type === "session.idle" ||
            ev.type === "session.error"
          ) {
            clearTimeout(timer);
            unsubscribe();
            resolve(true);
            return;
          }
          // Also resolve on tool-cap / loop-guard (which we set ourselves).
          const cur = this.instances.get(instanceId);
          if (cur && TERMINAL_STATUSES.has(cur.status)) {
            clearTimeout(timer);
            unsubscribe();
            resolve(true);
          }
        });
        // Re-check after subscribing in case the state already changed.
        const cur = this.instances.get(instanceId);
        if (cur && TERMINAL_STATUSES.has(cur.status)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
      if (!reachedTerminal) {
        // Timed out. Return what we have.
        const final = this.instances.get(instanceId);
        if (final && !TERMINAL_STATUSES.has(final.status)) {
          await this.update(instanceId, {
            status: "timed_out",
            completedAt: Date.now(),
          });
        }
        const dur = Date.now() - startedAt;
        const final2 = this.instances.get(instanceId);
        const out: CollectResult = {
          status: final2?.status ?? "timed_out",
          result: final2?.resultPreview ?? "",
          toolCallCount: final2?.toolCallCount ?? 0,
          durationMs: dur,
          error: `collect timed out after ${timeoutMs}ms`,
        };
        return out;
      }
    }

    // 2. Build the result. Fetch messages from the opencode server and
    //    concatenate the assistant text parts.
    const final = this.instances.get(instanceId);
    if (!final) {
      throw new Error(`collect: instance ${instanceId} disappeared`);
    }
    const resultText = await this.buildResultText(final);
    const dur = (final.completedAt ?? Date.now()) - startedAt;
    const out: CollectResult = {
      status: final.status,
      result: resultText,
      toolCallCount: final.toolCallCount,
      durationMs: dur,
    };
    if (final.error !== undefined) out.error = final.error;
    return out;
  }

  // --- Rebuild on init (spec §5.4) ----------------------------------------

  /**
   * Scan the bg directory, load every instance, and rebuild the in-memory
   * map. Any `running` or `pending` instance is marked `failed` because
   * the serve child is new and the opencode sessions are gone.
   * Historical records (done, failed, killed, timed_out) are preserved.
   */
  async rebuildInMemoryMap(): Promise<void> {
    let all: BackgroundState[];
    try {
      all = await this.stateStore.list();
    } catch (err: unknown) {
      this.logger.warn(
        `bizar: rebuildInMemoryMap: list() failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    let rebuilt = 0;
    let failed = 0;
    for (const inst of all) {
      this.instances.set(inst.instanceId, inst);
      rebuilt += 1;
      if (inst.status === "running" || inst.status === "pending") {
        const message =
          inst.status === "pending"
            ? "plugin restarted while instance was pending"
            : "plugin restarted; serve child is new";
        await this.update(inst.instanceId, {
          status: "failed",
          error: message,
          completedAt: Date.now(),
        });
        failed += 1;
      }
    }
    if (rebuilt > 0) {
      this.logger.info(
        `bizar: rebuilt in-memory map (${rebuilt} instances, ${failed} marked failed)`,
      );
    }
  }

  // --- Shutdown (spec §5.3) ----------------------------------------------

  /**
   * Mark all in-memory instances as failed with `error: "plugin shutting down"`,
   * abort all running sessions best-effort (5s timeout per call, in
   * parallel), then return. The serve child termination is the
   * caller's responsibility.
   */
  async shutdownAll(): Promise<void> {
    const live: BackgroundState[] = [];
    for (const inst of this.instances.values()) {
      if (!TERMINAL_STATUSES.has(inst.status)) {
        live.push(inst);
      }
    }
    // Phase 1: mark failed first (spec §5.3 step 1).
    for (const inst of live) {
      await this.update(inst.instanceId, {
        status: "failed",
        error: "plugin shutting down",
        completedAt: Date.now(),
      });
    }
    // Phase 2: best-effort aborts in parallel, 5s per call.
    const abortPromises = live.map((inst) =>
      withTimeout(this.http.abortSession(inst.sessionId, this.worktree), 5_000).catch(
        () => undefined,
      ),
    );
    await Promise.allSettled(abortPromises);
    this.logger.info(`bizar: shutdownAll complete (${live.length} instances aborted)`);
  }

  // --- Internal: per-session event handler -------------------------------

  private attachEventHandler(inst: BackgroundState): () => void {
    const handler: SessionEventHandler = (ev: StreamEvent) => {
      void this.handleInstanceEvent(inst.instanceId, ev);
    };
    const unsubscribe = this.stream.onSessionEvent(inst.sessionId, handler);
    return unsubscribe;
  }

  private async handleInstanceEvent(
    instanceId: string,
    ev: StreamEvent,
  ): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    // Already terminal — ignore further events (e.g., after kill, an
    // EventSessionError may still arrive).
    if (TERMINAL_STATUSES.has(inst.status)) return;

    if (ev.type === "message.part.updated") {
      await this.onPartUpdated(instanceId, ev);
    } else if (ev.type === "session.idle") {
      await this.update(instanceId, {
        status: "done",
        completedAt: Date.now(),
      });
    } else if (ev.type === "session.error") {
      const errMsg = ev.error ?? "session error";
      await this.update(instanceId, {
        status: "failed",
        error: errMsg,
        completedAt: Date.now(),
      });
    }
  }

  private async onPartUpdated(
    instanceId: string,
    ev: Extract<StreamEvent, { type: "message.part.updated" }>,
  ): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    const part = ev.part;

    // --- Tool-call cap (spec §6.2) ---
    if (part.type === "tool") {
      const nextCount = inst.toolCallCount + 1;
      const patch: Partial<BackgroundState> = { toolCallCount: nextCount };
      if (nextCount >= this.toolCallCap) {
        // Abort and mark failed. Use a fire-and-forget abort because we
        // do not want to block the handler on a network call.
        this.http
          .abortSession(inst.sessionId, this.worktree)
          .catch(() => undefined);
        patch.status = "failed";
        patch.error = `Tool-call cap reached (${nextCount}). Aborted to prevent cost runaway.`;
        patch.completedAt = Date.now();
      }
      await this.update(instanceId, patch);
      if (patch.status === "failed") return;
    }

    // --- Loop-guard threshold-12 detection (spec §4.1) ---
    if (part.type === "tool" && !inst.loopGuardTool) {
      const errorText = readToolError(part);
      if (errorText) {
        const m = errorText.match(LOOP_GUARD_RE);
        if (m && m[1]) {
          const tool = m[1];
          await this.update(instanceId, {
            status: "failed",
            error: `Loop protection: 12 identical calls to ${tool}`,
            loopGuardTool: tool,
            completedAt: Date.now(),
          });
          return;
        }
      }
    }

    // --- Text-part result preview refresh (spec §3.2) ---
    if (part.type === "text" && typeof part.text === "string") {
      const preview = part.text.slice(-RESULT_PREVIEW_MAX);
      const newIds = [...(inst.resultMessageIds ?? []), ev.messageID];
      // Deduplicate messageIDs.
      const seen = new Set<string>();
      const uniq = newIds.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      await this.update(instanceId, {
        resultPreview: preview,
        resultMessageIds: uniq,
      });
    }
  }

  /**
   * Build the result text for `collect` per spec §4.4:
   *   - Fetch assistant messages via `GET /session/{id}/message`.
   *   - Concatenate `TextPart.text` in order; skip everything else.
   *   - If `loopGuardTool` is set, prepend the marker.
   */
  private async buildResultText(inst: BackgroundState): Promise<string> {
    const res = await this.http.listMessages(inst.sessionId, this.worktree);
    if (!res.ok) {
      this.logger.warn(`bizar: collect: listMessages failed: ${res.error}`);
      return inst.resultPreview ?? "";
    }
    const textParts: string[] = [];
    for (const msg of res.value) {
      if (msg.role !== "assistant") continue;
      for (const p of msg.parts) {
        if (p.type !== "text") continue;
        if (typeof p.text === "string" && p.text.length > 0) {
          textParts.push(p.text);
        }
      }
    }
    const body = textParts.join("");
    if (inst.loopGuardTool) {
      return `[loop guard: 12 identical calls to ${inst.loopGuardTool}]\n${body}`;
    }
    return body;
  }
}

// --- Helpers --------------------------------------------------------------

/**
 * Generate a unique instance id: `bgr_<22-char base32>` (ULID-like).
 * We use 16 random bytes encoded as 22 base32 characters. The prefix
 * `bgr_` makes the file naming scheme obvious.
 */
export function generateInstanceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `bgr_${base32(bytes)}`;
}

/**
 * Crockford base32 (no I, L, O, U) encoder for 16 bytes → 26 chars.
 * We use 16 bytes (128 bits) to give plenty of entropy; only the first
 * 22 chars are used for the actual id and the last 4 are dropped.
 */
function base32(bytes: Uint8Array): string {
  const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  // Encode 5 bytes → 8 chars; pad the last group with zeros.
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 0x1f];
  return out.slice(0, 22);
}

/**
 * Generate a unique message id: `msg_<22-char base32>`. Same encoding
 * as `generateInstanceId`. Used for `POST /session/{id}/prompt_async`.
 */
export function generateMessageId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `msg_${base32(bytes)}`;
}

function toView(inst: BackgroundState): InstanceView {
  const v: InstanceView = {
    instanceId: inst.instanceId,
    agent: inst.agent,
    status: inst.status,
    startedAt: inst.startedAt,
    toolCallCount: inst.toolCallCount,
    promptPreview: inst.promptPreview,
    parentAgent: inst.parentAgent,
    sessionId: inst.sessionId,
  };
  if (inst.completedAt !== undefined) v.completedAt = inst.completedAt;
  if (inst.resultPreview !== undefined) v.resultPreview = inst.resultPreview;
  if (inst.error !== undefined) v.error = inst.error;
  if (inst.parentInstanceId !== undefined) v.parentInstanceId = inst.parentInstanceId;
  return v;
}

/**
 * Extract the canonical loop-guard error string from a tool part. The
 * part may carry the error either on `part.error` or on
 * `part.state.error` (per spec §4.1).
 */
function readToolError(part: { error?: string; state?: { error?: string } }): string | null {
  if (typeof part.error === "string" && part.error.length > 0) return part.error;
  if (part.state && typeof part.state.error === "string" && part.state.error.length > 0) {
    return part.state.error;
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
