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
 * v0.3.0 — stall and thinking-loop protection:
 *   - Every event handler updates `lastEventAt` (the "heartbeat"). The
 *     stall checker fires every `STALL_CHECK_INTERVAL_MS`; if a non-terminal
 *     instance has `now - lastEventAt > backgroundStallTimeoutMs`, the
 *     session is aborted and the instance marked `failed`.
 *   - `tool` and `text` parts advance `lastToolOrTextAt`. `thinking`
 *     parts do NOT advance it; that is the loop indicator.
 *   - The thinking-loop checker fires every `STALL_CHECK_INTERVAL_MS`. For
 *     a `running` instance with `now - lastToolOrTextAt >
 *     backgroundThinkingLoopTimeoutMs`:
 *       - If `interventionCount < backgroundMaxInterventions`: send a
 *         research-intervention prompt (fire-and-forget) and increment the
 *         counter.
 *       - Otherwise: abort the session and mark `failed`.
 *   - When a `tool` or `text` part arrives after one or more interventions,
 *     the counter is reset to 0 (sign of progress). The intervention
 *     metadata is cleared so a later status check does not show stale
 *     intervention info.
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
import { researchInterventionPrompt } from "./research-prompt.js";

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
  // v0.3.0 — stall and thinking-loop protection
  lastEventAt?: number;
  interventionCount?: number;
  interventionAt?: number;
  interventionReason?: string;
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

/**
 * How often the stall + thinking-loop checker fires. 15 seconds is short
 * enough to detect stalls within one tick of the default 3-min stall
 * timeout, and long enough that the per-instance mutex is not constantly
 * contested. Spec §v0.3.0.
 */
