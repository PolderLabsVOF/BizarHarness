/**
 * Bizar plugin — Cline `AgentExtension` entry point (Phase 2 rewrite).
 *
 * Replaces the legacy OpenCode `Plugin` factory with a Cline
 * `AgentPlugin` from `@cline/sdk`. All 17 tools use
 * `createTool({ name, description, inputSchema, execute })` directly.
 *
 * Hook mapping (OpenCode → Cline):
 *   tool.execute.before           → beforeTool
 *   tool.execute.after            → afterTool
 *   experimental.chat.system.*    → beforeModel
 *   experimental.chat.messages.*  → beforeModel
 *   chat.message                  → onEvent(message-added)
 *   event                         → onEvent(...)
 *   experimental.session.compacting / autocontinue → onEvent(status-notice)
 *
 * Architecture:
 *   - Tools are registered via `api.registerTool()` inside `setup()`.
 *   - Hooks are defined as a getter that reads from module-level
 *     `runtimeCtx`. The runtime context is created during `setup()`;
 *     until then, hooks are a no-op stub.
 *
 * Migration scope — Phase 3 (follow-up):
 *   - Replace ServeLifecycle (subprocess spawn) with a ClineCore
 *     wrapper using `cline.start()` / `cline.send()` / `cline.abort()`.
 *   - Replace HttpClient (HTTP) with direct ClineCore calls.
 *   - Replace EventStream (SSE) with `cline.subscribe()`.
 */

import {
  type AgentHooks,
  type AgentPlugin,
  type AgentTool,
  type Message,
  createTool,
} from "@cline/sdk";
import type {
  AgentExtensionApi,
  AgentExtensionHooks,
  PluginSetupContext,
} from "@cline/shared";
import type { AgentRuntimeEvent } from "@cline/shared";

import { createLogger, type Logger } from "./src/logger.js";
import { decide, isLogOnlyWarn } from "./src/loop.js";
import { fingerprint } from "./src/fingerprint.js";
import { createDashboardPublisher, type DashboardPublisher } from "./src/dashboard-client.js";
import { StateStore } from "./src/state.js";
import { LogWriter } from "./src/report.js";
import {
  normalizeOptions,
  readEnvFlags,
  findOffendingPath,
  type NormalizedOptions,
  type EnvFlags,
} from "./src/options.js";

import { ServeLifecycle } from "./src/serve.js";
import { ClineRuntime } from "./src/clineruntime.js";
import { writeServeInfo, clearServeInfo } from "./src/serve-info.js";
import { HttpClient } from "./src/http-client.js";
import { EventStream } from "./src/event-stream.js";
import { BackgroundStateStore } from "./src/background-state.js";
import { InstanceManager } from "./src/background.js";

import { createBgSpawnTool } from "./src/tools/bg-spawn.js";
import { createBgStatusTool } from "./src/tools/bg-status.js";
import { createBgCollectTool } from "./src/tools/bg-collect.js";
import { createBgKillTool } from "./src/tools/bg-kill.js";
import { createBgPauseTool } from "./src/tools/bg-pause.js";
import { createBgResumeTool } from "./src/tools/bg-resume.js";
import { createBgReportProgressTool } from "./src/tools/bg-report-progress.js";
import { createBgSendMessageTool } from "./src/tools/bg-send-message.js";
import { createBgGetCommentsTool } from "./src/tools/bg-get-comments.js";

import { createOpenKbTool } from "./src/tools/open-kb.js";
import { createMemorySearchTool } from "./src/tools/memory-search.js";
import { createMemoryReadTool } from "./src/tools/memory-read.js";
import { createMemoryWriteTool } from "./src/tools/memory-write.js";
import { createMemoryListTool } from "./src/tools/memory-list.js";

import { createMemoryInject, popMemoryContext } from "./src/hooks/memory-inject.js";
import { createMemoryWriteOnEnd } from "./src/hooks/memory-write-on-end.js";

import { SettingsStore } from "./src/settings.js";
import { parseSlashCommand } from "./src/commands.js";
import { createPlanActionTool } from "./src/tools/plan-action.js";
import { createWaitForFeedbackTool } from "./src/tools/wait-for-feedback.js";
import { createReadGlyphFeedbackTool } from "./src/tools/read-glyph-feedback.js";
import { createTeamSpawnTool } from "./src/tools/team-spawn.js";
import { createLoopTools } from "./src/tools/loop-engineering.js";
import { createTeamStatusTool } from "./src/tools/team-status.js";
import { createGraphQueryTool, createGraphPathTool, createGraphExplainTool } from "./src/tools/graph-query.js";
import {
  createBrowserOpenTool,
  createBrowserSnapshotTool,
  createBrowserClickTool,
  createBrowserFillTool,
  createBrowserScreenshotTool,
  createBrowserCommandTool,
  type AgentBrowserDeps,
} from "./src/tools/agent-browser.js";
import { checkDangerous, getDangerousPatternStats, listDangerousPatterns } from "./src/dangerous-patterns.js";
import { createSkillCurator } from "./src/hooks/skill-curator.js";
import { createMemoryFlushOnCompact } from "./src/hooks/memory-flush-on-compact.js";
import {
  stripInlineThinkBlocks,
  wrapFetchForReasoningCleanup,
  type FetchLike,
} from "./src/reasoning-clean.js";
import {
  wrapFetchForKeyRotation,
  discoverMiniMaxKeys,
} from "./src/key-rotation.js";
import { executeSideEffect, type ExecuteOptions } from "./src/commands-impl.js";

