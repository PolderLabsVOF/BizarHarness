/**
 * src/server/bg-spawner.mjs
 *
 * v6.0.0 — Dashboard-side background agent spawner, REWRITTEN for the
 * Cline SDK (`@cline/sdk` → `ClineCore`).
 *
 * Previous version (v5.5.1) used a cline-serve child subprocess
 * (`@polderlabs/bizar-sdk` HTTP client). The Cline SDK is now
 * in-process: the dashboard creates its own `ClineCore` instance
 * and talks to it directly via function calls. No more port, no more
 * password, no more serve-info handshake.
 *
 * The dashboard's `ClineCore` is a separate process from the plugin's
 * `ClineCore` (the plugin lives inside the cline host, the dashboard
 * is its own Node process). They share the same underlying
 * `~/.config/cline/state` storage so sessions created in one are
 * visible to the other.
 *
 * What this module owns:
 *   - Instance lifecycle (create, status, list, kill, pause, resume, steer).
 *   - State file (`~/.cache/bizar/bg/<instanceId>.json`) — same shape as
 *     v5.5.0 so the dashboard's existing list view picks up new instances
 *     without any migration.
 *   - Event subscription: `clineCore.subscribe(listener, { sessionId })`
 *     yields Cline events which we forward to the WS bus.
 *
 * Public surface (kept identical to v5.5.0):
 *   - `spawnBgAgent({...})`        — create instance + ClineCore session.
 *   - `killBgAgent(instanceId, …)` — abort the session.
 *   - `pauseBgAgent(instanceId)`   — output pause.
 *   - `resumeBgAgent(instanceId)`  — resume forwarding.
 *   - `steerBgAgent(instanceId, …)`— TRUE mid-flight prompt.
 *   - `isAlive(instanceId)`        — liveness check.
 *   - `status()`                   — diagnostics.
 *   - `configureSpawner(ctx)`      — broadcast wiring.
 *
 * Note on `pauseBgAgent`:
 *   Pause is implemented as "stop forwarding events" (output pause).
 *   The session keeps running; events that arrive while paused are
 *   buffered; resume drains the buffer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { resolve as pathResolve } from "node:path";

/** Lazily-loaded Cline SDK module. */
let _clineSdk = null;
async function getClineSdk() {
  if (_clineSdk) return _clineSdk;
  try {
    _clineSdk = await import("@cline/sdk");
  } catch {
    return null;
  }
  return _clineSdk;
}

/** Lazily-created ClineCore instance. */
let _clineCore = null;
let _clineCoreInfo = null;
async function getClineCore() {
  const cline = await getClineSdk();
  if (!cline || !cline.ClineCore || typeof cline.ClineCore.create !== "function") return null;
  if (_clineCore) return _clineCore;
  _clineCore = await cline.ClineCore.create({ clientName: "bizar-dashboard" });
  _clineCoreInfo = { startedAt: Date.now() };
  return _clineCore;
}

