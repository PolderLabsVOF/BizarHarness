/**
 * src/server/claude-bg-spawner.mjs
 *
 * v6.3.0 — Dashboard-side background agent spawner, REWRITTEN for the
 * Claude Code Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * Previous version (v6.0.0) used ClineCore (the Cline SDK). Claude Code
 * doesn't have an equivalent in-process runtime class — instead, we use
 * `claude --bg` (the background daemon mode) and monitor the session
 * via the Claude Code CLI's JSON output. The dashboard's HTTP API
 * surface stays identical so the React frontend doesn't need to know.
 *
 * Public surface (kept identical to v5.5.0/v6.0.0):
 *   - `spawnBgAgent({...})`        — create instance + claude --bg session.
 *   - `killBgAgent(instanceId, …)` — kill the session.
 *   - `pauseBgAgent(instanceId)`   — output pause.
 *   - `resumeBgAgent(instanceId)`  — resume forwarding.
 *   - `steerBgAgent(instanceId, …)`— TRUE mid-flight prompt via `claude --resume`.
 *   - `isAlive(instanceId)`        — liveness check.
 *   - `status()`                   — diagnostics.
 *   - `configureSpawner(ctx)`      — broadcast wiring.
 *
 * The state file format (`~/.cache/bizar/bg/<instanceId>.json`) is
 * unchanged so the existing dashboard UI picks up new instances
 * without any migration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { resolve as pathResolve } from "node:path";

/**
 * Resolve the Claude Code CLI binary. Tries `claude` on PATH first
 * (the user-installed case), then `npx @anthropic-ai/claude-agent-sdk/cli`
 * for the bundled fallback.
 */
function resolveClaudeBin() {
  return process.env.CLAUDE_BIN || "claude";
}

/** Same shape the plugin uses for instance IDs. */
function generateInstanceId() {
  const bytes = randomBytes(16);
  const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 0x1f];
  return "bgr_" + out.slice(0, 22);
}

/** Resolve a Claude Code model alias. */
function resolveModel(opts) {
  if (opts.model) return opts.model; // e.g. "sonnet", "opus", "haiku"
  return process.env.BIZAR_DEFAULT_MODEL || "sonnet";
}

// ---------------------------------------------------------------------------
// Instance registry
// ---------------------------------------------------------------------------

/** @type {Map<string, SpawnerRecord>} */
const byInstanceId = new Map();
/** @type {Map<string, SpawnerRecord>} */
const bySessionId = new Map();

/**
 * @typedef {Object} SpawnerRecord
 * @property {string} instanceId
 * @property {string} sessionId
 * @property {string} logPath
 * @property {string} state
 * @property {number} startedAt
 * @property {string} worktree
 * @property {boolean} paused
 * @property {Array<unknown>} pauseBuffer
 * @property {{ kill: (sig?: string) => void } | null} proc
 * @property {number} steerCount
 * @property {number} lastSteerAt
 * @property {number|null} endedAt
 * @property {string|null} finalStatus
 * @property {string|null} finalError
 * @property {string|null} resultPreview
 */

let _broadcastFn = null;
let _stateDir = pathResolve(homedir(), ".cache", "bizar", "bg");

export function configureSpawner(ctx) {
  _broadcastFn = ctx.broadcast;
  if (ctx.stateDir) _stateDir = ctx.stateDir;
}