import {
  getCompactionThreshold,
  setCompactionThreshold,
  resetCompactionDefaults,
} from "./src/compaction.mjs";

import { homedir } from "node:os";
import { join as pathJoin } from "node:path";

// --- Env-var constants --------------------------------------------------

function readServePort(): number {
  const raw = process.env.BIZAR_SERVE_PORT;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 65535) return 0;
  return Math.floor(n);
}
function readServeDisabled(): boolean { return process.env.BIZAR_SERVE_DISABLE === "1"; }
function readMaxConcurrent(): number {
  const raw = process.env.BIZAR_MAX_CONCURRENT_INSTANCES;
  if (raw === undefined || raw === "") return 8;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.floor(n);
}
function readToolCallCap(): number {
  const raw = process.env.BIZAR_BACKGROUND_TOOL_CALL_CAP;
  if (raw === undefined || raw === "") return 500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.floor(n);
}
function readStallTimeoutMs(): number {
  const raw = process.env.BIZAR_STALL_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 180_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) return 180_000;
  return Math.min(Math.floor(n), 600_000);
}
function readThinkingLoopTimeoutMs(): number {
  const raw = process.env.BIZAR_THINKING_LOOP_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 300_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 30_000) return 300_000;
  return Math.min(Math.floor(n), 900_000);
}
function readMaxInterventions(): number {
  const raw = process.env.BIZAR_MAX_INTERVENTIONS;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 3);
}
function readHttpTimeoutMs(): number {
  const raw = process.env.BIZAR_HTTP_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 30_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return 30_000;
  return Math.floor(n);
}

// --- Shutdown coordination ----------------------------------------------

let shuttingDown = false;
let instanceManagerHandle: InstanceManager | null = null;
let serveHandle: ServeLifecycle | null = null;
let streamHandle: EventStream | null = null;
let loggerHandle: Logger | null = null;
const signalHandlerRefs = new Map<"SIGTERM" | "SIGINT", () => void>();

let reasoningCleanInstalled = false;
let keyRotationInstalled = false;

function installFetchReasoningCleanup(logger: Logger): void {
  if (reasoningCleanInstalled) return;
  const original = globalThis.fetch;
  if (typeof original !== "function") {
    logger.warn("bizar: globalThis.fetch is not a function; reasoning-clean wrap skipped");
    return;
  }
  const wrapped = wrapFetchForReasoningCleanup(
    original.bind(globalThis) as FetchLike,
    { debug: (msg) => logger.debug(msg) },
  );
  globalThis.fetch = wrapped as typeof globalThis.fetch;
  reasoningCleanInstalled = true;
  logger.info("bizar: reasoning-clean fetch wrap installed (minimax)");
}

function installFetchKeyRotation(logger: Logger): void {
  if (keyRotationInstalled) return;
  const original = globalThis.fetch;
  if (typeof original !== "function") {
    logger.warn("bizar: globalThis.fetch is not a function; key-rotation wrap skipped");
    return;
  }
  const keys = discoverMiniMaxKeys();
  if (keys.length < 2) {
    keyRotationInstalled = true;
    logger.debug(`bizar: ${keys.length} MiniMax key(s); key-rotation disabled (need >= 2)`);
    return;
  }
  const wrapped = wrapFetchForKeyRotation(original.bind(globalThis) as FetchLike, {
    providerId: "minimax",
    apiKeys: keys,
    debug: (msg) => logger.debug(msg),
  });
  globalThis.fetch = wrapped as typeof globalThis.fetch;
  keyRotationInstalled = true;
  logger.info(`bizar: key-rotation fetch wrap installed (minimax, ${keys.length} keys)`);
}

// --- Runtime context ----------------------------------------------------

interface RuntimeContext {
  logger: Logger;
  options: NormalizedOptions;
  envFlags: EnvFlags;
  stateStore: StateStore;
  settingsStore: SettingsStore;
  logWriter: LogWriter;
  worktree: string;
  directory: string;
  seenMessageIds: Map<string, Set<string>>;
  pendingInjections: Map<string, string>;
  injectedSessions: Set<string>;
  dashboardPublisher: DashboardPublisher | null;
  memoryInject: (sessionID: string, firstMessage: string) => Promise<void>;
  memoryWriteOnEnd: (
    sessionID: string,
    info: { sessionID: string; agent: string; startedAt: number; endedAt: number; status: "idle" | "error" | "killed"; error?: string; },
    conversationPreview: string,
  ) => Promise<void>;
  sessionStartTimes: Map<string, number>;
}

