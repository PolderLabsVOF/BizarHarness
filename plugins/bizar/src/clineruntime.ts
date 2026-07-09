/**
 * clineruntime.ts
 *
 * v6.0.0 — In-process ClineCore wrapper. Replaces the old ServeLifecycle
 * (subprocess spawn), HttpClient (HTTP), and EventStream (SSE) with a
 * single object that talks to ClineCore via direct function calls.
 *
 * Cline runs in-process now: there is no `cline serve` child, no port,
 * no password, no serve-info file. The plugin embeds ClineCore and uses
 * it directly.
 *
 * v6.0.1 — `startSession` accepts `execution` (passed straight into
 * Cline's `AgentExecutionConfig`) and an
 * `onConsecutiveMistakeLimitReached` recovery callback. The harness
 * also defaults `execution.maxConsecutiveMistakes` so the bundled CLI's
 * tight 3-strike abort does not kill sessions on the first malformed
 * tool call.
 *
 * Public surface:
 *   - start()              — boot ClineCore (idempotent)
 *   - startSession(opts)   — create a session; returns sessionId
 *   - send(opts)           — mid-flight prompt
 *   - abort(opts)          — abort a session
 *   - subscribe(opts, cb)  — events for a session; returns unsubscribe
 *   - stop()               — teardown
 */

import type { ClineCore, CoreSessionEvent } from "@cline/core";
import type {
  ConsecutiveMistakeLimitContext,
  ConsecutiveMistakeLimitDecision,
} from "@cline/shared";
import type { Logger } from "./logger.js";

type ClineCoreLike = Pick<ClineCore, "start" | "send" | "abort" | "stop" | "subscribe" | "dispose">;

export interface ClineRuntimeOptions {
  logger: Logger;
  clientName?: string;
  backendMode?: "auto" | "local" | "hub" | "remote";
  /**
   * Default `execution.maxConsecutiveMistakes` applied to every session
   * started by this runtime. Picked up from the plugin's normalized
   * options (see `options.ts`). Per-session overrides via
   * `StartSessionOpts.execution.maxConsecutiveMistakes` win.
   */
  defaultMaxConsecutiveMistakes?: number;
  /**
   * Recovery callback used for every session started by this runtime.
   * Built once at construction time (it is stateless) and applied
   * unless the caller overrides via
   * `StartSessionOpts.onConsecutiveMistakeLimitReached`. The harness
   * passes `buildMistakeRecovery({ onRecovery })` from
   * `mistake-recovery.ts` here so a single malformed tool call does
   * not abort the session.
   */
  defaultOnConsecutiveMistakeLimitReached?: (
    ctx: ConsecutiveMistakeLimitContext,
  ) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;
}

export interface StartSessionOpts {
  sessionId?: string;
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  workspaceRoot: string;
  systemPrompt?: string;
  prompt: string;
  sessionMetadata?: Record<string, unknown>;
  source?: string;
  /**
   * Forwarded to ClineCore as `config.execution`. If supplied, the
   * runtime overrides `execution.maxConsecutiveMistakes` with
   * `runtime.defaultMaxConsecutiveMistakes` *only* when the caller
   * didn't set it explicitly. Other fields (`reminderAfterIterations`,
   * `reminderText`, `loopDetection`) pass through as-is.
   */
  execution?: {
    maxConsecutiveMistakes?: number;
    reminderAfterIterations?: number;
    reminderText?: string;
    loopDetection?:
      | false
      | { softThreshold?: number; hardThreshold?: number };
  };
  /**
   * Forwarded to ClineCore as `config.onConsecutiveMistakeLimitReached`.
   * Used by `mistake-recovery.ts` to keep the session alive on
   * recoverable mistakes (`invalid_tool_call`, `tool_execution_failed`)
   * and stop on infra failures (`api_error`).
   */
  onConsecutiveMistakeLimitReached?: (
    ctx: ConsecutiveMistakeLimitContext,
  ) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;
}

export interface SendOpts { sessionId: string; prompt: string; }
export interface AbortOpts { sessionId: string; reason?: string; }
export interface SubscribeOpts { sessionId: string; }

export type SessionEventHandler = (event: CoreSessionEvent) => void;
export type UnsubscribeFn = () => void;