async function getClineCoreOrThrow() {
  const c = await getClineCore();
  if (!c) {
    throw new Error(
      "cline_unavailable: @cline/sdk not installed. Run `npm install` at the repo root.",
    );
  }
  return c;
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

/** Resolve a provider/model to the ClineCore config shape. */
function resolveProviderModel(opts) {
  // opts.model is { providerID, modelID } (the old shape).
  if (opts.model && opts.model.providerID && opts.model.modelID) {
    return { providerId: opts.model.providerID, modelId: opts.model.modelID };
  }
  return { providerId: "anthropic", modelId: "claude-sonnet-4-6" };
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
 * @property {{ close: () => void } | null} sub
 * @property {number} steerCount
 * @property {number} lastSteerAt
 * @property {number|null} endedAt
 * @property {string|null} finalStatus
 * @property {string|null} finalError
 * @property {string|null} resultPreview
 */

let _broadcastFn = null;
let _stateDir = pathResolve(HOME, ".cache", "bizar", "bg");
const HOME = homedir();

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
// State file IO (unchanged shape from v5.5.0)
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

/** Write a log line to the per-instance log file. */
function logToFile(logPath, line) {
  try { appendFileSync(logPath, line + "\n"); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Spawn one ClineCore session for the bg agent. Mirrors the v5.5.0
 * contract: returns `{ instanceId, sessionId, processId: null }`
 * as soon as the session is registered, and the ClineCore session
 * runs the prompt in the background.
 */
export async function spawnBgAgent(opts) {
  const instanceId = generateInstanceId();
  const now = Date.now();
  const logPath = pathResolve(_stateDir, `${instanceId}.log`);
  mkdirSync(_stateDir, { recursive: true });

  // Initial state file
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

  const cline = await getClineCoreOrThrow();
  const { providerId, modelId } = resolveProviderModel(opts);
  const rec = {
    instanceId, sessionId: "", logPath, state: "starting", startedAt: now,
    worktree: opts.worktree, paused: false, pauseBuffer: [],
    sub: null, steerCount: 0, lastSteerAt: 0, endedAt: null,
    finalStatus: null, finalError: null, resultPreview: null,
  };

  try {
    // --- Start the ClineCore session ---
    const started = await cline.start({
      prompt: String(opts.prompt),
      config: {
        providerId, modelId,
        systemPrompt: opts.systemPrompt ?? undefined,
        cwd: opts.worktree,
        workspaceRoot: opts.worktree,
        enableTools: true,
        enableSpawnAgent: false,
        enableAgentTeams: false,
      },
      source: "bizar-dashboard-bg-spawner",
      sessionMetadata: { bizarInstanceId: instanceId, bizarAgent: opts.agent },
    });
    const sessionId = started?.sessionId;
    if (!sessionId) {
      const msg = "ClineCore.start returned no sessionId";
      await patchState(instanceId, { status: "failed", error: msg, completedAt: Date.now() });
      broadcast({ type: "background:change", id: instanceId, status: "failed", error: msg });
      return { instanceId, sessionId: null, processId: null, error: msg };
    }
    rec.sessionId = sessionId;
    rec.state = "running";
    byInstanceId.set(instanceId, rec);
    bySessionId.set(sessionId, rec);

    // --- Subscribe to the session's event stream ---
    let sub = null;
    try {
      sub = await cline.subscribe((event) => onSessionEvent(rec, event), { sessionId });
    } catch (err) {
      broadcast({ type: "bg:error", instanceId, error: `subscribe failed: ${err instanceof Error ? err.message : String(err)}` });
    }
    rec.sub = sub;

    // --- Persist sessionId into state file ---
    await patchState(instanceId, {
      sessionId, status: "running", runnerState: "running",
      processId: null, sessionIdAt: Date.now(), liveSession: true,
    });
    broadcast({ type: "background:change", id: instanceId, status: "running", sessionId, liveSession: true });
    return { instanceId, sessionId, processId: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchState(instanceId, { status: "failed", error: `ClineCore.start threw: ${msg}`, completedAt: Date.now() });
    broadcast({ type: "background:change", id: instanceId, status: "failed", error: msg });
    return { instanceId, sessionId: null, processId: null, error: msg };
  }
}

/** Handle a single ClineCore event for a session. */
function onSessionEvent(rec, event) {
  const t = event?.type;
  if (t === "content_update" || t === "text") {
    const text = String(event?.text ?? "");
    if (text) {
      const evt = { type: "bg:output", instanceId: rec.instanceId, text };
      if (rec.paused) rec.pauseBuffer.push(evt);
      else broadcast(evt);
      logToFile(rec.logPath, text);
      rec.resultPreview = (rec.resultPreview ?? "") + text;
      if (rec.resultPreview.length > 4000) rec.resultPreview = rec.resultPreview.slice(-4000);
    }
    return;
  }
  if (t === "tool_started" || t === "tool_call" || t === "tool-call") {
    const evt = { type: "bg:tool-call", instanceId: rec.instanceId, tool: event?.toolName ?? event?.tool, input: event?.input };
    if (rec.paused) rec.pauseBuffer.push(evt);
    else broadcast(evt);
    return;
  }
  if (t === "tool_finished" || t === "tool_finished" || t === "done" || t === "run_finished" || t === "run-finished") {
    rec.endedAt = Date.now();
    rec.finalStatus = "completed";
    patchState(rec.instanceId, { status: "completed", completedAt: rec.endedAt, resultPreview: rec.resultPreview ?? "" }).catch(() => undefined);
    broadcast({ type: "background:change", id: rec.instanceId, status: "completed" });
    return;
  }
  if (t === "error" || t === "run_failed" || t === "run-failed") {
    rec.endedAt = Date.now();
    rec.finalStatus = "failed";
    rec.finalError = event?.error?.message ?? event?.message ?? "unknown";
    patchState(rec.instanceId, { status: "failed", error: rec.finalError, completedAt: rec.endedAt }).catch(() => undefined);
    broadcast({ type: "background:change", id: rec.instanceId, status: "failed", error: rec.finalError });
    return;
  }
  if (t === "usage") {
    patchState(rec.instanceId, { usage: event.usage ?? event }).catch(() => undefined);
    return;
  }
  // Pass through any other events to the WS bus.
  const evt = { type: "bg:event", instanceId: rec.instanceId, event };
  if (rec.paused) rec.pauseBuffer.push(evt);
  else broadcast(evt);
}

/** Kill a running background instance. */
export async function killBgAgent(instanceId, _opts = {}) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: true, note: "already_exited" };
  try {
    const cline = await getClineCore();
    if (cline && rec.sessionId) await cline.abort(rec.sessionId, "user_killed");
  } catch (err) {
    broadcast({ type: "bg:error", instanceId, error: `abort failed: ${err instanceof Error ? err.message : String(err)}` });
  }
  rec.endedAt = Date.now();
  rec.finalStatus = "killed";
  rec.sub?.close?.();
  rec.sub = null;
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

/** TRUE mid-flight steer — uses ClineCore.send. */
export async function steerBgAgent(instanceId, message) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: false, error: "instance_already_ended" };
  try {
    const cline = await getClineCore();
    if (!cline) return { ok: false, error: "cline_unavailable" };
    await cline.send({ sessionId: rec.sessionId, prompt: String(message).slice(0, 200_000) });
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
    clineCoreInfo: _clineCoreInfo,
    byInstanceCount: byInstanceId.size,
    bySessionCount: bySessionId.size,
  };
}
