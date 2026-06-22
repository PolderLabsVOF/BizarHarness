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
 *   v0.4.0 (visual plan flow — slash commands + plan tools):
 *     - §v4.1 — `chat.message` hook detects slash commands BEFORE state
 *       seeding. Settings changes are applied silently; commands with
 *       a response text are surfaced by throwing from the hook (the
 *       same pattern `tool.execute.before` uses for block decisions).
 *     - §v4.2 — `SettingsStore` persists user-controlled plan settings
 *       (visualPlanEnabled, defaultTemplate, lastUsedSlug) at
 *       `~/.cache/bizar/plan-settings.json`. Atomic writes,
 *       corrupt-file fallback to defaults, no throw on bad input.
 *     - §v4.3 — `parseSlashCommand` is a pure function (no I/O). The
 *       hook gathers context (current settings, available plan slugs)
 *       and feeds it to the parser.
 *     - §v4.4 — `bizar_plan_action` tool exposes CRUD on the v2
 *       canvas (`plan.json`) and the plan metadata (`meta.json`).
 *       Pure file I/O — no serve child required.
 *     - §v4.5 — `bizar_wait_for_feedback` tool polls every 2 s until
 *       a new comment appears, status becomes approved/rejected, or
 *       the timeout fires. Never throws.
 *
 *   v0.5.0 (visual plan wiring — chat hook executes side effects):
 *     - §v5.1 — `chat.message` hook now invokes the parser, then
 *       calls `executeSideEffect(result.sideEffect, ctx, opts)` from
 *       `src/commands-impl.ts` BEFORE throwing the response. Side
 *       effects include `create_plan` (mkdir + write meta/canvas
 *       via `src/plan-fs.ts`), `list_plans` (re-read directory and
 *       return rich list), `open_plan_url` (no I/O), and
 *       `tool_invocation` (build synthetic `ToolContext`, validate
 *       args via the tool's Zod schema, then call `tool.execute`).
 *     - §v5.2 — synthetic `ToolContext` is built from the runtime
 *       context's `worktree` and `directory`, a fresh
 *       `AbortController().signal`, and no-op `metadata`/`ask`
 *       stubs. NOT from the chat-message input. Session/message/agent
 *       IDs use a `"slash-command"` sentinel so downstream code can
 *       recognize out-of-band calls.
 *     - §v5.3 — tool key names use the `bizar_*` form (single `r`)
 *       throughout the plugin, matching the docs and
 *       `config/opencode.json`. The earlier `bizarre_*` typo silently
 *       disabled the plan tools at runtime; the rename brings the
 *       runtime registry back in sync.
 *     - §v5.4 — subcommand form: `/plan get|add|update|delete|comment|
 *       comments|status|wait` route through `bizar_plan_action` (or
 *       `bizar_get_plan_comments`) via the new `tool_invocation`
 *       side-effect. `/plan wait` is deferred from MVP and returns
 *       a clear "use bizar_wait_for_feedback directly" response.
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
import { writeServeInfo, clearServeInfo } from "./src/serve-info.js";
import { HttpClient } from "./src/http-client.js";
import { EventStream } from "./src/event-stream.js";
import { BackgroundStateStore, type BackgroundState } from "./src/background-state.js";
import { InstanceManager } from "./src/background.js";
import { createBgSpawnTool } from "./src/tools/bg-spawn.js";
import { createBgStatusTool } from "./src/tools/bg-status.js";
import { createBgCollectTool } from "./src/tools/bg-collect.js";
import { createBgKillTool } from "./src/tools/bg-kill.js";
import { createBgGetCommentsTool } from "./src/tools/bg-get-comments.js";

// v0.4.0 — visual plan flow: settings, slash commands, plan tools
import { SettingsStore } from "./src/settings.js";
import { parseSlashCommand } from "./src/commands.js";
import { createPlanActionTool } from "./src/tools/plan-action.js";
import { createWaitForFeedbackTool } from "./src/tools/wait-for-feedback.js";

// v0.5.0 — visual plan wiring: side-effect executor + plan-fs
import { executeSideEffect, type ExecuteOptions } from "./src/commands-impl.js";

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
const signalHandlerRefs = new Map<"SIGTERM" | "SIGINT", () => void>();

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
  settingsStore: SettingsStore;
  logWriter: LogWriter;
  worktree: string;
  /** Project directory (often equal to `worktree`; the viewer / TUI
   *  may use this to display paths differently). v0.5.0 — the synthetic
   *  `ToolContext` built for slash-command tool invocations reads this. */
  directory: string;
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
  const settingsStore = new SettingsStore(options.stateDir, logger);
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
      // v3.5.7 — Persist serve-info so the dashboard can talk to us
      try {
        writeServeInfo(options.stateDir, {
          baseUrl: serveInfo.baseUrl,
          port: serveInfo.port,
          password: serveInfo.password,
          worktree: serveInfo.worktree,
          pid: serveInfo.pid,
          startedAt: serveInfo.startedAt,
        }, logger);
        logger.info(`[bizar] wrote serve-info to ${options.stateDir}/serve.json`);
      } catch (err) {
        logger.warn(`[bizar] failed to write serve-info: ${err instanceof Error ? err.message : String(err)}`);
      }
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

  installSignalHandlers(logger, instanceManager, serve, stream, options.stateDir);

  const ctx: RuntimeContext = {
    logger,
    options,
    envFlags,
    stateStore,
    settingsStore,
    logWriter,
    worktree: input.worktree,
    directory: input.directory,
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
  stateDir: string,
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

    // 4. Clear serve-info so the dashboard doesn't try to talk to a dead serve.
    clearServeInfo(stateDir, logger);

    // 5. Exit. (Note: the host may keep the process alive if other work
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
    const previous = signalHandlerRefs.get(sig);
    if (previous) {
      try {
        process.removeListener(sig, previous);
      } catch {
        // ignore
      }
    }
    const handler = () => {
      void onSignal(sig);
    };
    signalHandlerRefs.set(sig, handler);
    process.once(sig, handler);
  }
}