const REASONING_DIRECTIVE_MARKER = "BIZAR_REASONING_DIRECTIVE_v0.6.2";
const REASONING_DIRECTIVE = [
  REASONING_DIRECTIVE_MARKER, "",
  "When reasoning is enabled for this conversation, output your thinking",
  "ONLY in the model's structured reasoning field. Do NOT emit  THINK  blocks",
  "inline inside your message content — the cline host extracts the",
  "reasoning field and renders it as a separate, collapsable \"Thought\"",
  "panel. If you also emit the same text inline, the user will see your",
  "thinking twice (once in the panel and once as visible message body).",
  "Keep the actual response text in the normal content stream.",
].join(" ");

// v6.0.1 — Tool-discipline directive (prefer built-in tools, keep bash small).
// See plugins/bizar/src/tool-discipline.ts for the body and rationale.
import {
  TOOL_DISCIPLINE_DIRECTIVE,
  TOOL_DISCIPLINE_MARKER,
  hasToolDiscipline as _hasToolDiscipline,
} from "./src/tool-discipline.js";

function ensureToolDiscipline(sysParts: string[], baseSys: string): void {
  if (_hasToolDiscipline(baseSys)) return;
  if (sysParts.some((s) => s.includes(TOOL_DISCIPLINE_MARKER))) return;
  sysParts.push(TOOL_DISCIPLINE_DIRECTIVE);
}

// v6.0.1 — Mistake-recovery callback used by team-spawn and other
// in-process session creators. See plugins/bizar/src/mistake-recovery.ts
// for the rationale (recover from `invalid_tool_call` /
// `tool_execution_failed`; stop on `api_error`).
import { buildMistakeRecovery } from "./src/mistake-recovery.js";

export function makeMistakeRecoveryCallback(logger: Logger): ReturnType<typeof buildMistakeRecovery> {
  return buildMistakeRecovery({
    onRecovery: (ctx, guidance) => {
      logger.warn(
        `bizar: mistake limit reached — continuing with guidance ` +
        `(reason=${ctx.reason}, iteration=${ctx.iteration}, ` +
        `consecutive=${ctx.consecutiveMistakes}/${ctx.maxConsecutiveMistakes})`,
      );
      try {
        const preview = guidance.replace(/\s+/g, " ").slice(0, 120);
        logger.debug(`bizar: recovery guidance preview: ${preview}…`);
      } catch {
        // preview derivation is best-effort
      }
    },
  });
}

// Module-level runtime context — set during setup(), read by hooks via getter.
let _runtimeCtx: RuntimeContext | null = null;

// --- The exported plugin -----------------------------------------------

const plugin: AgentPlugin = {
  name: "bizar",
  manifest: { capabilities: ["tools", "hooks"] },
  get hooks(): AgentExtensionHooks {
    return _runtimeCtx ? buildHooksForCtx(_runtimeCtx) : {};
  },
  async setup(api: AgentExtensionApi<AgentTool, Message[]>, ctx: PluginSetupContext): Promise<void> {
    const { runtimeCtx, tools } = await initRuntime(api, ctx);
    _runtimeCtx = runtimeCtx;
    for (const t of tools) api.registerTool(t as AgentTool);
  },
};

export default plugin;

// --- Init (returns runtime context + tools) ----------------------------

