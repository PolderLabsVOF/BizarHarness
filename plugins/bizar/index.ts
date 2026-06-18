/**
 * Bizar plugin — opencode plugin entry point.
 *
 * Spec contract (cumulative):
 *   v0.3.1:
 *     - §3.1 — hook surface used. The plugin wires up `config`, `event`,
 *       `chat.message`, `tool.execute.before`, `tool.execute.after`, and
 *       `experimental.chat.system.transform`.
 *     - §4.3 — per-session async mutex. All state reads/writes go through
 *       `stateStore.withLock(sessionID, …)`.
 *     - §4.5 — `chat.message` dedupes by message ID and seeds `parentAgent`
 *       on the first message per session.
 *     - §4.5.1 — state file is created on the `chat.message` seed (not on
 *       `session.created`). A lazy fallback creates the file on the first
 *       `tool.execute.before` for subagent-only sessions.
 *     - §4.6 — stale session cleanup runs on init.
 *     - §4.7 — corrupt-state fallback. StateStore handles this; we never
 *       see a corrupt file from the hook side.
 *     - §5.4 — thresholds 5 and 8 inject via `experimental.chat.system.transform`;
 *       threshold 12 throws from `tool.execute.before`.
 *     - §6.4 — refuse to start if `logDir` or `stateDir` is inside a secret
 *       directory. Return empty hooks in that case.
 *     - §6.5 — honor `BIZAR_DISABLE`, `BIZAR_DISABLE_LOOP`, `BIZAR_DISABLE_LOG`,
 *       `BIZAR_LOG_LEVEL`. Read once at init.
 *     - §7.6 — never log raw tool args. The logger only accepts message strings.
 *     - §8.1 — wrap init in try/catch. Return empty hooks on any init error.
 *     - §8.2 — create directories on init. If creation fails, return empty hooks.
 *     - §10.1 — per-call log line via `LogWriter.write`.
 *
 *   v0.4.2 (background agents):
 *     - §1 — start `opencode serve` on init; spawn background sessions
 *       via `POST /session` + `POST /session/{id}/prompt_async`.
 *     - §2.1 — open ONE global SSE subscription to `GET /event`.
 *     - §2.2 — `InstanceManager.add()` is atomic.
 *     - §5.1 — serve child on 127.0.0.1 with `--hostname` hardcoded.
 *     - §5.3 — SIGTERM/SIGINT trap walks the in-memory map, aborts
 *       running sessions, kills the serve child, exits.
 *     - §5.4 — on init, scan `bg/*.json`; rebuild in-memory map; mark
 *       orphaned `running`/`pending` as `failed`.
 *     - §6.1 — 32-byte secret for the serve child; `node:crypto` only in `serve.ts`.
 *     - §6.3 — only Odin may call `bizar_spawn_background`.
 *     - §7.1 — register 4 background tools: `bizar_spawn_background`,
 *       `bizar_status`, `bizar_collect`, `bizar_kill`.
 *     - §v2.1 — register 1 read-only tool: `bizar_get_plan_comments`.
 *       Reads `plans/<slug>/plan.json` so background agents can pick up
 *       user feedback pinned to the elements they're working on.
 *       Available to all agents (read-only — no serve child required).
 *     - §5.5 — `--hostname 127.0.0.1` hardcoded.
 */