// --- Init helpers ---------------------------------------------------------

/**
 * Race a promise against a timeout. Returns the promise's value if it
 * resolves in time; throws a labeled `Error` otherwise.
 *
 * The original promise is intentionally NOT cancelled (we don't have
 * an `AbortSignal` to pass to the opencode client). If the underlying
 * call eventually rejects after we've already returned, the caller
 * should attach a no-op `.catch(() => undefined)` to suppress the
 * unhandled-rejection warning.
 *
 * v0.5.2: extracted from `readValidSessionIds` so it can be unit
 * tested in isolation. See `tests/init-helpers.test.ts`.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// --- Hooks ----------------------------------------------------------------

/**
 * Best-effort read of valid session IDs from opencode. If `client.session`
 * is unavailable or the call fails or times out, return an empty set —
 * the age-based branch of the cleanup still runs (spec §4.6).
 *
 * v0.5.2 FIX (postmortem 2026-06-18, Layer 1): the previous version
 * called `client.session.list()` with no timeout. If the session
 * store was slow, busy, or in a broken state, the call would hang
 * forever, blocking the plugin's `init()` and stalling the UI on a
 * blank screen. We now race the call against a 1-second timeout and
 * fall back to an empty set on timeout.
 */
export async function readValidSessionIds(input: PluginInput): Promise<Set<string>> {
  try {
    const client = input.client as unknown as {
      session?: { list?: () => Promise<{ data?: Array<{ id: string }> } | Array<{ id: string }>> };
    };
    if (!client.session || typeof client.session.list !== "function") {
      return new Set();
    }
    // Suppress unhandled rejection if the call eventually rejects after
    // the timeout has already fired (see `withTimeout` note above).
    const listPromise = client.session.list();
    listPromise.catch(() => undefined);
    const result = await withTimeout(
      listPromise,
      1000,
      "client.session.list",
    );
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

// --- Slash-command helpers (v0.4.0) ------------------------------------

/**
 * Read the user-typed text from a `chat.message` hook output.
 *
 * `output.parts` is a discriminated union (`Part[]`). We concatenate any
 * TextPart entries. Other part types (file, tool, etc.) are skipped.
 *
 * Returns `null` if no text could be extracted (e.g. the message is a
 * file-only attachment, or the parts array is missing/malformed).
 */
function readMessageText(
  output: { message?: unknown; parts?: unknown } | undefined,
): string | null {
  if (!output || !Array.isArray(output.parts)) return null;
  const parts = output.parts as Array<{ type?: string; text?: string }>;
  const fragments: string[] = [];
  for (const part of parts) {
    if (part && part.type === "text" && typeof part.text === "string") {
      fragments.push(part.text);
    }
  }
  const joined = fragments.join("\n").trim();
  return joined === "" ? null : joined;
}

/**
 * List the slugs of plans in the worktree's `plans/` directory.
 *
 * Pure best-effort: returns `[]` on missing dir, read errors, or any
 * I/O exception. The slash-command parser uses this only for the
 * `/plan list` response, so a missing list should not throw.
 */
async function listPlanSlugs(worktree: string, logger: Logger): Promise<string[]> {
  try {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const plansDir = join(worktree, "plans");
    let entries: string[];
    try {
      entries = readdirSync(plansDir);
    } catch {
      return [];
    }
    const slugs: string[] = [];
    for (const name of entries) {
      try {
        const stat = statSync(join(plansDir, name));
        if (stat.isDirectory()) slugs.push(name);
      } catch {
        // skip unreadable entries
      }
    }
    slugs.sort();
    return slugs;
  } catch (err: unknown) {
    logger.debug(
      `bizar: listPlanSlugs failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Build the hooks object. Each hook is a small async function that
 * delegates to the runtime context and the supporting modules.
 */
function buildHooks(ctx: RuntimeContext, bg: BgDeps): Hooks {
  // Build the 7 tools. We always register them; if the serve child is
  // not available, the background tools return a clear error. The
  // bizar_get_plan_comments, bizar_plan_action, and
  // bizar_wait_for_feedback tools only need the worktree, so they
  // work regardless of the serve child's state.
  //
  // v0.4.0 — added `bizar_plan_action` (CRUD on the v2 canvas) and
  // `bizar_wait_for_feedback` (poll until feedback). Both are pure
  // file I/O — no serve child required.
  //
  // v0.5.0 — renamed `bizarre_*` → `bizar_*` (single `r`) to match
  // the docs and `config/opencode.json`. The earlier typo silently
  // disabled the plan tools at runtime; this fix brings the registry
  // in sync.
  const basePlanTools = {
    bizar_get_plan_comments: createBgGetCommentsTool({
      worktree: ctx.worktree,
      logger: ctx.logger,
    }),
    bizar_plan_action: createPlanActionTool({
      worktree: ctx.worktree,
      logger: ctx.logger,
    }),
    bizar_wait_for_feedback: createWaitForFeedbackTool({
      worktree: ctx.worktree,
      logger: ctx.logger,
    }),
  };
  const tools = bg.instanceManager
    ? {
        ...basePlanTools,
        bizar_spawn_background: createBgSpawnTool({
          instanceManager: bg.instanceManager,
          http: (bg.instanceManager as unknown as { http: HttpClient }).http,
          worktree: ctx.worktree,
          logger: ctx.logger,
        }),
        bizar_status: createBgStatusTool({
          instanceManager: bg.instanceManager,
          logger: ctx.logger,
        }),
        bizar_collect: createBgCollectTool({
          instanceManager: bg.instanceManager,
          logger: ctx.logger,
        }),
        bizar_kill: createBgKillTool({
          instanceManager: bg.instanceManager,
          logger: ctx.logger,
        }),
      }
    : {
        ...basePlanTools,
        ...bgDisabledTools(ctx.logger),
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
    //
    // §v4.1 (v0.4.0) — Slash command detection happens FIRST, before the
    // existing state-seeding logic. If the user typed a slash command we:
    //   1. Apply any settings patch via `SettingsStore`.
    //   2. Execute the side-effect (v0.5.0 — previously silently dropped).
    //   3. Throw the response text. The host (TUI/CLI) surfaces it to
    //      the user; the LLM sees it on the next turn as a tool error.
    //
    // We chose throw-over-mutate because:
    //   - Throwing is the same pattern `tool.execute.before` uses for
    //     loop-detection blocks (see §5.4). It's well-tested in production.
    //   - Mutating `output.parts` / `output.message` is brittle — the
    //     shapes differ between opencode versions, and the host may not
    //     honor a synthetic `text` part from a hook.
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID;
      const messageID = input.messageID;
      const agent = input.agent;
      if (!sessionID) return;

      // --- v0.4.0: slash command detection -----------------------------
      // Runs before the disableLoop/disableLog check — slash commands
      // should work even when loop detection / logging is off.
      try {
        const messageText = readMessageText(output);
        if (messageText !== null) {
          const currentSettings = await ctx.settingsStore.get();
          const availableSlugs = await listPlanSlugs(ctx.worktree, ctx.logger);
          const result = parseSlashCommand(messageText, {
            currentSettings,
            availablePlanSlugs: availableSlugs,
            defaultPort: 4321,
          });
          if (result !== null) {
            if (result.settingsPatch) {
              await ctx.settingsStore.update(result.settingsPatch);
            }
            // --- v0.5.0: execute the side-effect (was silently dropped
            //             in v0.4.0). The executor returns an optional
            //             override/suffix that replaces/appends the
            //             parser's response. Tool invocations build a
            //             synthetic ToolContext and pre-validate args.
            let finalResponse = result.response;
            if (result.sideEffect !== undefined) {
              const execOpts: ExecuteOptions = {
                tools,
                defaultTemplate: currentSettings.defaultTemplate,
                defaultPort: 4321,
              };
              try {
                const exec = await executeSideEffect(
                  result.sideEffect,
                  {
                    worktree: ctx.worktree,
                    directory: ctx.directory,
                    logger: ctx.logger,
                  },
                  execOpts,
                );
                if (exec.responseOverride !== undefined) {
                  finalResponse = exec.responseOverride;
                } else if (exec.responseSuffix !== undefined) {
                  finalResponse = `${result.response}${exec.responseSuffix}`;
                }
              } catch (execErr: unknown) {
                // Defense-in-depth — `executeSideEffect` already catches
                // its own errors, but if it ever throws (e.g. a bug in
                // a future handler) we stringify into the response
                // rather than crashing the chat hook.
                const msg =
                  execErr instanceof Error ? execErr.message : String(execErr);
                ctx.logger.warn(`bizar: side-effect crashed: ${msg}`);
                finalResponse = `Command failed: ${msg}`;
              }
            }
            // Surface the response to the user/host. We throw so the
            // message is treated as handled; the LLM does not process
            // it further. The host renders the throw message.
            throw new Error(finalResponse);
          }
        }
      } catch (err) {
        // Re-throw — if it's our slash-command response, propagate it.
        // If it's an unexpected I/O error, log and fall through.
        if (err instanceof Error && err.message !== "" && err.message !== undefined) {
          // Heuristic: errors we throw ourselves contain a non-technical
          // response (starts with one of the canonical prefixes OR is
          // simply a human-readable sentence). Errors from I/O contain
          // "ENOENT", "EACCES", etc. We always re-throw errors that the
          // parser produced (response starts with known prefixes or
          // doesn't contain a colon+code pattern).
          const msg = err.message;
          const looksLikeIoError = /(ENOENT|EACCES|EROFS|EISDIR|EPERM|Error:)/.test(msg);
          if (!looksLikeIoError) {
            throw err;
          }
        }
        ctx.logger.warn(
          `bizar: slash-command handling failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Fall through to normal state seeding.
      }

      // --- v0.3.0: state seeding ----------------------------------------
      if (ctx.envFlags.disableLoop && ctx.envFlags.disableLog) return;

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
            call.outcome = output && typeof output.output === "string" ? "ok" : "error";
          }
        }
        state.lastActivityAt = Date.now();
        await ctx.stateStore.save(state);
      });

      // Per-call log line (§10.1). Metadata only — no args.
      if (!ctx.envFlags.disableLog) {
        const durationMs = Date.now() - startMs;
        const outcome: "ok" | "error" = output && typeof output.output === "string" ? "ok" : "error";
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
      clearServeInfo(ctx.options.stateDir, ctx.logger);
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
 * a thrown exception from the tool framework. The plan tools
 * (`bizar_get_plan_comments`, `bizar_plan_action`, `bizar_wait_for_feedback`)
 * are NOT background tools — they read/write plan files directly — and
 * are always registered in `buildHooks`.
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
    bizar_spawn_background: { execute: disabled("bizar_spawn_background") } as never,
    bizar_status: { execute: disabled("bizar_status") } as never,
    bizar_collect: { execute: disabled("bizar_collect") } as never,
    bizar_kill: { execute: disabled("bizar_kill") } as never,
  };
}