const STALL_CHECK_INTERVAL_MS = 15_000;

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
  // v0.3.0 — stall and thinking-loop protection
  private stallTimeoutMs: number;
  private thinkingLoopTimeoutMs: number;
  private maxInterventions: number;
  /** Interval handle for the periodic stall + thinking-loop checker. */
  private stallCheckerTimer: ReturnType<typeof setInterval> | null = null;
  /** Guard so tests can disable the interval without monkey-patching. */
  private stallCheckerDisabled = false;

  constructor(opts: {
    stateStore: BackgroundStateStore;
    maxConcurrent: number;
    toolCallCap: number;
    logger: Logger;
    serve: ServeLifecycle;
    http: HttpClient;
    stream: EventStream;
    // v0.3.0
    stallTimeoutMs?: number;
    thinkingLoopTimeoutMs?: number;
    maxInterventions?: number;
  }) {
    this.stateStore = opts.stateStore;
    this.maxConcurrent = Math.max(1, Math.floor(opts.maxConcurrent));
    this.toolCallCap = Math.max(1, Math.floor(opts.toolCallCap));
    this.logger = opts.logger;
    this.serve = opts.serve;
    this.http = opts.http;
    this.stream = opts.stream;
    this.worktree = opts.serve.worktree;
    this.stallTimeoutMs = Math.max(
      1_000,
      Math.floor(opts.stallTimeoutMs ?? 180_000),
    );
    this.thinkingLoopTimeoutMs = Math.max(
      1_000,
      Math.floor(opts.thinkingLoopTimeoutMs ?? 300_000),
    );
    this.maxInterventions = Math.max(1, Math.floor(opts.maxInterventions ?? 1));
    // Schedule the periodic stall + thinking-loop checker. The interval
    // reference is stored so `shutdownAll` / `dispose` can clear it.
    this.stallCheckerTimer = setInterval(
      () => void this.runStallAndLoopChecks(),
      STALL_CHECK_INTERVAL_MS,
    );
  }

  // --- Getters ------------------------------------------------------------

  get size(): number {
    return this.instances.size;
  }

  /** Current stall timeout (ms). Exposed for tests. */
  get stallTimeoutMsValue(): number {
    return this.stallTimeoutMs;
  }

  /** Current thinking-loop timeout (ms). Exposed for tests. */
  get thinkingLoopTimeoutMsValue(): number {
    return this.thinkingLoopTimeoutMs;
  }

  /** Current max interventions. Exposed for tests. */
  get maxInterventionsValue(): number {
    return this.maxInterventions;
  }

  /**
   * Disable the periodic stall + thinking-loop checker. Used by tests
   * that want to call `runStallAndLoopChecks()` directly without racing
   * the interval. Idempotent.
   */
  disablePeriodicChecks(): void {
    this.stallCheckerDisabled = true;
    if (this.stallCheckerTimer !== null) {
      clearInterval(this.stallCheckerTimer);
      this.stallCheckerTimer = null;
    }
  }

  /**
   * Run one iteration of the stall + thinking-loop checker. Public so
   * tests can invoke it deterministically. Production code drives this
   * via the `setInterval` registered in the constructor.
   */
  async runStallAndLoopChecks(): Promise<void> {
    if (this.stallCheckerDisabled) return;
    // Snapshot the instance ids so we do not iterate while the map mutates.
    const ids: string[] = [];
    for (const inst of this.instances.values()) {
      if (TERMINAL_STATUSES.has(inst.status)) continue;
      ids.push(inst.instanceId);
    }
    for (const id of ids) {
      const inst = this.instances.get(id);
      if (!inst || TERMINAL_STATUSES.has(inst.status)) continue;
      const now = Date.now();
      // `lastEventAt` / `lastToolOrTextAt` are seeded by `add()` and
      // backfilled in `readState`, so they are guaranteed to be set on
      // any instance that ever reached this method. We coalesce with
      // `?? 0` because TS strict mode treats the schema field as
      // optional — the value is informational in the rare case where
      // it is missing (an old or corrupt state file).
      const lastEventAt = inst.lastEventAt ?? 0;
      const lastToolOrTextAt = inst.lastToolOrTextAt ?? 0;
      // Stall check fires first; it is the more severe failure.
      if (now - lastEventAt > this.stallTimeoutMs) {
        await this._abortAsStalled(inst);
        continue;
      }
      // Thinking-loop check applies to `running` instances only. A
      // `pending` instance has not yet started generating, so it is not
      // a candidate for the loop detector.
      if (inst.status === "running") {
        const since = now - lastToolOrTextAt;
        if (since > this.thinkingLoopTimeoutMs) {
          const currentCount = inst.interventionCount ?? 0;
          if (currentCount < this.maxInterventions) {
            await this._sendIntervention(inst, since);
          } else {
            await this._abortAsThinkingLoop(inst, since);
          }
        }
      }
    }
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
        // v0.3.0 — seed the liveness timestamps so the stall and
        // thinking-loop checkers have a baseline. We seed BOTH from
        // `startedAt` so a freshly-spawned instance is not immediately
        // flagged as stalled while the session is still being created
        // (the first event typically arrives within seconds).
        lastEventAt: now,
        lastToolOrTextAt: now,
        interventionCount: 0,
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
   *
   * Also clears the v0.3.0 stall-checker interval. After `shutdownAll`,
   * the manager is effectively inert — no more periodic checks will
   * fire even though the InstanceManager object itself is still alive.
   */
  async shutdownAll(): Promise<void> {
    // v0.3.0 — clear the periodic checker first so it does not race
    // the in-flight updates below.
    if (this.stallCheckerTimer !== null) {
      clearInterval(this.stallCheckerTimer);
      this.stallCheckerTimer = null;
    }
    this.stallCheckerDisabled = true;
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

  // --- v0.3.0 stall and thinking-loop helpers ----------------------------

  /**
   * Mark an instance `failed` with the canonical stall message and
   * fire-and-forget the opencode abort call. The stall timeout is
   * intentionally short enough that an abort that fails gracefully
   * (the serve child is dead, etc.) does not leave the user waiting.
   */
  private async _abortAsStalled(inst: BackgroundState): Promise<void> {
    const lastEventAt = inst.lastEventAt ?? 0;
    const sinceMs = Date.now() - lastEventAt;
    this.logger.warn(
      `bizar: instance ${inst.instanceId} stalled (no event for ${sinceMs}ms); aborting`,
    );
    // Fire-and-forget. If the serve child is dead, this returns a
    // failure result but we still mark the instance failed in-memory.
    this.http
      .abortSession(inst.sessionId, this.worktree)
      .catch(() => undefined);
    await this.update(inst.instanceId, {
      status: "failed",
      error: `No activity for ${this.stallTimeoutMs}ms — LLM appears stalled`,
      completedAt: Date.now(),
    });
  }

  /**
   * Send the research-intervention prompt to the running session. The
   * message interrupts the current generation and starts a new turn
   * with the prompt as the next user message. This is fire-and-forget:
   * we do not wait for the prompt to complete, only for the HTTP call
   * to return.
   */
  private async _sendIntervention(
    inst: BackgroundState,
    sinceMs: number,
  ): Promise<void> {
    const messageID = generateMessageId();
    const prompt = researchInterventionPrompt(sinceMs);
    const currentCount = inst.interventionCount ?? 0;
    this.logger.warn(
      `bizar: instance ${inst.instanceId} thinking loop (${sinceMs}ms without tool/text); sending intervention #${currentCount + 1}/${this.maxInterventions}`,
    );
    try {
      await this.http.sendPrompt(
        {
          sessionId: inst.sessionId,
          messageID,
          agent: inst.agent,
          parts: [{ type: "text", text: prompt }],
        },
        this.worktree,
      );
    } catch (err: unknown) {
      // We swallow the error: the periodic checker will try again next
      // tick. The intervention counter is still incremented below so
      // we eventually escalate to an abort if the prompt keeps failing.
      this.logger.warn(
        `bizar: intervention prompt send failed for ${inst.instanceId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const reason = `thinking loop (${formatDuration(sinceMs)} without tool/text)`;
    await this.update(inst.instanceId, {
      interventionCount: currentCount + 1,
      interventionAt: Date.now(),
      interventionReason: reason,
      // Bumping lastEventAt here is intentional: the intervention call
      // counted as an HTTP-driven activity, so the stall checker does
      // not fire immediately after.
      lastEventAt: Date.now(),
    });
  }

  /**
   * Mark an instance `failed` with the canonical thinking-loop message
   * and fire-and-forget the abort call.
   */
  private async _abortAsThinkingLoop(
    inst: BackgroundState,
    sinceMs: number,
  ): Promise<void> {
    this.logger.warn(
      `bizar: instance ${inst.instanceId} thinking loop exhausted ${this.maxInterventions} intervention(s) over ${sinceMs}ms; aborting`,
    );
    this.http
      .abortSession(inst.sessionId, this.worktree)
      .catch(() => undefined);
    await this.update(inst.instanceId, {
      status: "failed",
      error: `Thinking loop detected: ${formatDuration(sinceMs)} of thinking without tool calls or output. Spawn a Mimir agent for research.`,
      completedAt: Date.now(),
    });
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

    // v0.3.0 — every event advances the heartbeat. We do this BEFORE
    // any further work (or inside the per-instance mutex in update())
    // so the stall checker sees the freshest timestamp regardless of
    // how the rest of the handler proceeds.
    inst.lastEventAt = Date.now();

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

    // v0.3.0 — tool and text parts advance the "progress" timestamp.
    // `thinking` parts do NOT, because that is the loop indicator.
    if (part.type === "tool" || part.type === "text") {
      inst.lastToolOrTextAt = Date.now();
      // The agent has shown concrete progress after one or more
      // interventions — reset the intervention counter so the next
      // thinking loop has a fresh budget. Clear the intervention
      // metadata so a later status check does not show stale info.
      if ((inst.interventionCount ?? 0) > 0) {
        inst.interventionCount = 0;
        delete inst.interventionAt;
        delete inst.interventionReason;
      }
    }

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
 * Format a millisecond duration as `Xm Ys` (or just `Ys` if under a minute).
 * Used in stall and thinking-loop error messages.
 */
function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

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
    // v0.3.0 — stall and thinking-loop protection. Always include
    // lastEventAt so a status caller can see how fresh the activity is.
    lastEventAt: inst.lastEventAt,
  };
  if (inst.completedAt !== undefined) v.completedAt = inst.completedAt;
  if (inst.resultPreview !== undefined) v.resultPreview = inst.resultPreview;
  if (inst.error !== undefined) v.error = inst.error;
  if (inst.parentInstanceId !== undefined) v.parentInstanceId = inst.parentInstanceId;
  // Only surface intervention metadata when we have actually intervened.
  // `interventionCount > 0` is the canonical signal; absent fields mean
  // "no intervention has been sent yet", which is the common case.
  const interventionCount = inst.interventionCount ?? 0;
  if (interventionCount > 0) {
    v.interventionCount = interventionCount;
    if (inst.interventionAt !== undefined) v.interventionAt = inst.interventionAt;
    if (inst.interventionReason !== undefined) v.interventionReason = inst.interventionReason;
  }
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
