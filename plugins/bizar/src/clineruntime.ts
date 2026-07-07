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
 * Public surface:
 *   - start()              — boot ClineCore (idempotent)
 *   - startSession(opts)   — create a session; returns sessionId
 *   - send(opts)           — mid-flight prompt
 *   - abort(opts)          — abort a session
 *   - subscribe(opts, cb)  — events for a session; returns unsubscribe
 *   - stop()               — teardown
 */

import type { ClineCore } from "@cline/core";
import type { CoreSessionEvent } from "@cline/core";
import type { Logger } from "./logger.js";

type ClineCoreLike = Pick<ClineCore, "start" | "send" | "abort" | "stop" | "subscribe" | "dispose">;

export interface ClineRuntimeOptions {
  logger: Logger;
  clientName?: string;
  backendMode?: "auto" | "local" | "hub" | "remote";
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
  private core: ClineCoreLike | null = null;
  private startingPromise: Promise<ClineCoreLike> | null = null;

  constructor(opts: ClineRuntimeOptions) {
    this.logger = opts.logger;
    this.clientName = opts.clientName ?? "bizar-plugin";
    this.backendMode = opts.backendMode ?? "local";
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
    const started = await core.start({
      config: {
        providerId: opts.providerId,
        modelId: opts.modelId,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        systemPrompt: opts.systemPrompt ?? "",
        workspaceRoot: opts.workspaceRoot,
        cwd: opts.workspaceRoot,
        enableTools: true,
        enableSpawnAgent: false,
        enableAgentTeams: false,
      },
      prompt: opts.prompt,
      source: opts.source,
      sessionMetadata: opts.sessionMetadata,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    });
    return started.sessionId;
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