import type { Plugin, Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin";

import { createLogger, type Logger } from "./src/logger.js";
import { decide, isLogOnlyWarn } from "./src/loop.js";
import { fingerprint } from "./src/fingerprint.js";
import { StateStore, type SessionState } from "./src/state.js";
import { LogWriter } from "./src/report.js";
import {
  normalizeOptions,
  readEnvFlags,
  findOffendingPath,
  type NormalizedOptions,
  type EnvFlags,
} from "./src/options.js";

import { ServeLifecycle } from "./src/serve.js";
import { HttpClient } from "./src/http-client.js";
import { EventStream } from "./src/event-stream.js";
import { BackgroundStateStore, type BackgroundState } from "./src/background-state.js";
import { InstanceManager } from "./src/background.js";
import { createBgSpawnTool } from "./src/tools/bg-spawn.js";
import { createBgStatusTool } from "./src/tools/bg-status.js";
import { createBgCollectTool } from "./src/tools/bg-collect.js";
import { createBgKillTool } from "./src/tools/bg-kill.js";
import { createBgGetCommentsTool } from "./src/tools/bg-get-comments.js";

// --- Env-var constants (per spec §8) -------------------------------------

/** `BIZAR_SERVE_PORT` — default 0 (random). */
function readServePort(): number {
  const raw = process.env.BIZAR_SERVE_PORT;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 65535) return 0;
  return Math.floor(n);
}

/** `BIZAR_SERVE_DISABLE=1` disables the serve child entirely. */
function readServeDisabled(): boolean {
  return process.env.BIZAR_SERVE_DISABLE === "1";
}

/** `BIZAR_MAX_CONCURRENT_INSTANCES` — default 8. */
function readMaxConcurrent(): number {
  const raw = process.env.BIZAR_MAX_CONCURRENT_INSTANCES;
  if (raw === undefined || raw === "") return 8;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.floor(n);
}

/** `BIZAR_BACKGROUND_TOOL_CALL_CAP` — default 500. */
function readToolCallCap(): number {
  const raw = process.env.BIZAR_BACKGROUND_TOOL_CALL_CAP;
  if (raw === undefined || raw === "") return 500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.floor(n);
}

/**
 * v0.3.0 — `BIZAR_STALL_TIMEOUT_MS` — default 180000 (3 min).
 * Range [10000, 600000]; out-of-range falls back to default.
 */
function readStallTimeoutMs(): number {
  const raw = process.env.BIZAR_STALL_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 180_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) return 180_000;
  return Math.min(Math.floor(n), 600_000);
}

/**
 * v0.3.0 — `BIZAR_THINKING_LOOP_TIMEOUT_MS` — default 300000 (5 min).
 * Range [30000, 900000]; out-of-range falls back to default.
 */
function readThinkingLoopTimeoutMs(): number {
  const raw = process.env.BIZAR_THINKING_LOOP_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 300_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 30_000) return 300_000;
  return Math.min(Math.floor(n), 900_000);
}

/**
 * v0.3.0 — `BIZAR_MAX_INTERVENTIONS` — default 1.
 * Range [1, 3]; out-of-range falls back to default.
 */
function readMaxInterventions(): number {
  const raw = process.env.BIZAR_MAX_INTERVENTIONS;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 3);
}

/** `BIZAR_HTTP_TIMEOUT_MS` — default 30000. */
function readHttpTimeoutMs(): number {
  const raw = process.env.BIZAR_HTTP_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 30_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return 30_000;
  return Math.floor(n);
}

// --- Shutdown coordination -----------------------------------------------

/** Module-level guard for SIGTERM/SIGINT reentry (spec §5.3). */
let shuttingDown = false;
/** Module-level handle to the InstanceManager for the signal handlers. */
let instanceManagerHandle: InstanceManager | null = null;
let serveHandle: ServeLifecycle | null = null;
let streamHandle: EventStream | null = null;
let loggerHandle: Logger | null = null;

// --- Plugin entry point ---------------------------------------------------

/**
 * Runtime context shared across all hooks for one plugin instance. Created
 * during init and closed over by every hook closure.
 */
interface RuntimeContext {
  logger: Logger;
  options: NormalizedOptions;
  envFlags: EnvFlags;
  stateStore: StateStore;
  logWriter: LogWriter;
  worktree: string;
  /** sessionID → set of message IDs already processed (spec §4.5). */
  seenMessageIds: Map<string, Set<string>>;
  /** sessionID → pending system-transform message, set at warn/escalate. */
  pendingInjections: Map<string, string>;
}

