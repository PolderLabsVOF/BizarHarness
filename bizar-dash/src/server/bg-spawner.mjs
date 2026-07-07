/**
 * src/server/bg-spawner.mjs
 *
 * v5.5.1 — Dashboard-side background agent spawner, rewired to use the
 * cline SDK (sessions + promptAsync) instead of `cline run` subprocesses.
 *
 * Background agents run as long-lived cline-serve SDK sessions, which:
 *   - Accept mid-flight prompts (the "true mid-flight steer" promised in
 *     v0.9.x / v5.5.0).
 *   - Don't need an OS subprocess per agent (we used to fork one
 *     `cline run` per agent).
 *   - Are portable across POSIX and Windows (no signals).
 *
 * What this module owns:
 *   - Instance lifecycle (create, status, list, kill, pause, resume, steer).
 *   - State file (`~/.cache/bizar/bg/<instanceId>.json`) — same shape as
 *     v5.5.0 so the dashboard's existing list view picks up new instances
 *     without any migration. `processId` is left `null`; the schema field
 *     stays (backwards compat) but is no longer the source of truth for
 *     liveness — we use `liveSession === true` to mark "this instance is
 *     backed by a live cline session".
 *   - Event subscription: `sdk.events.subscribe({ sessionID })` yields
 *     cline SSE envelopes which we forward to the WS bus as
 *     `bg:output` / `background:change` / `bg:tool-call` events.
 *
 * Public surface (kept identical to v5.5.0):
 *   - `spawnBgAgent({...})`        — create instance + SDK session.
 *   - `killBgAgent(instanceId, …)` — abort the session.
 *   - `pauseBgAgent(instanceId)`   — output pause (see note below).
 *   - `resumeBgAgent(instanceId)`  — resume forwarding.
 *   - `steerBgAgent(instanceId, …)`— TRUE mid-flight prompt (no kill+respawn).
 *   - `isAlive(instanceId)`        — liveness check.
 *   - `status()`                   — diagnostics.
 *   - `configureSpawner(ctx)`      — broadcast wiring.
 *
 * Note on `pauseBgAgent`:
 *   In subprocess mode, pause sent SIGSTOP to the underlying OS process.
 *   The cline serve child doesn't expose an HTTP pause — there's no
 *   documented "freeze the agent loop" endpoint. We therefore implement
 *   pause as "stop forwarding events to the dashboard" (output pause).
 *   The session keeps running; events that arrive while paused are
 *   buffered; resume drains the buffer. This matches the user's mental
 *   model ("pause the live output") and is cross-platform.
 *
 * Backwards compatibility (v5.5.0 → v5.5.1):
 *   - State-file shape unchanged: `processId` stays in the schema (now
 *     always `null`) so a v5.5.0 instance file can still be read.
 *   - REST surface unchanged: `POST /api/background`, `POST .../steer`,
 *     `POST .../pause`, `POST .../resume`, `DELETE /api/background/:id`
 *     all keep their contract.
 *   - `steerBgAgent` semantics change from "kill+respawn with [STEERED
 *     <ts>] marker" to "true mid-flight prompt"; the response shape stays
 *     `{ ok, newInstanceId? }` but `newInstanceId` is no longer returned
 *     (the same instance is reused).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { resolve as pathResolve } from "node:path";

import { getClineSdkOrThrow } from "./cline-sdk.mjs";

/** Same shape the plugin uses for instance IDs. */
function generateInstanceId() {
  const bytes = randomBytes(16);
  // crockford base32: 26 chars total, take 22
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

// --- Configuration -------------------------------------------------------

const HOME = homedir();
const BG_DIR_CANDIDATES = [
  pathResolve(HOME, ".cache", "bizar", "bg"),
  pathResolve(HOME, ".config", "cline", "bg"),
  pathResolve(HOME, ".bizar", "bg"),
];
const LOG_DIR_CANDIDATES = [
  process.env.BIZAR_LOG_DIR || pathResolve(HOME, ".cache", "bizar", "logs"),
];

function pickBgDir() {
  for (const dir of BG_DIR_CANDIDATES) {
    if (existsSync(dir)) return dir;
  }
  return BG_DIR_CANDIDATES[0];
}

function pickLogDir() {
  for (const dir of LOG_DIR_CANDIDATES) {
    if (existsSync(dir)) return dir;
  }
  const def = LOG_DIR_CANDIDATES[0];
  try {
    mkdirSync(def, { recursive: true });
  } catch {
    /* ignore */
  }
  return def;
}

// --- In-memory session registry ------------------------------------------

/**
 * @typedef {object} SpawnerRecord
 * @property {string} instanceId
 * @property {string} sessionId
 * @property {string} logPath
 * @property {string} state — "starting" | "running" | "paused" | "done" | "failed" | "killed"
 * @property {number} startedAt
 * @property {number} [endedAt]
 * @property {string} [worktree]
 * @property {boolean} paused            — v5.5.1 output-pause flag
 * @property {Array<object>} pauseBuffer — events buffered while paused
 * @property {{ close: () => void, stream?: AsyncIterable<unknown> } | null} sub  — SDK event sub
 * @property {number} steerCount          — number of mid-flight prompts sent
 * @property {number} lastSteerAt         — epoch ms of the last steer
 */

/** @type {Map<string, SpawnerRecord>} — keyed by instanceId */
const byInstanceId = new Map();
/** @type {Map<string, SpawnerRecord>} — keyed by sessionId (for fast lookup from event handler) */
const bySessionId = new Map();

// --- Public API ---------------------------------------------------------

/**
 * @typedef {object} BroadcastFn
 * @property {(msg: object) => void} [broadcast]
 */

/**
 * @param {BroadcastFn} ctx
 */
export function configureSpawner(ctx) {
  state.broadcast = ctx.broadcast || (() => {});
}

/**
 * Spawn one cline serve SDK session for the bg agent. Mirrors the
 * v5.5.0 plugin-side `bg-spawn.ts` semantics on the input/output side:
 *
 *   - Generates an instanceId.
 *   - Writes the initial state file (same shape as v5.5.0 — the
 *     `processId` field stays in the schema but is always `null` now).
 *   - Creates an SDK session via `sdk.sessions.create({ title })`.
 *   - Fires the prompt via `sdk.sessions.promptAsync({ sessionId, body })`.
 *   - Subscribes to `sdk.events.subscribe({ sessionID })` to forward
 *     SSE events to the dashboard's WS bus.
 *
 * The function returns as soon as the sessionId is known (sub-second),
 * matching the v5.5.0 "return instanceId immediately" contract.
 *
 * @param {object} opts
 * @param {string} opts.agent
 * @param {string} opts.prompt
 * @param {{providerID: string, modelID: string}} [opts.model]
 * @param {string} opts.worktree
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.persistent]
 * @param {number} [opts.maxRestarts]
 * @param {string[]} [opts.tags]
 * @returns {Promise<{instanceId: string, sessionId: string|null, processId: number|null, error?: string}>}
 */
export async function spawnBgAgent(opts) {
  if (!opts || !opts.agent || !opts.prompt || !opts.worktree) {
    return { instanceId: "", sessionId: null, processId: null, error: "missing_required_fields" };
  }

  // Resolve the SDK early so a missing serve fails fast with a clear error.
  let sdk;
  try {
    sdk = await getClineSdkOrThrow();
  } catch (err) {
    return {
      instanceId: "",
      sessionId: null,
      processId: null,
      error: `cline_serve_unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const instanceId = generateInstanceId();
  const logDir = pickLogDir();
  const logPath = pathResolve(logDir, `${instanceId}.log`);
  const now = Date.now();

  // Initial state — same shape as v5.5.0 (processId stays for compat).
  /** @type {any} */
  const initial = {
    instanceId,
    sessionId: "",
    agent: opts.agent,
    model: opts.model
      ? `${opts.model.providerID}/${opts.model.modelID}`
      : "agent-default",
    promptPreview: String(opts.prompt).slice(0, 200),
    prompt: String(opts.prompt),
    parentAgent: "dashboard",
    logPath,
    timeoutMs: Math.max(1000, Math.floor(opts.timeoutMs ?? 300_000)),
    toolCallCount: 0,
    status: "pending",
    startedAt: now,
    lastEventAt: now,
    lastToolOrTextAt: now,
    interventionCount: 0,
    persistent: Boolean(opts.persistent),
    maxRestarts: Math.max(1, Math.floor(opts.maxRestarts ?? 3)),
    restartCount: 0,
    runnerState: "starting",
    spawnedAt: now,
    progress: 0,
    toolCalls: [],
    tags: Array.isArray(opts.tags) ? opts.tags.slice(0, 10) : undefined,
    source: "dashboard",
    // v5.5.1 — explicit flag so the state file carries the "this is a
    // live cline session, not a subprocess" marker. Dashboard
    // reconciliation reads this to decide whether to call SDK abort
    // vs the legacy `proc.kill` path.
    liveSession: true,
  };

  await writeStateFile(initial);
  broadcast({ type: "background:change", id: instanceId, status: "pending", source: "dashboard" });

  // --- Create the SDK session ---
  /** @type {SpawnerRecord} */
  const rec = {
    instanceId,
    sessionId: "",
    logPath,
    state: "starting",
    startedAt: now,
    worktree: opts.worktree,
    paused: false,
    pauseBuffer: [],
    sub: null,
    steerCount: 0,
    lastSteerAt: 0,
  };

  try {
    const created = await sdk.sessions.create({
      title: `bgr:${opts.agent}:${instanceId}`,
      agent: opts.agent,
      ...(opts.model ? { model: opts.model } : {}),
    });
    const sessionId = created?.id || "";
    if (!sessionId) {
      const msg = "cline sessions.create returned no id";
      await patchState(instanceId, {
        status: "failed",
        error: msg,
        completedAt: Date.now(),
      });
      broadcast({ type: "background:change", id: instanceId, status: "failed", error: msg });
      return { instanceId, sessionId: null, processId: null, error: msg };
    }
    rec.sessionId = sessionId;
    rec.state = "running";
    byInstanceId.set(instanceId, rec);
    bySessionId.set(sessionId, rec);

    // --- Send the prompt asynchronously (fire-and-forget) ---
    // `promptAsync` returns `null` (202-style): the prompt is queued on
    // the server and processed in the background. We don't block the
    // spawn on it.
    await sdk.sessions
      .promptAsync({ sessionId, body: { text: String(opts.prompt) } })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast({ type: "bg:error", instanceId, error: `promptAsync failed: ${msg}` });
      });

    // --- Subscribe to the session's event stream ---
    let sub = null;
    try {
      sub = await sdk.events.subscribe({ sessionID: sessionId });
    } catch (err) {
      // Non-fatal: events won't be forwarded but the session still runs.
      broadcast({
        type: "bg:error",
        instanceId,
        error: `events.subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    rec.sub = sub;

    if (sub && sub.stream) {
      void forwardEvents(rec, sub.stream);
    }

    // --- Persist sessionId into state file ---
    await patchState(instanceId, {
      sessionId,
      status: "running",
      runnerState: "running",
      // processId stays null — the schema field is preserved for compat
      // but is no longer the source of truth for liveness.
      processId: null,
      sessionIdAt: Date.now(),
      liveSession: true,
    });
    broadcast({
      type: "background:change",
      id: instanceId,
      status: "running",
      sessionId,
      liveSession: true,
    });

    return { instanceId, sessionId, processId: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchState(instanceId, {
      status: "failed",
      error: `sdk.sessions.create threw: ${msg}`,
      completedAt: Date.now(),
    });
    broadcast({ type: "background:change", id: instanceId, status: "failed", error: msg });
    return { instanceId, sessionId: null, processId: null, error: msg };
  }
}

/**
 * Forward SDK SSE events to the dashboard's WS bus. Resolves when the
 * subscription ends (the session terminated or the SSE connection died).
 *
 * Translates cline event types to dashboard shapes:
 *   - `session.idle`   → `background:change { status: 'done' }`
 *   - `session.error`  → `background:change { status: 'failed' }`
 *   - `message.part.updated` (text/tool) → `bg:output` + tool-call bookkeeping
 *
 * @param {SpawnerRecord} rec
 * @param {AsyncIterable<any>} stream
 */
async function forwardEvents(rec, stream) {
  try {
    for await (const ev of stream) {
      if (!ev || typeof ev !== "object") continue;

      // Output-pause: buffer events instead of forwarding, so the
      // dashboard doesn't show live updates while paused.
      if (rec.paused) {
        try {
          rec.pauseBuffer.push(ev);
          // Cap the buffer so a long pause doesn't grow unbounded.
          if (rec.pauseBuffer.length > 1000) rec.pauseBuffer.shift();
        } catch {
          /* ignore */
        }
        continue;
      }

      const type = typeof ev.type === "string" ? ev.type : null;
      if (!type) continue;

      // Append a compact line to the log file for tail/inspection.
      try {
        appendFileSync(
          rec.logPath,
          `[sdk-event] type=${type} ts=${Date.now()}\n`,
        );
      } catch {
        /* ignore */
      }

      // Tool / text parts: forward as `bg:output` + bump counters.
      if (type === "message.part.updated") {
        const part = ev.part || ev.data?.part;
        const partText =
          part?.text ||
          (part?.type === "tool" ? `[tool ${part?.tool || part?.name || ""}]` : "");
        if (partText) {
          broadcast({
            type: "bg:output",
            instanceId: rec.instanceId,
            line: typeof partText === "string" ? partText : JSON.stringify(partText),
            ts: Date.now(),
            stream: "sse",
          });
        }
        if (part?.type === "tool") {
          const tc = {
            id: ev.partID || ev.messageID || `tc_${Date.now().toString(36)}`,
            name: String(part.tool || part.name || "tool"),
            status: part.state || "running",
            startedAt: Date.now(),
          };
          // Best-effort persist: read-modify-write the toolCalls array.
          try {
            const st = readStateFile(rec.instanceId);
            if (st) {
              const list = Array.isArray(st.toolCalls) ? st.toolCalls.slice() : [];
              list.push(tc);
              if (list.length > 100) list.shift();
              await patchState(rec.instanceId, { toolCalls: list, toolCallCount: list.length });
            }
          } catch {
            /* ignore */
          }
          broadcast({
            type: "bg:tool-call",
            instanceId: rec.instanceId,
            toolCall: tc,
          });
        }
        // Heartbeat for the stall checker / output-pause ticker.
        await patchState(rec.instanceId, {
          lastEventAt: Date.now(),
          ...(part?.type === "tool" || part?.type === "text"
            ? { lastToolOrTextAt: Date.now() }
            : {}),
        });
        continue;
      }

      // Session-terminal events: flip state to the appropriate terminal.
      if (type === "session.idle" || type === "session.idle.0") {
        rec.state = "done";
        rec.endedAt = Date.now();
        await patchState(rec.instanceId, {
          status: "done",
          runnerState: "done",
          completedAt: rec.endedAt,
        });
        broadcast({
          type: "background:change",
          id: rec.instanceId,
          status: "done",
        });
        break;
      }
      if (type === "session.error" || type === "session.error.0") {
        rec.state = "failed";
        rec.endedAt = Date.now();
        const errMsg = String(ev.error || ev.data?.error || "session error");
        await patchState(rec.instanceId, {
          status: "failed",
          runnerState: "failed",
          error: errMsg,
          completedAt: rec.endedAt,
        });
        broadcast({
          type: "background:change",
          id: rec.instanceId,
          status: "failed",
          error: errMsg,
        });
        break;
      }

      // Anything else: forward as a generic bg:output so the dashboard
      // log captures it.
      broadcast({
        type: "bg:output",
        instanceId: rec.instanceId,
        line: `[event] ${type}`,
        ts: Date.now(),
        stream: "sse",
      });
    }
  } catch (err) {
    broadcast({
      type: "bg:error",
      instanceId: rec.instanceId,
      error: `event stream ended: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    // Clean up so a re-adopt / restart can re-subscribe cleanly.
    bySessionId.delete(rec.sessionId);
  }
}

/**
 * Kill an instance's cline session. Aborts the SDK session; best-effort.
 * @param {string} instanceId
 * @param {{signal?: 'SIGTERM' | 'SIGKILL', reason?: string}} [_opts]  — `signal` accepted for compat but ignored (sessions are aborted via SDK)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function killBgAgent(instanceId, _opts = {}) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: true, note: "already_exited" };

  try {
    const sdk = await getClineSdkOrThrow();
    await sdk.sessions.abort({ sessionId: rec.sessionId });
  } catch (err) {
    // Best-effort: even if abort fails, mark the state so the UI
    // reflects the intent.
    broadcast({
      type: "bg:error",
      instanceId,
      error: `abort failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Close the event subscription so we stop forwarding events.
  try {
    rec.sub?.close?.();
  } catch {
    /* ignore */
  }
  rec.sub = null;

  rec.state = "killed";
  rec.endedAt = Date.now();
  await patchState(instanceId, {
    status: "killed",
    runnerState: "killed",
    completedAt: rec.endedAt,
  });
  broadcast({ type: "background:change", id: instanceId, status: "killed" });
  return { ok: true };
}

/**
 * Pause an instance's event forwarding. In v5.5.1 (SDK-based) we can't
 * freeze the underlying cline agent loop without a documented pause
 * endpoint; pause is therefore an OUTPUT pause — events that arrive
 * while paused are buffered; resume drains them.
 *
 * Idempotent against already-paused / already-exited instances.
 *
 * @param {string} instanceId
 * @returns {{ ok: boolean, error?: string }}
 */
export function pauseBgAgent(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: true, note: "already_exited" };
  if (rec.paused) return { ok: true };
  rec.paused = true;
  patchState(instanceId, { status: "paused", pausedAt: Date.now() })
    .then(() => {
      broadcast({ type: "background:change", id: instanceId, status: "paused" });
    })
    .catch(() => {
      /* ignore */
    });
  return { ok: true };
}

/**
 * Resume an instance: drain the buffered events to the WS bus, then
 * resume live forwarding.
 *
 * Idempotent.
 *
 * @param {string} instanceId
 * @returns {{ ok: boolean, error?: string }}
 */
export function resumeBgAgent(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_tracked" };
  if (rec.endedAt) return { ok: true, note: "already_exited" };
  if (!rec.paused) return { ok: true };
  rec.paused = false;

  // Drain the buffer (best-effort; if a flush helper above changes,
  // this is the only place we need to update).
  const buffered = rec.pauseBuffer;
  rec.pauseBuffer = [];
  for (const ev of buffered) {
    try {
      const type = ev?.type;
      const part = ev?.part || ev?.data?.part;
      const partText =
        part?.text ||
        (part?.type === "tool" ? `[tool ${part?.tool || part?.name || ""}]` : "");
      if (type === "message.part.updated" && partText) {
        broadcast({
          type: "bg:output",
          instanceId,
          line: typeof partText === "string" ? partText : JSON.stringify(partText),
          ts: Date.now(),
          stream: "sse-buffered",
        });
      } else if (typeof type === "string") {
        broadcast({
          type: "bg:output",
          instanceId,
          line: `[event] ${type}`,
          ts: Date.now(),
          stream: "sse-buffered",
        });
      }
    } catch {
      /* ignore */
    }
  }
  patchState(instanceId, { status: "running", pausedAt: undefined })
    .then(() => {
      broadcast({ type: "background:change", id: instanceId, status: "running" });
    })
    .catch(() => {
      /* ignore */
    });
  return { ok: true };
}

/**
 * v5.5.1 — TRUE mid-flight steer. Sends a follow-up prompt to the
 * running cline session via the SDK. NO kill+respawn; the same
 * instanceId and sessionId are reused.
 *
 * Returns `{ ok: true, instanceId, mode: 'true_midflight' }`.
 *
 * @param {string} instanceId
 * @param {string} message
 * @returns {Promise<{ ok: boolean, instanceId?: string, mode?: string, error?: string }>}
 */
export async function steerBgAgent(instanceId, message) {
  if (!message || !message.trim()) {
    return { ok: false, error: "message_empty" };
  }
  const rec = byInstanceId.get(instanceId);
  if (!rec) return { ok: false, error: "instance_not_found" };
  if (rec.endedAt) return { ok: false, error: "instance_already_terminated" };

  let sdk;
  try {
    sdk = await getClineSdkOrThrow();
  } catch (err) {
    return {
      ok: false,
      error: `cline_serve_unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    // Synchronous prompt: blocks until the server accepts the message.
    // Use promptAsync if we want fire-and-forget; the v5.5.0 spec kept
    // this as the synchronous form so the dashboard can surface a clear
    // error if the SDK rejects the message.
    await sdk.sessions.prompt({
      sessionId: rec.sessionId,
      body: { text: String(message).slice(0, 200_000) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `prompt failed: ${msg}` };
  }

  rec.steerCount += 1;
  rec.lastSteerAt = Date.now();
  await patchState(instanceId, {
    steerCount: rec.steerCount,
    lastSteerAt: rec.lastSteerAt,
    interventionCount: rec.steerCount, // dashboard UI treats intervention count and steer count together
    lastEventAt: Date.now(),
  });
  broadcast({
    type: "background:change",
    id: instanceId,
    status: "running",
    action: "steer",
    steerCount: rec.steerCount,
  });
  broadcast({
    type: "bg:output",
    instanceId,
    line: `[steer #${rec.steerCount}] ${String(message).slice(0, 500)}`,
    ts: Date.now(),
    stream: "steer",
  });
  return { ok: true, instanceId, mode: "true_midflight", steerCount: rec.steerCount };
}

/**
 * Liveness probe. With SDK sessions we can probe the server directly.
 *
 * @param {string} instanceId
 * @returns {boolean}
 */
export function isAlive(instanceId) {
  const rec = byInstanceId.get(instanceId);
  if (!rec) return false;
  return !rec.endedAt;
}

/** Diagnostics. */
export function status() {
  return {
    count: byInstanceId.size,
    ids: Array.from(byInstanceId.keys()),
  };
}

// --- Internal helpers ----------------------------------------------------

const state = {
  /** @type {(msg: object) => void} */
  broadcast: () => {},
};

/**
 * @param {object} msg
 */
function broadcast(msg) {
  try {
    state.broadcast(msg);
  } catch {
    /* ignore */
  }
}

function bgDir() {
  return pickBgDir();
}

function stateFile(instanceId) {
  return pathResolve(bgDir(), `${instanceId}.json`);
}

/**
 * Atomic-ish write: write to <file>.tmp then rename.
 * @param {object} bgState
 */
async function writeStateFile(bgState) {
  const dir = bgDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = stateFile(bgState.instanceId);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(bgState, null, 2), "utf-8");
  try {
    const fs = await import("node:fs");
    fs.renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(bgState, null, 2), "utf-8");
  }
}

/**
 * Read+modify+write the state file. Best-effort; logs on failure.
 * @param {string} instanceId
 * @param {object} patch
 */
async function patchState(instanceId, patch) {
  const file = stateFile(instanceId);
  if (!existsSync(file)) return;
  try {
    const cur = JSON.parse(readFileSync(file, "utf-8") || "{}");
    const next = { ...cur, ...patch };
    writeFileSync(file, JSON.stringify(next, null, 2), "utf-8");
  } catch (err) {
    broadcast({ type: "bg:error", instanceId, error: `state_patch failed: ${err.message}` });
  }
}

/**
 * @param {string} instanceId
 * @returns {object|null}
 */
function readStateFile(instanceId) {
  const file = stateFile(instanceId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** For tests: clear the in-memory registry. Does NOT close SDK sessions. */
export function _resetForTests() {
  for (const rec of byInstanceId.values()) {
    try {
      rec.sub?.close?.();
    } catch {
      /* ignore */
    }
  }
  byInstanceId.clear();
  bySessionId.clear();
}