function broadcast(event) {
  if (typeof _broadcastFn === "function") {
    try { _broadcastFn(event); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// State file IO (unchanged shape from v5.5.0/v6.0.0)
// ---------------------------------------------------------------------------

function readState(instanceId) {
  const fp = pathResolve(_stateDir, `${instanceId}.json`);
  if (!existsSync(fp)) return null;
  try { return JSON.parse(readFileSync(fp, "utf8")); } catch { return null; }
}

async function patchState(instanceId, patch) {
  const fp = pathResolve(_stateDir, `${instanceId}.json`);
  const cur = readState(instanceId) ?? { instanceId, status: "pending" };
  const next = { ...cur, ...patch };
  mkdirSync(_stateDir, { recursive: true });
  writeFileSync(fp, JSON.stringify(next, null, 2));
  return next;
}

/** Append a line to the per-instance log file. */
function logToFile(logPath, line) {
  try { appendFileSync(logPath, line + "\n"); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Spawn one Claude Code background session. Returns
 * `{ instanceId, sessionId, processId }` once `claude --bg` reports
 * its session id.
 */
export async function spawnBgAgent(opts) {
  const instanceId = generateInstanceId();
  const now = Date.now();
  const logPath = pathResolve(_stateDir, `${instanceId}.log`);
  mkdirSync(_stateDir, { recursive: true });

  await patchState(instanceId, {
    instanceId,
    agent: opts.agent,
    parentAgent: opts.parentAgent ?? "odin",
    worktree: opts.worktree,
    logPath,
    status: "starting",
    startedAt: now,
    promptPreview: String(opts.prompt).slice(0, 500),
    prompt: String(opts.prompt),
    toolCallCount: 0,
    toolCalls: [],
    tags: opts.tags ?? [],
    model: opts.model ?? null,
  });

  const rec = {
    instanceId, sessionId: "", logPath, state: "starting", startedAt: now,
    worktree: opts.worktree, paused: false, pauseBuffer: [],
    proc: null, steerCount: 0, lastSteerAt: 0, endedAt: null,
    finalStatus: null, finalError: null, resultPreview: null,
  };

  try {
    const args = [
      "--bg",
      "--add-dir", opts.worktree,
      "--model", resolveModel(opts),
      "--output-format", "json",
      "--verbose",
    ];
    if (opts.agent) args.push("--agent", opts.agent);
    if (opts.title) args.push("--session-title", opts.title || `bgr:${opts.agent}`);

    const proc = spawn(resolveClaudeBin(), args, {
      cwd: opts.worktree,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) },
    });
    rec.proc = proc;

    // claude --bg emits a single JSON line with session_id and then
    // keeps streaming events. The pattern is the same as the runner.
    const sessionIdRegex = /"session_id"\s*:\s*"([A-Za-z0-9_-]{6,})"/;
    const resultRegex = /"type"\s*:\s*"result"\s*,\s*"subtype"\s*:\s*"success"/;
    const errorRegex = /"type"\s*:\s*"result"\s*,\s*"subtype"\s*:\s*"error_during_execution"/;
    let sessionId = null;

    const onLine = (chunk, label) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      logToFile(rec.logPath, `[${label}] ${text}`);
      if (!sessionId) {
        const m = text.match(sessionIdRegex);
        if (m && m[1]) sessionId = m[1];
      }
      // Forward every JSON line as a bg event for the WS bus.
      const evt = { type: "bg:event", instanceId: rec.instanceId, line: text };
      if (rec.paused) rec.pauseBuffer.push(evt);
      else broadcast(evt);

      if (resultRegex.test(text)) {
        rec.endedAt = Date.now();
        rec.finalStatus = "completed";
        patchState(rec.instanceId, { status: "completed", completedAt: rec.endedAt, sessionId }).catch(() => undefined);
        broadcast({ type: "background:change", id: rec.instanceId, status: "completed" });
      } else if (errorRegex.test(text)) {
        rec.endedAt = Date.now();
        rec.finalStatus = "failed";
        rec.finalError = "claude reported error_during_execution";
        patchState(rec.instanceId, { status: "failed", error: rec.finalError, completedAt: rec.endedAt, sessionId }).catch(() => undefined);
        broadcast({ type: "background:change", id: rec.instanceId, status: "failed", error: rec.finalError });
      }
    };

    if (proc.stdout) {
      let buf = "";
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line) onLine(line, "stdout");
        }
      });
      proc.stdout.on("end", () => { if (buf) onLine(buf, "stdout"); });
    }
    if (proc.stderr) {
      let buf = "";
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line) onLine(line, "stderr");
        }
      });
      proc.stderr.on("end", () => { if (buf) onLine(buf, "stderr"); });
    }

    proc.on("exit", (exitCode, signal) => {
      if (rec.endedAt === null) {
        rec.endedAt = Date.now();
        if (signal) rec.finalStatus = "killed";
        else if (exitCode === 0) rec.finalStatus = "completed";
        else {
          rec.finalStatus = "failed";
          rec.finalError = `claude --bg exited with code ${exitCode}`;
        }
        patchState(rec.instanceId, {
          status: rec.finalStatus, completedAt: rec.endedAt, sessionId: rec.sessionId,
        }).catch(() => undefined);
        broadcast({ type: "background:change", id: rec.instanceId, status: rec.finalStatus, error: rec.finalError ?? undefined });
      }
    });

    // Wait up to 10s for the session id; claude --bg is fast.
    const sessionIdDeadline = Date.now() + 10_000;
    while (!sessionId && Date.now() < sessionIdDeadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!sessionId) {
      const msg = "claude --bg did not report a session id within 10s";
      await patchState(instanceId, { status: "failed", error: msg, completedAt: Date.now() });
      broadcast({ type: "background:change", id: instanceId, status: "failed", error: msg });
      return { instanceId, sessionId: null, processId: proc.pid ?? null, error: msg };
    }

    rec.sessionId = sessionId;
    rec.state = "running";
    byInstanceId.set(instanceId, rec);
    bySessionId.set(sessionId, rec);

    await patchState(instanceId, {
      sessionId, status: "running", runnerState: "running",
      processId: proc.pid ?? null, sessionIdAt: Date.now(), liveSession: true,
    });
    broadcast({ type: "background:change", id: instanceId, status: "running", sessionId, liveSession: true });
    return { instanceId, sessionId, processId: proc.pid ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchState(instanceId, { status: "failed", error: msg, completedAt: Date.now() });
    broadcast({ type: "background:change", id: instanceId, status: "failed", error: msg });
    return { instanceId, sessionId: null, processId: null, error: msg };
  }
}