/**
 * Default-exported Plugin function. The whole body is wrapped in try/catch
 * so that any initialization error logs via the SDK and returns empty
 * hooks — opencode never crashes on a broken plugin (spec §8.1).
 */
const plugin: Plugin = async (
  input: PluginInput,
  rawOptions?: PluginOptions,
) => {
  try {
    return await init(input, rawOptions);
  } catch (err) {
    try {
      const client = input.client as unknown as {
        app?: { log?: (input: unknown) => unknown };
      };
      client.app?.log?.({
        body: {
          service: "bizar",
          level: "error",
          message: `bizar: init failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    } catch {
      // ignore — logging must never throw
    }
    return {};
  }
};

export default plugin;

// --- Init ------------------------------------------------------------------

/**
 * Initialize the plugin and return the hooks object. Separated from the
 * top-level `plugin` function so the try/catch wrapper is unambiguous.
 */
async function init(
  input: PluginInput,
  rawOptions?: PluginOptions,
): Promise<Hooks> {
  const envFlags = readEnvFlags();
  const { options, notes } = normalizeOptions(rawOptions as never);

  const logger = createLogger(input.client as unknown as Parameters<typeof createLogger>[0]);
  loggerHandle = logger;

  // §6.4 — refuse to start if logDir or stateDir is inside a secret dir.
  const offending = findOffendingPath(options);
  if (offending !== null) {
    logger.error(
      `bizar: refusing to start — logDir/stateDir ${offending.path} is inside a secret directory (${offending.kind}). Set BIZAR_DISABLE=1 or specify a different path.`,
    );
    return {};
  }

  // §6.5 — BIZAR_DISABLE=1 disables the plugin entirely.
  if (envFlags.disable) {
    logger.debug("bizar: disabled via BIZAR_DISABLE=1");
    return {};
  }

  // Log any non-default normalization notes (spec §6.2).
  for (const note of notes) {
    logger.warn(`bizar: ${note}`);
  }

  const stateStore = new StateStore(options.stateDir, logger);
  const logWriter = new LogWriter(options.logDir, options.logRotationBytes, logger);

  // §4.6 — stale session cleanup (best-effort, on init).
  try {
    const validIds = await readValidSessionIds(input);
    const deleted = await stateStore.cleanup(7, validIds);
    if (deleted > 0) {
      logger.info(`bizar: cleaned up ${deleted} stale session file(s)`);
    }
  } catch (err) {
    logger.warn(
      `bizar: stale session cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Background agents (v0.4.2) -----------------------------------------

  let instanceManager: InstanceManager | null = null;
  let serve: ServeLifecycle | null = null;
  let stream: EventStream | null = null;
  let bgAvailable = false;

  if (readServeDisabled()) {
    logger.info("bizar: background agents disabled via BIZAR_SERVE_DISABLE=1");
  } else {
    try {
      const servePort = readServePort();
      const bgStateStore = new BackgroundStateStore(options.stateDir, logger);
      const backgroundStateCleanup = bgStateStore.cleanup(7).catch((err: unknown) => {
        logger.warn(
          `bizar: background state cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 0;
      });
      const maxConcurrent = readMaxConcurrent();
      const toolCallCap = readToolCallCap();
      const httpTimeoutMs = readHttpTimeoutMs();
      const stallTimeoutMs = readStallTimeoutMs();
      const thinkingLoopTimeoutMs = readThinkingLoopTimeoutMs();
      const maxInterventions = readMaxInterventions();

      serve = new ServeLifecycle({
        port: servePort,
        worktree: input.worktree,
        logger,
      });
      serveHandle = serve;
      const serveInfo = await serve.start();
      const http = new HttpClient({
        baseUrl: `http://127.0.0.1:${serveInfo.port}`,
        password: serveInfo.password,
        logger,
        timeoutMs: httpTimeoutMs,
      });
      const authHeader = `Basic ${btoa(`opencode:${serveInfo.password}`)}`;
      stream = new EventStream({
        baseUrl: `http://127.0.0.1:${serveInfo.port}`,
        directory: input.worktree,
        authHeader,
        logger,
        http,
      });
      streamHandle = stream;

      instanceManager = new InstanceManager({
        stateStore: bgStateStore,
        maxConcurrent,
        toolCallCap,
        logger,
        serve,
        http,
        stream,
        stallTimeoutMs,
        thinkingLoopTimeoutMs,
        maxInterventions,
      });
      instanceManagerHandle = instanceManager;

      // §5.4 — rebuild in-memory map from disk.
      await instanceManager.rebuildInMemoryMap();

      // §5.2 — crash-recovery handler.
      serve.onUnexpectedExit(() => {
        if (!instanceManager) return;
        void (async () => {
          try {
            await instanceManager.shutdownAll();
          } catch (err: unknown) {
            logger.warn(
              `bizar: shutdownAll on serve crash failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        })();
      });

      // Open the SSE connection (best-effort — failure does not abort init).
      try {
        await stream.connect();
        bgAvailable = true;
      } catch (err: unknown) {
        logger.warn(
          `bizar: SSE connection failed: ${err instanceof Error ? err.message : String(err)}; background agents will still accept new spawns (will reconnect on demand)`,
        );
      }

      // Surface the cleanup result.
      const deletedBg = await backgroundStateCleanup;
      if (deletedBg > 0) {
        logger.info(`bizar: cleaned up ${deletedBg} stale background state file(s)`);
      }

      logger.info(
        `bizar: background agents ready (port=${serveInfo.port}, cap=${maxConcurrent}, toolCallCap=${toolCallCap}, stallTimeoutMs=${stallTimeoutMs}, thinkingLoopTimeoutMs=${thinkingLoopTimeoutMs}, maxInterventions=${maxInterventions})`,
      );
    } catch (err: unknown) {
      logger.warn(
        `bizar: background agents unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Leave `bgAvailable = false`. The tools will return a clear error.
    }
  }

  // --- Signal traps (spec §5.3) ------------------------------------------

  installSignalHandlers(logger, instanceManager, serve, stream);

  const ctx: RuntimeContext = {
    logger,
    options,
    envFlags,
    stateStore,
    logWriter,
    worktree: input.worktree,
    seenMessageIds: new Map(),
    pendingInjections: new Map(),
  };

  return buildHooks(ctx, { instanceManager, bgAvailable });
}

// --- Signal handling (spec §5.3) -----------------------------------------

function installSignalHandlers(
  logger: Logger,
  instanceManager: InstanceManager | null,
  serve: ServeLifecycle | null,
  stream: EventStream | null,
): void {
  const onSignal = async (sig: "SIGTERM" | "SIGINT") => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`bizar: received ${sig}; shutting down`);

    // 1. Mark all in-memory instances as failed (spec §5.3 step 1).
    if (instanceManager !== null) {
      try {
        await instanceManager.shutdownAll();
      } catch (err: unknown) {
        logger.warn(
          `bizar: shutdownAll on ${sig} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // 2. Close SSE.
    if (stream !== null) {
      try {
        await stream.disconnect();
      } catch {
        // ignore
      }
    }

    // 3. Kill serve child.
    if (serve !== null) {
      try {
        await serve.stop();
      } catch (err: unknown) {
        logger.warn(
          `bizar: serve.stop on ${sig} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // 4. Exit. (Note: the host may keep the process alive if other work
    //    is pending, but for the plugin process this is the end.)
    try {
      process.exit(0);
    } catch {
      // process.exit may not be available in all environments; ignore.
    }
  };

  // Idempotent registration — if the plugin is reloaded, we don't want
  // duplicate handlers. Use `process.once` so each handler runs at most
  // once per signal; the `shuttingDown` guard catches reentry.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    try {
      process.removeAllListeners(sig);
    } catch {
      // ignore
    }
    process.on(sig, () => {
      void onSignal(sig);
    });
  }
}

// --- Hooks ----------------------------------------------------------------

/**
 * Best-effort read of valid session IDs from opencode. If `client.session`
 * is unavailable or the call fails, return an empty set — the age-based
 * branch of the cleanup still runs (spec §4.6).
 */
async function readValidSessionIds(input: PluginInput): Promise<Set<string>> {
  try {
    const client = input.client as unknown as {
      session?: { list?: () => Promise<{ data?: Array<{ id: string }> } | Array<{ id: string }>> };
    };
    if (!client.session || typeof client.session.list !== "function") {
      return new Set();
    }
    const result = await client.session.list();
    const list = Array.isArray(result) ? result : (result.data ?? []);
    return new Set(list.map((s) => s.id));
  } catch {
    return new Set();
  }
}

interface BgDeps {
  instanceManager: InstanceManager | null;
  bgAvailable: boolean;
}

/**
 * Build the hooks object. Each hook is a small async function that
 * delegates to the runtime context and the supporting modules.
 */
function buildHooks(ctx: RuntimeContext, bg: BgDeps): Hooks {
  // Build the 5 tools. We always register them; if the serve child is
  // not available, the background tools return a clear error. The
  // bizarre_get_plan_comments tool is read-only and only needs the
  // worktree, so it works regardless of the serve child's state.
  const tools = bg.instanceManager
    ? {
        bizarre_spawn_background: createBgSpawnTool({
          instanceManager: bg.instanceManager,
          http: (bg.instanceManager as unknown as { http: HttpClient }).http,
          worktree: ctx.worktree,
          logger: ctx.logger,
        }),
        bizarre_status: createBgStatusTool({
          instanceManager: bg.instanceManager,
          logger: ctx.logger,
        }),
        bizarre_collect: createBgCollectTool({
          instanceManager: bg.instanceManager,
          logger: ctx.logger,
        }),
        bizarre_kill: createBgKillTool({
          instanceManager: bg.instanceManager,
          logger: ctx.logger,
        }),
        bizarre_get_plan_comments: createBgGetCommentsTool({
          worktree: ctx.worktree,
          logger: ctx.logger,
        }),
      }
    : {
        ...bgDisabledTools(ctx.logger),
        // bizarre_get_plan_comments is read-only — it does not need the
        // background serve child. Register it even when the other
        // background tools are disabled.
        bizarre_get_plan_comments: createBgGetCommentsTool({
          worktree: ctx.worktree,
          logger: ctx.logger,
        }),
      };

  return {
    // §3.1 — config: no mutation. We already resolved options in init().
    config: async () => {
      // intentionally empty — options are resolved at init time
    },

    // §3.1, §4.5.1 — event: track session boundaries. We do NOT create
    // the state file here (canonical lifecycle: file is created at the
    // `chat.message` seed, per spec §4.5.1).
    event: async ({ event }) => {
      try {
        const ev = event as { type?: string; sessionID?: string };
        const type = ev.type;
        const sessionID = ev.sessionID;
        if (!type || !sessionID) return;

        if (type === "session.deleted") {
          await ctx.stateStore.withLock(sessionID, async () => {
            await ctx.stateStore.delete(sessionID);
          });
          ctx.pendingInjections.delete(sessionID);
          ctx.seenMessageIds.delete(sessionID);
        }
        // Other event types are no-ops on the hook side. The state file
        // is updated by `chat.message` and `tool.execute.before/after`.
      } catch (err) {
        ctx.logger.warn(
          `bizar: event hook error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    // §4.5 — seed session state on first user message per session.
    // The hook key is the literal string "chat.message" (with a dot) per
    // the opencode plugin API.
    "chat.message": async (input, _output) => {
      if (ctx.envFlags.disableLoop && ctx.envFlags.disableLog) return;
      const sessionID = input.sessionID;
      const messageID = input.messageID;
      const agent = input.agent;
      if (!sessionID) return;

      // Dedupe by message ID (spec §4.5).
      if (messageID) {
        let seen = ctx.seenMessageIds.get(sessionID);
        if (!seen) {
          seen = new Set();
          ctx.seenMessageIds.set(sessionID, seen);
        }
        if (seen.has(messageID)) return; // duplicate event — no-op
        seen.add(messageID);
      }

      // Seed parentAgent and create the state file on the first
      // message per session (spec §4.5.1 — canonical lifecycle).
      await ctx.stateStore.withLock(sessionID, async () => {
        const existing = await ctx.stateStore.load(sessionID);
        if (existing.parentAgent !== null) return; // already seeded
        const now = Date.now();
        const seeded: SessionState = {
          sessionId: sessionID,
          parentAgent: agent ?? null,
          startedAt: now,
          lastActivityAt: now,
          turnCount: 1,
          toolCalls: [],
          warningsIssued: 0,
          blocksTriggered: 0,
        };
        await ctx.stateStore.save(seeded);
        ctx.logger.debug(`bizar: seeded session ${sessionID} with parentAgent=${seeded.parentAgent}`);
      });
    },

    // §3.1, §5.1, §5.4 — primary loop-detection point.
    "tool.execute.before": async (input, output) => {
      if (ctx.envFlags.disableLoop) return;
      const sessionID = input.sessionID;
      const tool = input.tool;
      if (!sessionID || !tool) return;

      // Compute fingerprint of (tool, args). args is mutable in the
      // hook output; we read it as-is for fingerprinting.
      const args = output.args;
      const fp = fingerprint(tool, args, ctx.worktree);

      // All state mutations go through the per-session mutex (§4.3).
      await ctx.stateStore.withLock(sessionID, async () => {
        const state = await ctx.stateStore.load(sessionID);
        // Lazy fallback for subagent-only sessions: if the state file
        // doesn't exist yet (no chat.message has fired), create the
        // empty state now (spec §4.5.1).
        if (state.startedAt === 0) {
          const now = Date.now();
          state.parentAgent = null;
          state.startedAt = now;
          state.lastActivityAt = now;
        }

        // Append the current call to the state before deciding (§5.1:
        // the count includes the current call).
        const now = Date.now();
        state.toolCalls.push({ tool, fingerprint: fp, at: now });
        // Cap toolCalls at last 50 (§4.1).
        if (state.toolCalls.length > 50) {
          state.toolCalls.splice(0, state.toolCalls.length - 50);
        }
        state.lastActivityAt = now;
        state.turnCount += 1;

        const decision = decide(state, fp, now, ctx.options);

        if (decision.action === "allow") {
          await ctx.stateStore.save(state);
          return;
        }

        if (decision.action === "block") {
          state.blocksTriggered += 1;
          await ctx.stateStore.save(state);
          // Throw from the hook — surfaces as a tool error in the TUI
          // and runs BEFORE opencode's doom_loop recovery (§3.3).
          throw new Error(decision.reason);
        }

        // warn or escalate — log first, then queue the injection.
        if (decision.action === "warn") {
          state.warningsIssued += 1;
          if (isLogOnlyWarn(decision, ctx.options)) {
            // Threshold-3 band: log only, no injection (§5.4 row 1).
            ctx.logger.warn(`bizar: ${decision.reason}`);
          } else {
            // Threshold-5/8 band: queue system-transform injection.
            ctx.pendingInjections.set(sessionID, decision.reason);
            ctx.logger.warn(`bizar: ${decision.reason}`);
          }
        } else {
          // escalate — always inject.
          ctx.pendingInjections.set(sessionID, decision.reason);
          ctx.logger.warn(`bizar: ${decision.reason}`);
        }

        await ctx.stateStore.save(state);
      });
    },

    // §3.1 — record the call result and update the outcome.
    "tool.execute.after": async (input, output) => {
      if (ctx.envFlags.disableLoop && ctx.envFlags.disableLog) return;
      const sessionID = input.sessionID;
      const tool = input.tool;
      if (!sessionID || !tool) return;

      const startMs = Date.now();

      await ctx.stateStore.withLock(sessionID, async () => {
        const state = await ctx.stateStore.load(sessionID);
        if (state.startedAt === 0) return; // nothing to update
        // Find the matching call by fingerprint. The hook appends the
        // call in `before`; we update its outcome here.
        const fp = fingerprint(tool, input.args, ctx.worktree);
        const idx = findLastIndex(state.toolCalls, (c) => c.fingerprint === fp);
        if (idx >= 0) {
          const call = state.toolCalls[idx];
          if (call) {
            call.outcome = output && output.output ? "ok" : "error";
          }
        }
        state.lastActivityAt = Date.now();
        await ctx.stateStore.save(state);
      });

      // Per-call log line (§10.1). Metadata only — no args.
      if (!ctx.envFlags.disableLog) {
        const durationMs = Date.now() - startMs;
        const outcome: "ok" | "error" = output && output.output ? "ok" : "error";
        const fp = fingerprint(tool, input.args, ctx.worktree);
        try {
          await ctx.logWriter.write({
            sessionId: sessionID,
            agent: null, // per-call agent attribution removed (§4.4)
            tool,
            fingerprint: fp,
            outcome,
            durationMs,
          });
        } catch (err) {
          ctx.logger.warn(
            `bizar: log write failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },

    // §3.1, §5.4 — handoff injection point. We push a single string onto
    // `output.system` if a pending injection is queued for this session.
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) return;
      const pending = ctx.pendingInjections.get(sessionID);
      if (pending) {
        output.system.push(pending);
        ctx.pendingInjections.delete(sessionID);
      }
    },

    // v0.4.2 — register the 4 background tools.
    tool: tools,

    // v0.4.2 — dispose hook. Opencode calls this when the plugin is
    // being torn down. We do a best-effort cleanup similar to the
    // signal trap, but we do NOT call `process.exit` — that's the
    // signal handler's job.
    dispose: async () => {
      ctx.logger.debug("bizar: dispose hook fired");
      if (instanceManagerHandle !== null) {
        try {
          await instanceManagerHandle.shutdownAll();
        } catch (err: unknown) {
          ctx.logger.warn(
            `bizar: dispose: shutdownAll failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      if (streamHandle !== null) {
        try {
          await streamHandle.disconnect();
        } catch {
          // ignore
        }
      }
      if (serveHandle !== null) {
        try {
          await serveHandle.stop();
        } catch (err: unknown) {
          ctx.logger.warn(
            `bizar: dispose: serve.stop failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    },
  };
}

function findLastIndex<T>(
  arr: readonly T[],
  predicate: (item: T) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

/**
 * When the serve child failed to start, register the 4 background tools
 * as stubs that return a clear error. This keeps the agent experience
 * consistent: calling `bizar_spawn_background` always returns JSON, not
 * a thrown exception from the tool framework. The
 * `bizar_get_plan_comments` tool is NOT a background tool — it reads
 * plan files directly — and is always registered in `buildHooks`.
 */
function bgDisabledTools(logger: Logger): Hooks["tool"] {
  const disabled = (name: string) =>
    async () => {
      logger.debug(`bizar: ${name} called but background agents are disabled`);
      return {
        output: JSON.stringify({
          error: "background agents are disabled (opencode serve unavailable). See plugin logs.",
        }),
      };
    };
  return {
    bizarre_spawn_background: { execute: disabled("bizarre_spawn_background") } as never,
    bizarre_status: { execute: disabled("bizarre_status") } as never,
    bizarre_collect: { execute: disabled("bizarre_collect") } as never,
    bizarre_kill: { execute: disabled("bizarre_kill") } as never,
  };
}
