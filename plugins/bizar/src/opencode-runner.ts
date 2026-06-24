/**
 * plugins/bizar/src/opencode-runner.ts
 *
 * v0.8.0 — Process-based background agent runner.
 *
 * Replaces the v0.4–v0.7 `opencode serve` HTTP path. The HTTP API is
 * passive — see the opencode docs:
 *   "When you run opencode it starts a TUI and a server. Where the
 *    TUI is the client that talks to the server."
 *
 * `opencode run <prompt>` is the active path: it spawns the agent
 * loop in-process, drives it to completion, and exits. This module
 * gives the plugin a clean way to spawn one `opencode run` per
 * background agent, capture its output to the LogWriter's log file,
 * track the PID for status/kill, and extract the opencode session
 * id from the structured log stream.
 *
 * ─────────────────────────────────────────────────────────────────
 * Why this exists (v0.7.0-alpha.1 → v0.8.0)
 * ─────────────────────────────────────────────────────────────────
 * Pre-v0.8.0, the plugin POSTed to `/api/session/{id}/prompt` on the
 * opencode serve child. The server admitted the prompt
 * (`session.next.prompt.admitted` event) but no agent loop processed
 * it. The result: a session record was created, a tmux pane was
 * spawned, and nothing happened. The user saw "spawns but does
 * nothing" and was right.
 *
 * This module fixes that by spawning `opencode run` directly.
 *
 * ─────────────────────────────────────────────────────────────────
 * Wire format
 * ─────────────────────────────────────────────────────────────────
 * `opencode run` writes structured logs to stderr, one log per line:
 *
 *   timestamp=2026-06-24T01:25:13.537Z level=INFO run=<uuid> message="creating instance" directory=/tmp
 *   timestamp=2026-06-24T01:25:16.555Z level=INFO run=<uuid> message=created id=ses_… title="…" agent=…
 *   timestamp=2026-06-24T01:25:16.951Z level=INFO run=<uuid> message=loop session.id=ses_… step=0
 *   timestamp=2026-06-24T01:25:21.253Z level=INFO run=<uuid> message="exiting loop" session.id=ses_…
 *
 * The `message=created id=ses_<id>` line is how we recover the
 * sessionId (the agent generated it; we don't pre-allocate). We
 * parse the line with `message=created id=(ses_[A-Za-z0-9_]+)`.
 *
 * Both stdout and stderr are piped to `logPath` so the operator's
 * tmux pane (and the dashboard's log viewer) can watch the agent
 * work in real time. We prefix each line with the stream name
 * ([stdout] / [stderr]) for human readability; downstream parsers
 * can split on the first `] `.
 */
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Subprocess } from "bun";

export type AgentState = "starting" | "running" | "done" | "failed" | "killed";

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

interface AgentRecord {
  status: AgentStatus;
  proc: Subprocess;
  onExit: ExitCallback[];
  // Resolvers for the spawn promise. Consumed when the sessionId
  // arrives (or the process exits before that).
  spawnResolvers: Array<(result: SpawnAgentResult) => void>;
}

// Module-level registry of running agents.
const agents = new Map<number, AgentRecord>();

// --- Public API -----------------------------------------------------------

/**
 * Pure: build the argv array for `opencode run` from SpawnAgentOptions.
 *
 * Extracted from spawnAgent so it can be unit-tested without spawning
 * a real process. Throws when opts.agent is empty — `opencode run`
 * requires a known agent name; passing an empty string would silently
 * fall back to opencode's default agent and break session attribution
 * (the title prefix `bgr:<agent>:...` would also degrade to `bgr::...`).
 *
 * Arg layout (matches `opencode run --help`):
 *   opencode run
 *     --dir <worktree>
 *     --print-logs
 *     --log-level INFO
 *     --title <title>
 *     --agent <agent>          ← REQUIRED; was missing pre-v0.8.1
 *     [--model <providerID>/<modelID>]   ← optional override
 *     -- <prompt>
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
  // `--` separates flags from positional so a prompt starting with
  // `-` is treated as a message.
  args.push("--", opts.prompt);
  return args;
}

/**
 * Spawn a single `opencode run` process. The promise resolves once
 * the opencode child has reported its session id in the structured
 * log stream (or once the process exits before that — typically
 * because of an early error like a missing API key).
 *
 * @param opts
 * @returns Promise resolving with `{ ok, sessionId?, processId? }` or `{ ok: false, error }`
 */
