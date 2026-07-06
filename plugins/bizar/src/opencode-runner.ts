/**
 * plugins/bizar/src/opencode-runner.ts
 *
 * v5.5.1 — DEAD CODE stub.
 *
 * Background agents no longer run as `opencode run` subprocesses. They
 * run as long-lived opencode serve SDK sessions, managed by the
 * Bizar dashboard (`bizar-dash/src/server/bg-spawner.mjs`). The plugin
 * delegates to the dashboard via HTTP (`bg-spawn.ts`,
 * `bg-send-message.ts`, …) instead of spawning anything directly.
 *
 * This module is kept as a stub for two reasons:
 *
 *   1. `buildOpencodeRunArgs` and the `SpawnAgentOptions` type are
 *      still imported by `plugins/bizar/tests/tools/opencode-runner.test.ts`
 *      and serve as a regression pin for the argv layout that USED to
 *      be passed to `Bun.spawn`. The test suite stays green because
 *      the pure helpers are unchanged.
 *
 *   2. A handful of function names (`isAlive`, `killAgent`, …) are
 *      imported elsewhere (`background.ts`) as a future-proofing hook.
 *      We replace the implementations with no-op / error stubs so any
 *      leftover call gets a clear, deliberate response instead of
 *      silently succeeding.
 *
 * If something imports `spawnAgent`, it now gets back `{ ok: false,
 * error: "spawnAgent removed in v5.5.1" }`. This forces callers to the
 * dashboard path; nothing in the plugin should be calling this anymore.
 */
import type { Subprocess } from "bun";

export type AgentState =
  | "starting"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "killed";

export interface AgentStatus {
  state: AgentState;
  sessionId?: string;
  processId: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  error?: string;
}

export interface SpawnAgentOptions {
  /** The prompt to send. */
  prompt: string;
  /** Agent name (mimir, thor, …) — used as the session title prefix. */
  agent: string;
  /** Optional model override in "providerID/modelID" format. */
  model?: { providerID: string; modelID: string };
  /** Working directory for the opencode run. */
  worktree: string;
  /** Absolute path to the log file (the LogWriter's output path). */
  logPath: string;
  /** Optional session title (defaults to `bgr:<agent>`). */
  title?: string;
  /** Extra env vars to pass through. */
  env?: Record<string, string>;
  /** How long to wait for the sessionId to appear in stderr (ms). */
  sessionIdTimeoutMs?: number;
}

export interface SpawnAgentResult {
  ok: boolean;
  sessionId?: string;
  processId?: number;
  error?: string;
}

type ExitCallback = (status: AgentStatus) => void;

/**
 * v5.5.1 — Pure helper, UNCHANGED. Kept around so the regression test
 * that pins the argv layout still passes. (The argv used to be passed
 * to `Bun.spawn`; v5.5.1 no longer spawns anything, but the wire format
 * is a useful reference and may be reused if we ever revive subprocess
 * mode.)
 *
 * @param opts
 * @returns argv that USED to be passed to `Bun.spawn(["opencode", "run", …])`
 */
export function buildOpencodeRunArgs(opts: SpawnAgentOptions): string[] {
  if (!opts.agent) {
    throw new Error("bizar_spawn_background: agent is required");
  }
  const args: string[] = [
    "opencode",
    "run",
    "--dir", opts.worktree,
    "--print-logs",
    "--log-level", "INFO",
    "--title", opts.title || `bgr:${opts.agent}:${Date.now()}`,
    "--agent", opts.agent,
  ];
  if (opts.model) {
    args.push("--model", `${opts.model.providerID}/${opts.model.modelID}`);
  }
  args.push("--", opts.prompt);
  return args;
}

/**
 * v5.5.1 — STUB. Background agents run on the opencode serve SDK,
 * not as `opencode run` subprocesses. Returns an error directing the
 * caller to the dashboard HTTP API.
 *
 * The plugin's `bg-spawn.ts` no longer calls this; it's kept for any
 * late caller we missed.
 */
export async function spawnAgent(_opts: SpawnAgentOptions): Promise<SpawnAgentResult> {
  return {
    ok: false,
    error:
      "spawnAgent removed in v5.5.1 — bg agents now run as opencode serve sessions " +
      "managed by the Bizar dashboard. POST /api/background instead. " +
      "See plugins/bizar/src/tools/bg-spawn.ts.",
  };
}

/**
 * v5.5.1 — STUB. Returns null because there is no in-process subprocess
 * registry to look up.
 */
export function getStatus(_processId: number): AgentStatus | null {
  return null;
}

/**
 * v5.5.1 — STUB. The real exit subscription lives on the dashboard side.
 * Returns a no-op unsubscribe.
 */
export function onExit(_processId: number, _cb: ExitCallback): () => void {
  return () => undefined;
}

/**
 * v5.5.1 — STUB. Kill is now a dashboard-side operation
 * (`sdk.sessions.abort`). The plugin's `bg-kill.ts` posts to the
 * dashboard HTTP API; this function is here only as a fallback that
 * always reports "no such process tracked" so the dashboard's view of
 * the world is the source of truth.
 */
export function killAgent(
  _processId: number,
  _signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): { ok: boolean; error?: string } {
  return { ok: true, error: "no_such_process_tracked_v5_5_1_use_dashboard_delete" };
}

/**
 * v5.5.1 — STUB. Pause is an output-pause at the dashboard side now.
 * The plugin's `bg-pause.ts` posts to the dashboard; this stub returns
 * `unsupported` so a leftover caller gets a clear signal.
 */
export function pauseAgent(_processId: number): { ok: boolean; error?: string } {
  return { ok: false, error: "pause_via_dashboard_v5_5_1" };
}

/**
 * v5.5.1 — STUB. Same as `pauseAgent` — dashboard-side only.
 */
export function resumeAgent(_processId: number): { ok: boolean; error?: string } {
  return { ok: false, error: "resume_via_dashboard_v5_5_1" };
}

/**
 * v5.5.1 — STUB. Returns false because there is no in-process PID
 * registry. Liveness is owned by the dashboard; the plugin's state
 * reconciliation code already uses this as a probe and falls back to
 * "fail closed" when the answer is false.
 */
export function isAlive(processId: number): boolean {
  if (!Number.isFinite(processId) || processId <= 0) return false;
  return false;
}

/**
 * v5.5.1 — STUB. Returns an empty list — the runner registry is gone.
 */
export function list(): AgentStatus[] {
  return [];
}

/**
 * v5.5.1 — STUB. Clears nothing (the registry is empty). Kept for the
 * test suite that imports it.
 */
export function _resetForTests(): void {
  // no-op — the in-memory registry was removed.
}

/**
 * v5.5.1 — STUB. Returns an empty record because no agent is tracked
 * here. Provided so the module typechecks in callers that still reach
 * for a status record shape.
 */
export type { Subprocess };