export class ClineRuntime {
  private readonly logger: Logger;
  private readonly clientName: string;
  private readonly backendMode: "auto" | "local" | "hub" | "remote";
  private readonly defaultMaxConsecutiveMistakes?: number;
  private readonly defaultOnConsecutiveMistakeLimitReached?: (
    ctx: ConsecutiveMistakeLimitContext,
  ) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;
  private core: ClineCoreLike | null = null;
  private startingPromise: Promise<ClineCoreLike> | null = null;

  constructor(opts: ClineRuntimeOptions) {
    this.logger = opts.logger;
    this.clientName = opts.clientName ?? "bizar-plugin";
    this.backendMode = opts.backendMode ?? "local";
    if (typeof opts.defaultMaxConsecutiveMistakes === "number" && Number.isFinite(opts.defaultMaxConsecutiveMistakes)) {
      this.defaultMaxConsecutiveMistakes = Math.max(3, Math.floor(opts.defaultMaxConsecutiveMistakes));
    }
    if (typeof opts.defaultOnConsecutiveMistakeLimitReached === "function") {
      this.defaultOnConsecutiveMistakeLimitReached = opts.defaultOnConsecutiveMistakeLimitReached;
    }
  }

  async start(): Promise<void> {
    if (this.core) return;
    if (this.startingPromise) { await this.startingPromise; return; }
    this.startingPromise = (async () => {
      const cline = await import("@cline/core");
      const core = await cline.ClineCore.create({ clientName: this.clientName, backendMode: this.backendMode });
      this.core = core;
      this.logger.info(`bizar: ClineCore ready (clientName=${this.clientName}, backend=${this.backendMode})`);
      return core;
    })();
    try { await this.startingPromise; } finally { this.startingPromise = null; }
  }

  private async ensure(): Promise<ClineCoreLike> {
    if (this.core) return this.core;
    await this.start();
    if (!this.core) throw new Error("clineruntime: ClineCore failed to start");
    return this.core;
  }

  async startSession(opts: StartSessionOpts): Promise<string> {
    const core = await this.ensure();
    const execution = this.buildExecution(opts.execution);
    const recovery = opts.onConsecutiveMistakeLimitReached
      ?? this.defaultOnConsecutiveMistakeLimitReached;
    const config: Parameters<ClineCore["start"]>[0]["config"] = {
      providerId: opts.providerId,
      modelId: opts.modelId,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      systemPrompt: opts.systemPrompt ?? "",
      workspaceRoot: opts.workspaceRoot,
      cwd: opts.workspaceRoot,
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: true,
      ...(execution ? { execution } : {}),
      ...(recovery ? { onConsecutiveMistakeLimitReached: recovery } : {}),
    };
    const started = await core.start({
      config: config as Parameters<ClineCore["start"]>[0]["config"],
      prompt: opts.prompt,
      source: opts.source,
      sessionMetadata: opts.sessionMetadata,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    });
    return started.sessionId;
  }

  /**
   * Merge caller's `execution` block with the runtime default
   * (`defaultMaxConsecutiveMistakes`). Returns `undefined` when neither
   * is set, so the optional field stays out of the config payload.
   */
  private buildExecution(
    callerExecution: StartSessionOpts["execution"],
  ): StartSessionOpts["execution"] | undefined {
    if (!callerExecution && this.defaultMaxConsecutiveMistakes === undefined) return undefined;
    const max = callerExecution?.maxConsecutiveMistakes ?? this.defaultMaxConsecutiveMistakes;
    return { ...callerExecution, ...(max !== undefined ? { maxConsecutiveMistakes: max } : {}) };
  }

  async send(opts: SendOpts): Promise<void> {
    const core = await this.ensure();
    await (core.send as unknown as (input: { sessionId: string; prompt: string }) => Promise<unknown>)({ sessionId: opts.sessionId, prompt: opts.prompt });
  }

  async abort(opts: AbortOpts): Promise<void> {
    const core = await this.ensure();
    await core.abort(opts.sessionId, opts.reason);
  }

  subscribe(opts: SubscribeOpts, handler: SessionEventHandler): UnsubscribeFn {
    if (!this.core) throw new Error("clineruntime: subscribe() called before start()");
    return (this.core.subscribe as (l: SessionEventHandler, o?: SubscribeOpts) => UnsubscribeFn)(handler, opts);
  }

  async stop(): Promise<void> {
    if (!this.core) return;
    try { await this.core.dispose(); }
    catch (err) { this.logger.warn(`bizar: ClineCore.dispose failed: ${err instanceof Error ? err.message : String(err)}`); }
    this.core = null;
  }
}