async function initRuntime(
  _api: AgentExtensionApi<AgentTool, Message[]>,
  ctx: PluginSetupContext,
): Promise<{ runtimeCtx: RuntimeContext; tools: AgentTool[] }> {
  const envFlags = readEnvFlags();
  const ctxMeta = (ctx as unknown as { metadata?: Record<string, unknown> }).metadata as Record<string, unknown> | undefined;
  const rawOptions = (ctxMeta?.bizar as Record<string, unknown> | undefined) ?? {};
  const { options, notes } = normalizeOptions(rawOptions as never);

  const logger = createLogger({
    log: (lvl: string, msg: string) => {
      const fn = lvl === "error" ? console.error : lvl === "warn" ? console.warn : lvl === "info" ? console.info : console.debug;
      fn(`[bizar] ${msg}`);
    },
  } as unknown as Parameters<typeof createLogger>[0]);
  loggerHandle = logger;

  resetCompactionDefaults();
  const compactionCfg = (rawOptions as Record<string, unknown>).compaction as { threshold?: unknown } | undefined;
  if (compactionCfg && typeof compactionCfg.threshold === "number") {
    try { setCompactionThreshold(compactionCfg.threshold); logger.info(`bizar: compaction threshold set to ${compactionCfg.threshold}`); }
    catch (err) { logger.warn(`bizar: invalid compaction threshold: ${err instanceof Error ? err.message : String(err)}`); }
  }

  const offending = findOffendingPath(options);
  if (offending !== null) {
    logger.error(`bizar: refusing to start — ${offending.path} inside secret dir (${offending.kind})`);
    return { runtimeCtx: emptyRuntimeContext(logger, options, envFlags), tools: [] };
  }
  if (envFlags.disable) { logger.debug("bizar: disabled via BIZAR_DISABLE=1"); return { runtimeCtx: emptyRuntimeContext(logger, options, envFlags), tools: [] }; }
  for (const note of notes) logger.warn(`bizar: ${note}`);

  installFetchReasoningCleanup(logger);
  installFetchKeyRotation(logger);

  const worktree = (ctxMeta?.worktree as string | undefined) ?? process.cwd();
  const directory = (ctxMeta?.directory as string | undefined) ?? worktree;

  const stateStore = new StateStore(options.stateDir, logger);
  const settingsStore = new SettingsStore(options.stateDir, logger);
  const logWriter = new LogWriter(options.logDir, options.logRotationBytes, logger);
  try {
    const deleted = await stateStore.cleanup(7, new Set());
    if (deleted > 0) logger.info(`bizar: cleaned up ${deleted} stale session file(s)`);
  } catch (err) { logger.warn(`bizar: stale session cleanup failed: ${err instanceof Error ? err.message : String(err)}`); }

  let instanceManager: InstanceManager | null = null;
  let serve: ServeLifecycle | null = null;
  let stream: EventStream | null = null;
  let dashboardPublisher: DashboardPublisher | null = null;
  let bgAvailable = false;

  if (readServeDisabled()) {
    logger.info("bizar: background agents disabled via BIZAR_SERVE_DISABLE=1");
  } else {
    try {
      // v6.0.0 — In-process Cline mode. The plugin embeds ClineCore
      // (via ClineRuntime) instead of spawning a `cline serve` child.
      // We pass nulls for serve/http/stream — InstanceManager runs in
      // "bg-only mode" and the bg-spawn tool POSTs to the dashboard
      // for actual session creation. The dashboard can also use
      // ClineCore in-process (see bizar-dash/src/server/bg-spawner.mjs).
      const bgStateStore = new BackgroundStateStore(options.stateDir, logger);
      bgStateStore.cleanup(7).catch(() => 0);
      const maxConcurrent = readMaxConcurrent();
      const toolCallCap = readToolCallCap();
      const stallTimeoutMs = readStallTimeoutMs();
      const thinkingLoopTimeoutMs = readThinkingLoopTimeoutMs();
      const maxInterventions = readMaxInterventions();

      instanceManager = new InstanceManager({
        stateStore: bgStateStore,
        maxConcurrent,
        toolCallCap,
        logger,
        worktree,
        serve: null,
        http: null,
        stream: null,
        stallTimeoutMs,
        thinkingLoopTimeoutMs,
        maxInterventions,
      });
      instanceManagerHandle = instanceManager;
      await instanceManager.rebuildInMemoryMap();
      bgAvailable = true;
      logger.info(`bizar: background agents ready (in-process ClineCore; cap=${maxConcurrent}, toolCallCap=${toolCallCap})`);
    } catch (err) { logger.warn(`bizar: background agents unavailable: ${err instanceof Error ? err.message : String(err)}`); }
  }

  installSignalHandlers(logger, instanceManager, serve, stream, options.stateDir);
  const injectedSessions = new Set<string>();
  const sessionStartTimes = new Map<string, number>();
  const { memoryInject } = createMemoryInject({ injectedSessions, worktree, logger, enabled: true });
  const { memoryWriteOnEnd } = createMemoryWriteOnEnd({ worktree, logger, enabled: true });

  const runtimeCtx: RuntimeContext = {
    logger, options, envFlags, stateStore, settingsStore, logWriter,
    worktree, directory,
    seenMessageIds: new Map(), pendingInjections: new Map(), injectedSessions,
    dashboardPublisher, memoryInject, memoryWriteOnEnd, sessionStartTimes,
  };
  // v6.0.0 — Try to bring up an in-process ClineRuntime for team tools
  // and event-driven features. If ClineCore.create() fails (no
  // @cline/core installed, or no provider credentials), we log a
  // warning and continue without it — the non-team tools still work.
  let clineRuntime: ClineRuntime | null = null;
  try {
    clineRuntime = new ClineRuntime({
      logger,
      defaultMaxConsecutiveMistakes: options.clineruntimeMaxConsecutiveMistakes,
      defaultOnConsecutiveMistakeLimitReached: makeMistakeRecoveryCallback(logger),
    });
    await clineRuntime.start();
    logger.info(
      `bizar: ClineRuntime ready (agent teams + advanced features enabled, ` +
      `maxConsecutiveMistakes=${options.clineruntimeMaxConsecutiveMistakes}, ` +
      `recovery=continue-on-invalid-tool-call)`,
    );
  } catch (err) {
    clineRuntime = null;
    logger.warn(`bizar: ClineRuntime unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const tools = buildTools(runtimeCtx, instanceManager, logger, clineRuntime);
  return { runtimeCtx, tools };
}

function emptyRuntimeContext(logger: Logger, options: NormalizedOptions, envFlags: EnvFlags): RuntimeContext {
  return {
    logger, options, envFlags,
    stateStore: new StateStore(options.stateDir, logger),
    settingsStore: new SettingsStore(options.stateDir, logger),
    logWriter: new LogWriter(options.logDir, options.logRotationBytes, logger),
    worktree: process.cwd(), directory: process.cwd(),
    seenMessageIds: new Map(), pendingInjections: new Map(), injectedSessions: new Set<string>(),
    dashboardPublisher: null,
    memoryInject: async () => {},
    memoryWriteOnEnd: async () => {},
    sessionStartTimes: new Map(),
  };
}

// --- Signal handling (spec §5.3) ----------------------------------------

function installSignalHandlers(logger: Logger, instanceManager: InstanceManager | null, serve: ServeLifecycle | null, stream: EventStream | null, stateDir: string): void {
  const onSignal = async (sig: "SIGTERM" | "SIGINT") => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`bizar: received ${sig}; shutting down`);
    if (instanceManager !== null) { try { await instanceManager.shutdownAll(); } catch (err) { logger.warn(`shutdownAll failed: ${err instanceof Error ? err.message : String(err)}`); } }
    if (stream !== null) { try { await stream.disconnect(); } catch { /* ignore */ } }
    if (serve !== null) { try { await serve.stop(); } catch (err) { logger.warn(`serve.stop failed: ${err instanceof Error ? err.message : String(err)}`); } }
    clearServeInfo(stateDir, logger);
    try { process.exit(0); } catch { /* ignore */ }
  };
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    const previous = signalHandlerRefs.get(sig);
    if (previous) { try { process.removeListener(sig, previous); } catch { /* ignore */ } }
    const handler = () => { void onSignal(sig); };
    signalHandlerRefs.set(sig, handler);
    process.once(sig, handler);
  }
}

function readMessageText(message: Message | undefined): string | null {
  if (!message || !Array.isArray(message.content)) return null;
  const fragments: string[] = [];
  for (const part of message.content) {
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") fragments.push(p.text);
  }
  const joined = fragments.join("\n").trim();
  return joined === "" ? null : joined;
}

async function listPlanSlugs(worktree: string, logger: Logger): Promise<string[]> {
  try {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const plansDir = join(worktree, "plans");
    let entries: string[];
    try { entries = readdirSync(plansDir); } catch { return []; }
    const slugs: string[] = [];
    for (const name of entries) {
      try { const stat = statSync(join(plansDir, name)); if (stat.isDirectory()) slugs.push(name); } catch { /* skip */ }
    }
    slugs.sort();
    return slugs;
  } catch (err) { logger.debug(`listPlanSlugs failed: ${err instanceof Error ? err.message : String(err)}`); return []; }
}

function findLastIndex<T>(arr: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

// --- Tools builder ---------------------------------------------------

function buildTools(ctx: RuntimeContext, instanceManager: InstanceManager | null, _logger: Logger, clineRuntime: ClineRuntime | null = null): AgentTool[] {
  const basePlanTools: AgentTool[] = [
    createBgGetCommentsTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createPlanActionTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createWaitForFeedbackTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createReadGlyphFeedbackTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createOpenKbTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createMemorySearchTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createMemoryReadTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createMemoryWriteTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createMemoryListTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
  ];
  const bgTools: AgentTool[] = instanceManager
    ? [
        createBgSpawnTool({ instanceManager, worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
        createBgStatusTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
        createBgCollectTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
        createBgKillTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
        createBgPauseTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
        createBgResumeTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
        createBgSendMessageTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
        createBgReportProgressTool({ instanceManager, logger: ctx.logger }) as unknown as AgentTool,
      ]
    : bgDisabledTools(ctx.logger);
  // v6.0.0 — Cline agent teams tools. These need a ClineRuntime, so
  // they're only registered if we have one (in-process ClineCore).
  const teamTools: AgentTool[] = clineRuntime
    ? [
        createTeamSpawnTool({ runtime: clineRuntime, logger: ctx.logger }) as unknown as AgentTool,
        createTeamStatusTool({ runtime: clineRuntime, logger: ctx.logger }) as unknown as AgentTool,
      ]
    : [];
  // v6.0.0 — Knowledge graph tools (always available; reads .bizar/graph/graph.json).
  const graphTools: AgentTool[] = [
    createGraphQueryTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createGraphPathTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
    createGraphExplainTool({ worktree: ctx.worktree, logger: ctx.logger }) as unknown as AgentTool,
  ];
  // v6.0.0 — agent-browser CLI tools (replaces v5.x browser-harness).
  // Thin wrappers around the agent-browser Rust CLI; see
  // plugins/bizar/src/tools/agent-browser.ts and
  // config/agents/agent-browser.md for the browser-primary agent.
  const browserDeps: AgentBrowserDeps = { logger: ctx.logger };
  const browserTools: AgentTool[] = [
    createBrowserOpenTool(browserDeps) as unknown as AgentTool,
    createBrowserSnapshotTool(browserDeps) as unknown as AgentTool,
    createBrowserClickTool(browserDeps) as unknown as AgentTool,
    createBrowserFillTool(browserDeps) as unknown as AgentTool,
    createBrowserScreenshotTool(browserDeps) as unknown as AgentTool,
    createBrowserCommandTool(browserDeps) as unknown as AgentTool,
  ];
  // v6.0.0 — Loop-engineering tools (ralph / repl / cron / plan-execute).
  // These work standalone (no clineRuntime needed) since state lives on disk.
  const loopTools: AgentTool[] = createLoopTools({ logger: ctx.logger }) as unknown as AgentTool[];
  return [...basePlanTools, ...bgTools, ...teamTools, ...graphTools, ...browserTools, ...loopTools];
}

function bgDisabledTools(logger: Logger): AgentTool[] {
  const disabled = (name: string): AgentTool => {
    return { name, description: `${name} (disabled — background agents are unavailable).`, inputSchema: {}, execute: async () => { logger.debug(`bizar: ${name} called but disabled`); return { ok: false as const, error: "background agents are disabled (cline serve unavailable)." }; } } as unknown as AgentTool;
  };
  return [disabled("bizar_spawn_background"), disabled("bizar_status"), disabled("bizar_collect"), disabled("bizar_kill"), disabled("bizar_pause"), disabled("bizar_resume"), disabled("bizar_send_message"), disabled("bizar_report_progress")];
}

// --- Hooks builder ---------------------------------------------------

function buildHooksForCtx(ctx: RuntimeContext): AgentExtensionHooks {
  return {
    beforeTool: async (toolCtx) => {
      if (ctx.envFlags.disableLoop) return undefined;
      const sessionID = (toolCtx.snapshot as { sessionId?: string }).sessionId ?? (toolCtx.snapshot as { agentId?: string }).agentId ?? "";
      const tool = toolCtx.tool.name;
      if (!sessionID || !tool) return undefined;
      const args = toolCtx.input;
      // v6.0.0 — Dangerous-patterns approval gate (Hermes + OpenFang pattern).
      // Blocks rm -rf, sudo, prompt injection, SSRF, etc. See
      // src/dangerous-patterns.ts for the full list. Tool calls with
      // `decision: deny` are stopped before they reach the host.
      try {
        const safety = checkDangerous(args as Record<string, unknown>);
        if (safety.decision === "deny") {
          ctx.logger.warn(
            `bizar: blocked tool '${tool}' — dangerous pattern '${safety.pattern}': ${safety.reason}`,
          );
          return { stop: true, reason: `dangerous_pattern:${safety.pattern}:${safety.reason}` };
        }
      } catch {
        // safety checks are best-effort; never fail the tool call here
      }
      return await ctx.stateStore.withLock(sessionID, async () => {
        const state = await ctx.stateStore.load(sessionID);
        if (state.startedAt === 0) {
          state.sessionId = sessionID;
          state.startedAt = Date.now();
          state.parentAgent = (toolCtx.snapshot as { parentAgentId?: string | null }).parentAgentId ?? null;
        }
        state.lastActivityAt = Date.now();
        state.turnCount += 1;
        const fp = fingerprint(tool, args, ctx.worktree);
        const now = Date.now();
        const decision = decide(state, fp, now, ctx.options);
        if (decision.action === "allow") {
          state.toolCalls.push({ tool, fingerprint: fp, at: now });
          await ctx.stateStore.save(state);
          return undefined;
        }
        if (decision.action === "block") {
          state.toolCalls.push({ tool, fingerprint: fp, at: now });
          state.blocksTriggered += 1;
          await ctx.stateStore.save(state);
          return { stop: true, reason: decision.reason };
        }
        if (decision.action === "warn") {
          state.toolCalls.push({ tool, fingerprint: fp, at: now });
          state.warningsIssued += 1;
          if (isLogOnlyWarn(decision, ctx.options)) ctx.logger.warn(`bizar: ${decision.reason}`);
          else { ctx.pendingInjections.set(sessionID, decision.reason); ctx.logger.warn(`bizar: ${decision.reason}`); }
          await ctx.stateStore.save(state);
          return undefined;
        }
        state.toolCalls.push({ tool, fingerprint: fp, at: now });
        state.warningsIssued += 1;
        ctx.pendingInjections.set(sessionID, decision.reason);
        ctx.logger.warn(`bizar: ${decision.reason}`);
        await ctx.stateStore.save(state);
        return undefined;
      });
    },

    afterTool: async (toolCtx) => {
      if (ctx.envFlags.disableLoop && ctx.envFlags.disableLog) return undefined;
      const sessionID = (toolCtx.snapshot as { sessionId?: string }).sessionId ?? (toolCtx.snapshot as { agentId?: string }).agentId ?? "";
      const tool = toolCtx.tool.name;
      if (!sessionID || !tool) return undefined;
      const startMs = Date.now();
      const ok = !toolCtx.result.isError;
      const args = toolCtx.input;
      await ctx.stateStore.withLock(sessionID, async () => {
        const state = await ctx.stateStore.load(sessionID);
        if (state.startedAt === 0) return;
        const fp = fingerprint(tool, args, ctx.worktree);
        const idx = findLastIndex(state.toolCalls, (c) => c.fingerprint === fp);
        if (idx >= 0) { const call = state.toolCalls[idx]; if (call) call.outcome = ok ? "ok" : "error"; }
        state.lastActivityAt = Date.now();
        await ctx.stateStore.save(state);
      });
      if (!ctx.envFlags.disableLog) {
        const durationMs = Date.now() - startMs;
        const fp = fingerprint(tool, args, ctx.worktree);
        try { await ctx.logWriter.write({ sessionId: sessionID, agent: null, tool, fingerprint: fp, outcome: ok ? "ok" : "error", durationMs }); }
        catch (err) { ctx.logger.warn(`log write failed: ${err instanceof Error ? err.message : String(err)}`); }
      }
      return undefined;
    },

    beforeModel: async (modelCtx) => {
      const sessionID = (modelCtx.snapshot as { sessionId?: string }).sessionId ?? (modelCtx.snapshot as { agentId?: string }).agentId ?? "";
      if (!sessionID) return undefined;
      // v6.0.0 — Pre-compaction memory flush (OpenClaw `flush-plan.ts` pattern).
      // When usage crosses the compaction threshold, write a snapshot to the
      // memory vault BEFORE the host summarizes the conversation. This closes
      // the durability gap where compaction drops context before persistence.
      try {
        const snap = (modelCtx.snapshot as { usage?: { total?: number; input?: number; output?: number; cached?: number }; maxContext?: number });
        if (snap?.usage?.total && snap.maxContext) {
          const flusher = createMemoryFlushOnCompact({
            worktree: ctx.worktree,
            logger: ctx.logger,
            enabled: true,
          });
          await flusher.maybeFlush({
            sessionId: sessionID,
            usage: snap.usage as { total: number },
            maxContext: snap.maxContext,
            recentMessages: (modelCtx.request.messages ?? []).slice(-10).map((m) => {
              const msg = m as { role?: string; content?: unknown };
              let text = '';
              if (typeof msg.content === 'string') text = msg.content;
              else if (Array.isArray(msg.content)) {
                text = msg.content
                  .filter((p) => p && typeof p === 'object' && (p as { type?: string }).type === 'text')
                  .map((p) => (p as { text?: string }).text ?? '')
                  .join('\n');
              }
              return { role: String(msg.role ?? 'unknown'), content: text };
            }),
          });
        }
      } catch {
        // best-effort
      }
      const sysParts: string[] = [];
      const baseSys = modelCtx.request.systemPrompt ?? "";
      if (!baseSys.includes(REASONING_DIRECTIVE_MARKER)) sysParts.push(REASONING_DIRECTIVE);
      ensureToolDiscipline(sysParts, baseSys);
      const pending = ctx.pendingInjections.get(sessionID);
      if (pending) { sysParts.push(pending); ctx.pendingInjections.delete(sessionID); }
      const memCtx = popMemoryContext(sessionID);
      if (memCtx) sysParts.push(memCtx);
      const cleanedMessages = modelCtx.request.messages.map((m) => {
        const msg = m as { role?: string; content?: Array<{ type?: string; text?: string }> };
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) return m;
        const newContent = msg.content.map((p) => {
          if (p.type === "text" && typeof p.text === "string" && p.text.includes("<think>")) return { ...p, text: stripInlineThinkBlocks(p.text) };
          return p;
        });
        return { ...m, content: newContent };
      });
      return { systemPrompt: [baseSys, ...sysParts].filter(Boolean).join("\n\n") || undefined, messages: cleanedMessages.length > 0 ? cleanedMessages as unknown as readonly never[] : undefined } as unknown as { systemPrompt?: string; messages?: readonly never[] };
    },

    onEvent: async (event) => {
      try {
        if (event.type === "message-added") await handleMessageAdded(event, ctx);
        if (event.type === "run-finished" || event.type === "run-failed") await handleRunFinished(event, ctx);
      } catch (err) { ctx.logger.warn(`onEvent error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  };
}

async function handleMessageAdded(event: Extract<AgentRuntimeEvent, { type: "message-added" }>, ctx: RuntimeContext): Promise<void> {
  const message = event.message as unknown as Message;
  const sessionID = (event.snapshot as { sessionId?: string }).sessionId ?? (event.snapshot as { agentId?: string }).agentId ?? "";
  if (!sessionID) return;
  const role = (message as { role?: string }).role;
  if (role !== "user") {
    if (role === "assistant" && (message as { id?: string }).id) {
      ctx.sessionStartTimes.set(sessionID, ctx.sessionStartTimes.get(sessionID) ?? Date.now());
      ctx.seenMessageIds.set(sessionID, (ctx.seenMessageIds.get(sessionID) ?? new Set<string>()).add((message as { id?: string }).id as string));
    }
    return;
  }
  const messageID = (message as { id?: string }).id;
  if (!messageID) return;
  const seen = ctx.seenMessageIds.get(sessionID) ?? new Set<string>();
  if (seen.has(messageID)) return;
  seen.add(messageID);
  ctx.seenMessageIds.set(sessionID, seen);
  try {
    const messageText = readMessageText(message);
    if (messageText !== null) {
      const currentSettings = await ctx.settingsStore.get();
      const availableSlugs = await listPlanSlugs(ctx.worktree, ctx.logger);
      const result = parseSlashCommand(messageText, { currentSettings, availablePlanSlugs: availableSlugs, defaultPort: 4321 });
      if (result !== null) {
        if (result.settingsPatch) await ctx.settingsStore.update(result.settingsPatch);
        let finalResponse = result.response;
        if (result.sideEffect !== undefined) {
          const tools: AgentTool[] = [];
          const execOpts: ExecuteOptions = { tools: Object.fromEntries(tools.map((t) => [t.name, t as unknown as ExecuteOptions["tools"][string]])) as unknown as ExecuteOptions["tools"], defaultTemplate: currentSettings.defaultTemplate, defaultPort: 4321 };
          try {
            const exec = await executeSideEffect(result.sideEffect, { worktree: ctx.worktree, directory: ctx.directory, logger: ctx.logger }, execOpts);
            if (exec.responseOverride !== undefined) finalResponse = exec.responseOverride;
            else if (exec.responseSuffix !== undefined) finalResponse = `${result.response}${exec.responseSuffix}`;
          } catch (execErr: unknown) {
            const msg = execErr instanceof Error ? execErr.message : String(execErr);
            ctx.logger.warn(`bizar: side-effect crashed: ${msg}`);
            finalResponse = `Command failed: ${msg}`;
          }
        }
        if (result.dialog) {
          if (!/^dlg_[a-zA-Z0-9_-]{1,64}$/.test(result.dialog.id)) return;
          try {
            const { mkdir, writeFile } = await import("node:fs/promises");
            const dialogDir = pathJoin(homedir(), ".cache", "bizar", "dialogs");
            await mkdir(dialogDir, { recursive: true });
            await writeFile(pathJoin(dialogDir, `${result.dialog.id}.json`), JSON.stringify({ ...result.dialog, createdAt: new Date().toISOString() }, null, 2));
          } catch (dialogErr: unknown) { ctx.logger.warn(`bizar: dialog write failed: ${dialogErr instanceof Error ? dialogErr.message : String(dialogErr)}`); }
          return;
        }
        throw new Error(finalResponse);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const looksLikeIoError = /(ENOENT|EACCES|EROFS|EISDIR|EPERM|Error:)/.test(msg);
    if (!looksLikeIoError) { ctx.logger.warn(`bizar: slash command: ${msg}`); return; }
    ctx.logger.warn(`bizar: slash-command failed: ${msg}`);
  }
  try { const messageText = readMessageText(message); if (messageText) void ctx.memoryInject(sessionID, messageText); }
  catch (e) { ctx.logger.debug(`bizar: memory inject skipped: ${e instanceof Error ? e.message : String(e)}`); }
}

async function handleRunFinished(event: Extract<AgentRuntimeEvent, { type: "run-finished" | "run-failed" }>, ctx: RuntimeContext): Promise<void> {
  const sessionID = (event.snapshot as { sessionId?: string }).sessionId ?? (event.snapshot as { agentId?: string }).agentId ?? "";
  if (!sessionID) return;
  const startedAt = ctx.sessionStartTimes.get(sessionID) ?? Date.now();
  const endedAt = Date.now();
  const errorMsg = event.type === "run-failed" ? event.error.message : undefined;
  void ctx.memoryWriteOnEnd(sessionID, { sessionID, agent: (event.snapshot as { agentRole?: string }).agentRole ?? "unknown", startedAt, endedAt, status: event.type === "run-failed" ? "error" : "idle", error: errorMsg }, "");
  ctx.sessionStartTimes.delete(sessionID);
}

// --- Legacy exports (kept for backwards compat with tests) ----------------

/**
 * Race a promise against a timeout. If `promise` doesn't resolve within
 * `ms`, reject with an Error labeled with `label`.
 *
 * @deprecated Used only by pre-Phase-2 init-helpers tests.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bizar: ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Read the set of valid session IDs from the client (with a 1s timeout).
 *
 * @deprecated Used only by pre-Phase-2 init-helpers tests.
 */
interface LegacyPluginInput {
  client?: {
    session?: {
      list?: () => Promise<unknown>;
    };
  };
}

export async function readValidSessionIds(input: LegacyPluginInput | unknown): Promise<Set<string>> {
  const client = (input as LegacyPluginInput | null | undefined)?.client;
  const listFn = client?.session?.list;
  if (typeof listFn !== "function") return new Set<string>();
  try {
    const result = await withTimeout(Promise.resolve().then(() => listFn()), 1000, "client.session.list");
    // Normalize: accept either an array or an object with .data
    let items: unknown[] = [];
    if (Array.isArray(result)) items = result;
    else if (result && typeof result === "object" && Array.isArray((result as { data?: unknown }).data)) items = (result as { data: unknown[] }).data;
    else return new Set<string>();
    const ids = new Set<string>();
    for (const item of items) {
      if (typeof item === "string") ids.add(item);
      else if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") ids.add((item as { id: string }).id);
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}