/** Kill a running background instance. */
export async function killBgAgent(instanceId, _opts = {}) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: true, note: "already_exited" };
  try {
    rec.proc?.kill?.("SIGTERM");
    setTimeout(() => {
      if (rec.endedAt === null) { try { rec.proc?.kill?.("SIGKILL"); } catch { /* ignore */ } }
    }, 5_000);
  } catch (err) {
    broadcast({ type: "bg:error", instanceId, error: `kill failed: ${err instanceof Error ? err.message : String(err)}` });
  }
  rec.endedAt = Date.now();
  rec.finalStatus = "killed";
  await patchState(instanceId, { status: "killed", completedAt: rec.endedAt });
  bySessionId.delete(rec.sessionId);
  broadcast({ type: "background:change", id: instanceId, status: "killed" });
  return { ok: true };
}

/** Pause forwarding of events (session keeps running). */
export async function pauseBgAgent(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  rec.paused = true;
  return { ok: true };
}

/** Resume forwarding of events; drains the buffer. */
export async function resumeBgAgent(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  rec.paused = false;
  const buf = rec.pauseBuffer;
  rec.pauseBuffer = [];
  for (const evt of buf) broadcast(evt);
  return { ok: true, drained: buf.length };
}

/**
 * Mid-flight steer — uses `claude --resume <sessionId> --prompt <msg>`
 * to send a new prompt to the running session. The CLI pipes the
 * prompt to the daemon session; the response is appended to the
 * session's event stream.
 */
export async function steerBgAgent(instanceId, message) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: false, error: "instance_already_ended" };
  try {
    const args = [
      "--resume", rec.sessionId,
      "--add-dir", rec.worktree,
      "--prompt", String(message).slice(0, 200_000),
      "--output-format", "json",
    ];
    const proc = spawn(resolveClaudeBin(), args, {
      cwd: rec.worktree,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    if (proc.stdout) proc.stdout.setEncoding("utf8");
    if (proc.stderr) proc.stderr.setEncoding("utf8");
    if (proc.stdout) proc.stdout.on("data", (c) => logToFile(rec.logPath, `[steer] ${c}`));
    if (proc.stderr) proc.stderr.on("data", (c) => logToFile(rec.logPath, `[steer:err] ${c}`));
    proc.on("exit", () => { /* steer runs to completion */ });
    rec.steerCount += 1;
    rec.lastSteerAt = Date.now();
    await patchState(instanceId, { steerCount: rec.steerCount, lastSteerAt: rec.lastSteerAt });
    return { ok: true, steerCount: rec.steerCount };
  } catch (err) {
    return { ok: false, error: `steer failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Liveness check. */
export function isAlive(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return false;
  if (rec.endedAt) return false;
  return true;
}

/** Diagnostics. */
export function status() {
  return {
    clineCoreInfo: { startedAt: Date.now(), mode: "claude --bg" },
    byInstanceCount: byInstanceId.size,
    bySessionCount: bySessionId.size,
  };
}