export async function spawnAgent(opts: SpawnAgentOptions): Promise<SpawnAgentResult> {
  // 1. Pre-flight: log dir must exist so the stream can open.
  const logDir = dirname(opts.logPath);
  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (err: unknown) {
      return {
        ok: false,
        error: `cannot create log dir ${logDir}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 2. Build argv. Pulled into a pure function so tests can assert the
  //    flag layout (notably the `--agent` flag and the migrated model
  //    ID format) without spawning a real `opencode run` process.
  const args = buildOpencodeRunArgs(opts);

  // 3. Spawn the process.
  let proc: Subprocess;
  try {
    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...(opts.env || {}) },
    });
  } catch (err: unknown) {
    return {
      ok: false,
      error: `failed to spawn opencode run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. Track the agent.
  const rec: AgentRecord = {
    status: {
      state: "starting",
      processId: proc.pid,
      startedAt: Date.now(),
    },
    proc,
    onExit: [],
    spawnResolvers: [],
  };
  agents.set(proc.pid, rec);

  // 5. Pipe stdout+stderr to the log file. Both go to the same file;
  //    lines are prefixed [stdout] / [stderr] for readability.
  const logStream = createWriteStream(opts.logPath, { flags: "a" });
  const decoder = new TextDecoder("utf-8");
  const sessionIdRegex = /message=created id=(ses_[A-Za-z0-9_]+)/;
  let sessionId: string | undefined;

  const resolveSpawnIfReady = (forceError?: string) => {
    const resolvers = rec.spawnResolvers.splice(0);
    if (resolvers.length === 0) return;
    if (forceError) {
      for (const r of resolvers) {
        r({ ok: false, processId: proc.pid, error: forceError });
      }
      return;
    }
    if (sessionId) {
      rec.status.state = "running";
      for (const r of resolvers) {
        r({ ok: true, sessionId, processId: proc.pid });
      }
    }
  };

  const readStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    label: "stderr" | "stdout",
  ): Promise<void> => {
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        logStream.write(`[${label}] ${text}`);
        if (label === "stderr" && !sessionId) {
          buf += text;
          const m = buf.match(sessionIdRegex);
          if (m && m[1]) {
            sessionId = m[1];
            rec.status.sessionId = sessionId;
            resolveSpawnIfReady();
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  };

  // 6. Stream readers + exit handler — install BEFORE returning the
  //    promise so a fast-exiting process still produces a clean
  //    resolution.
  const stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader() as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>;
  const stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader() as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>;
  void readStream(stderrReader, "stderr");
  void readStream(stdoutReader, "stdout");

  proc.exited
    .then((exitCode: number | null) => {
      const code = exitCode ?? -1;
      rec.status.exitCode = exitCode ?? undefined;
      rec.status.endedAt = Date.now();
      if (rec.status.state !== "killed") {
        rec.status.state = code === 0 ? "done" : "failed";
        if (code !== 0 && !rec.status.error) {
          rec.status.error = `opencode run exited with code ${code}`;
        }
      }
      // Resolve any unresolved spawn promises.
      if (!sessionId) {
        resolveSpawnIfReady(rec.status.error || "opencode run exited before reporting session id");
      }
      // Fire subscribers.
      const cbs = rec.onExit.splice(0);
      for (const cb of cbs) {
        try { cb({ ...rec.status }); } catch { /* ignore */ }
      }
      // Best-effort flush + close of the log stream.
      try { logStream.end(); } catch { /* ignore */ }
    })
    .catch(() => {
      // proc.exited only rejects if the proc was already awaited or
      // never spawned; safe to ignore.
    });

  // 7. Race the spawn promise against a timeout. The default is 10s
  //    which is plenty for opencode to print the "created" line on
  //    a warm host (<500ms in practice).
  const sessionIdTimeoutMs = opts.sessionIdTimeoutMs ?? 10_000;
  return new Promise<SpawnAgentResult>((resolve) => {
    rec.spawnResolvers.push(resolve);
    setTimeout(() => {
      if (!sessionId) {
        resolveSpawnIfReady(
          `opencode run did not report a session id within ${sessionIdTimeoutMs}ms`,
        );
      }
    }, sessionIdTimeoutMs);
  });
}

/**
 * Snapshot the current status of an agent. Returns null if the
 * processId is not tracked (e.g. the plugin restarted and lost its
 * in-memory map).
 */
export function getStatus(processId: number): AgentStatus | null {
  const rec = agents.get(processId);
  if (!rec) return null;
  return { ...rec.status };
}

/**
 * Subscribe to the exit event. The callback fires exactly once when
 * the process exits (whether naturally or via signal). Multiple
 * subscribers are allowed; all of them fire in registration order.
 *
 * @returns unsubscribe function
 */
export function onExit(processId: number, cb: ExitCallback): () => void {
  const rec = agents.get(processId);
  if (!rec) return () => undefined;
  rec.onExit.push(cb);
  // If the agent has already exited, fire the callback immediately
  // (next microtask) so the caller doesn't have to special-case
  // pre-exited agents.
  if (rec.status.endedAt !== undefined) {
    queueMicrotask(() => {
      try { cb({ ...rec.status }); } catch { /* ignore */ }
    });
  }
  return () => {
    const i = rec.onExit.indexOf(cb);
    if (i >= 0) rec.onExit.splice(i, 1);
  };
}

/**
 * Kill the agent. Sends the requested signal (default SIGTERM),
 * waits up to 5s, then SIGKILL. Idempotent.
 */
export function killAgent(
  processId: number,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): { ok: boolean; error?: string } {
  const rec = agents.get(processId);
  if (!rec) {
    return { ok: true, error: "no such process tracked" };
  }
  if (rec.status.endedAt !== undefined) {
    return { ok: true, error: "process already exited" };
  }
  rec.status.state = "killed";
  try {
    rec.proc.kill(signal);
  } catch (err: unknown) {
    return {
      ok: false,
      error: `kill(${signal}) failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // Schedule a forced kill after 5s in case SIGTERM is ignored.
  setTimeout(() => {
    if (rec.status.endedAt === undefined) {
      try { rec.proc.kill("SIGKILL"); } catch { /* ignore */ }
    }
  }, 5_000);
  return { ok: true };
}

/**
 * List every tracked agent. Used by the plugin's startup to reconcile
 * state and by tests.
 */
export function list(): AgentStatus[] {
  return Array.from(agents.values()).map((r) => ({ ...r.status }));
}

/**
 * For tests: clear the in-memory registry. Does NOT kill running
 * processes — callers must `killAgent()` first if they want that.
 */
export function _resetForTests(): void {
  agents.clear();
}
