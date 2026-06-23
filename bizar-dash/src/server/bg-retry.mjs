/**
 * src/server/bg-retry.mjs
 *
 * v3.11.0 — Periodic recovery for background-agent instances stuck
 * in `dispatchPending: true` with `toolCallCount === 0`.
 *
 * Why this exists:
 *   Before v3.11.0, the task delegator's
 *   `dispatchToBackground(main, subtasks, …)` short-circuited when
 *   `pingOpencodeServe()` returned false. The bg state file was
 *   written with `dispatchPending: true` and a tmux session was
 *   never created. The only recovery path was the user manually
 *   hitting `POST /api/tasks/:id/start` (or restarting the
 *   dashboard). The user's "home folder project" got stuck this way
 *   with 7 instances in `dispatchPending: true` — 6 from a Jun 19
 *   E2E test fixture and 1 active (`bgr_738FFSKMAT5SP58SVF5HQW`,
 *   "Install vLLM as a Python package").
 *
 * What this module does:
 *   - On a 30s timer, walk every bg state file under BG_DIRS.
 *   - For any instance whose `dispatchPending === true` AND
 *     `toolCallCount === 0` AND `startedAt` is older than the
 *     30-second grace window, attempt to re-dispatch by:
 *       1. Reading serve-info (the v3.11.0 fix makes this lenient).
 *       2. POSTing `/api/session` to the opencode serve child.
 *       3. POSTing `/api/session/{id}/prompt` with the recorded
 *          prompt.
 *       4. Wrapping the agent run in a tmux session via
 *          `backgroundStore.spawnTmuxFor`.
 *   - On success, clear `dispatchPending`, persist the real
 *     `sessionId`, bump `lastActivityAt`, and write the file back
 *     atomically.
 *   - On failure, increment `retryCount`. After `MAX_DISPATCH_RETRIES`
 *     the instance is marked `status: "failed"` with
 *     `error: "exceeded max dispatch retries"` and the loop stops
 *     touching it.
 *
 * This module also exposes `retryDispatchOnce(instanceId)` for the
 * `POST /api/background/:id/retry` manual endpoint.
 *
 * Lifecycle:
 *   - `startBgRetryLoop()` is idempotent — calling it twice is a
 *     no-op.
 *   - `stopBgRetryLoop()` clears the interval. Safe to call when
 *     the loop was never started.
 *
 * Out of scope:
 *   - tmux cleanup. The retry does not destroy the existing (likely
 *     non-existent) tmux session — `spawnTmuxFor` already handles
 *     pre-existing sessions via its `note: 'session already existed'`
 *     return path.
 *   - The opencode plugin's own bg state. The retry only writes the
 *     dashboard's view of the bg instance. The plugin will pick up
 *     the new dispatch on its next `GET /api/session` poll.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { backgroundStore } from './background-store.mjs';
import {
  readServeInfo,
  pingOpencodeServe,
  createOpencodeSession,
  sendOpencodePrompt,
} from './serve-info.mjs';
import { tasksStore } from './tasks-store.mjs';
import {
  deriveAbsoluteBgLogPath,
  isBrokenBgLogPath,
} from './lib/path-safe.mjs';

const HOME = homedir();

// Mirrors background-store.mjs BG_DIRS + task-delegator.mjs BG_DIRS.
const BG_DIRS = [
  join(HOME, '.cache', 'bizar', 'bg'),
  join(HOME, '.config', 'opencode', 'bg'),
  join(HOME, '.bizar', 'bg'),
];

const RETRY_INTERVAL_MS = 30_000;
const DISPATCH_GRACE_MS = 30_000;
const MAX_DISPATCH_RETRIES = 10;

let intervalHandle = null;
let lastTickAt = 0;
let inFlightTick = false;

function pickBgDir() {
  for (const dir of BG_DIRS) {
    if (existsSync(dir)) return dir;
  }
  return BG_DIRS[0];
}

function readBgFile(file) {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function atomicWriteJson(file, payload) {
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(payload, null, 2);
  writeFileSync(tmp, text, 'utf8');
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, text, 'utf8');
  }
}

function findBgFile(instanceId) {
  for (const dir of BG_DIRS) {
    if (!existsSync(dir)) continue;
    const file = join(dir, `${instanceId}.json`);
    if (existsSync(file)) return { file, dir };
  }
  return null;
}

/**
 * Decide whether the bg instance qualifies for a retry tick.
 *
 * Filter (must satisfy all):
 *   - status is `pending` or `failed` (skip terminal `done`/`killed`)
 *   - `toolCallCount === 0` (the agent never started running)
 *   - `startedAt < (now - DISPATCH_GRACE_MS)` (give the original
 *     dispatch 30s to settle before we interfere)
 *   - `retryCount < MAX_DISPATCH_RETRIES` (we don't retry past cap)
 *   - The instance is "stuck": either `dispatchPending === true`,
 *     OR `sessionId` is missing/empty (a sentinel for "spawn never
 *     returned an opencode session"). The user's actual stuck
 *     `bgr_738FFSKMAT5SP58SVF5HQW.json` does NOT have a
 *     `dispatchPending` field — it was written by the opencode
 *     plugin itself, not by the dashboard's task-delegator, so
 *     its stuckness is encoded as `sessionId: ""` instead.
 *
 * @param {object} inst
 * @param {number} now
 * @returns {boolean}
 */
export function shouldRetryDispatch(inst, now = Date.now()) {
  if (!inst || typeof inst !== 'object') return false;
  if ((inst.toolCallCount ?? 0) !== 0) return false;
  const terminal = new Set(['done', 'killed', 'timed_out']);
  if (terminal.has(inst.status)) return false;
  if (inst.status !== 'pending' && inst.status !== 'failed') return false;
  const retryCount = inst.retryCount ?? 0;
  if (retryCount >= MAX_DISPATCH_RETRIES) return false;
  const startedAt = typeof inst.startedAt === 'number' ? inst.startedAt : 0;
  if (startedAt <= 0) return false;
  if (now - startedAt < DISPATCH_GRACE_MS) return false;
  // Stuckness detector — either the dashboard marked this as
  // dispatchPending, OR the plugin wrote an empty sessionId
  // (meaning the opencode session was never created).
  const sessionId = inst.sessionId;
  const emptySession = sessionId === null || sessionId === undefined || sessionId === '';
  if (inst.dispatchPending !== true && !emptySession) return false;
  return true;
}

/**
 * Repair a bg instance's `logPath` if it is missing or broken
 * (empty / not absolute / contains `//`). The plugin writes the
 * logPath as `${worktree}/.opencode/log/<id>.log` — when worktree
 * was missing, the resulting path becomes `//.opencode/log/<id>.log`
 * and is unusable. We rebuild from a sane source: serve.json's
 * `worktree` first, then the instance's existing worktree field,
 * then `~/.cache/bizar/logs` as the last-resort fallback.
 *
 * @param {object} inst
 * @returns {{ repaired: boolean, logPath: string }}
 */
function repairLogPath(inst) {
  const current = inst.logPath;
  if (!isBrokenBgLogPath(current)) {
    return { repaired: false, logPath: typeof current === 'string' ? current : '' };
  }
  let worktree = '';
  try {
    const serve = readServeInfo();
    if (serve && typeof serve.worktree === 'string' && serve.worktree.length > 0) {
      worktree = serve.worktree;
    }
  } catch {
    /* ignore */
  }
  if (!worktree && typeof inst.worktree === 'string') {
    worktree = inst.worktree;
  }
  const fixed = deriveAbsoluteBgLogPath(worktree, inst.instanceId || '');
  return { repaired: true, logPath: fixed };
}

/**
 * Re-run the dispatch path for a single bg instance. Mirrors the
 * happy-path of `task-delegator.dispatchToBackground` but operates
 * on a state file instead of a fresh subtask.
 *
 * Returns a structured result so callers (the periodic loop, the
 * manual-retry endpoint) can render a useful message.
 *
 * @param {string} instanceId
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   retryCount?: number,
 *   sessionId?: string,
 *   logPath?: string,
 * }>}
 */
export async function retryDispatchOnce(instanceId) {
  const found = findBgFile(instanceId);
  if (!found) {
    return { ok: false, reason: 'instance_not_found' };
  }
  const inst = readBgFile(found.file);
  if (!inst) {
    return { ok: false, reason: 'corrupt_state_file' };
  }

  const retryCount = (inst.retryCount ?? 0) + 1;
  if (retryCount > MAX_DISPATCH_RETRIES) {
    const failed = {
      ...inst,
      status: 'failed',
      dispatchPending: false,
      error: 'exceeded max dispatch retries',
      retryCount,
      lastActivityAt: Date.now(),
    };
    atomicWriteJson(found.file, failed);
    return { ok: false, reason: 'max_retries_exceeded', retryCount };
  }

  // v3.11.0 — Repair a broken logPath so the new run can write logs.
  const { repaired, logPath } = repairLogPath(inst);

  // v3.11.0 — Resolve serve-info. The relaxed schema means a partial
  // `{password, pid, port}` file is now usable: we derive baseUrl
  // from the port and treat missing worktree as empty.
  const serveInfo = readServeInfo();
  if (!serveInfo) {
    // Serve not running yet — bump retryCount but leave dispatchPending.
    const updated = {
      ...inst,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      ...(repaired ? { logPath } : {}),
      retryError: 'serve-info unavailable',
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'serve_unavailable', retryCount };
  }

  const reachable = await pingOpencodeServe(serveInfo);
  if (!reachable) {
    const updated = {
      ...inst,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      ...(repaired ? { logPath } : {}),
      retryError: 'serve_unreachable',
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'serve_unreachable', retryCount };
  }

  // Attempt the actual session creation + prompt.
  let createRes;
  let sendRes;
  try {
    createRes = await createOpencodeSession(
      serveInfo,
      {
        title: inst.promptPreview || `bg: ${instanceId}`,
        agent: inst.agent || 'tyr',
        parentID: undefined,
      },
      serveInfo.worktree || inst.worktree || '',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = {
      ...inst,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      ...(repaired ? { logPath } : {}),
      retryError: `createSession threw: ${message}`,
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'create_threw', retryCount };
  }

  if (!createRes.ok) {
    const updated = {
      ...inst,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      ...(repaired ? { logPath } : {}),
      retryError: createRes.error || 'createSession failed',
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'create_failed', retryCount };
  }

  const sessionId = createRes.sessionId;
  try {
    const promptText = buildReplayPromptText(inst);
    sendRes = await sendOpencodePrompt(
      serveInfo,
      {
        sessionId,
        agent: inst.agent || 'tyr',
        text: promptText,
      },
      serveInfo.worktree || inst.worktree || '',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Session was created but prompt failed. Mark the instance as
    // running-with-sessionId so the operator can interact with it via
    // opencode directly; the next retry tick will re-issue the prompt
    // only if toolCallCount stays at 0.
    const updated = {
      ...inst,
      sessionId,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'running',
      dispatchPending: false,
      ...(repaired ? { logPath } : {}),
      retryError: `sendPrompt threw: ${message}`,
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'send_threw', retryCount, sessionId };
  }

  if (!sendRes.ok) {
    const updated = {
      ...inst,
      sessionId,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'running',
      dispatchPending: false,
      ...(repaired ? { logPath } : {}),
      retryError: sendRes.error || 'sendPrompt failed',
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'send_failed', retryCount, sessionId };
  }

  // Success path. Re-write the instance as `running`, clear
  // dispatchPending, refresh activity timestamps, and wrap the agent
  // run in a tmux session (best-effort, matches `task-delegator`).
  const updated = {
    ...inst,
    sessionId,
    status: 'running',
    dispatchPending: false,
    retryCount,
    lastRetryAt: Date.now(),
    lastActivityAt: Date.now(),
    ...(repaired ? { logPath } : {}),
    retryError: null,
  };
  atomicWriteJson(found.file, updated);

  try {
    const tmuxName = `bg_${(sessionId || instanceId).slice(0, 16)}`;
    const logFile = logPath;
    backgroundStore.spawnTmuxFor(
      tmuxName,
      { command: 'tail', args: ['-n', '200', '-F', logFile] },
      serveInfo.worktree || inst.worktree || undefined,
    );
  } catch {
    /* best-effort */
  }

  // Also flip the linked task back to `doing` so the UI un-sticks.
  try {
    if (inst.taskId) {
      await tasksStore.update(null, inst.taskId, {
        status: 'doing',
        metadata: {
          ...(typeof inst.mainTaskId === 'string' ? {} : {}),
          progress: 5,
          currentStep: `Re-dispatched (${sessionId})`,
          dispatchedAt: Date.now(),
        },
      });
    }
  } catch {
    /* best-effort */
  }

  return { ok: true, sessionId, retryCount, logPath: repaired ? logPath : undefined };
}

/**
 * Reconstruct the prompt text for the retry from what the bg file
 * stored. The original `task-delegator.dispatchToBackground` builds
 * a multi-line prompt (`# Title`, body, `---`, IDs); we approximate
 * that here using the promptPreview + instanceId context. If the
 * upstream caller stored the full prompt in `metadata.promptText`,
 * use that; otherwise fall back to the preview.
 *
 * @param {object} inst
 * @returns {string}
 */
function buildReplayPromptText(inst) {
  const full = inst?.metadata?.promptText;
  if (typeof full === 'string' && full.trim().length > 0) return full;
  const preview = typeof inst.promptPreview === 'string' ? inst.promptPreview : '';
  const parts = [];
  parts.push(`# ${preview || `Background task ${inst.instanceId}`}`);
  parts.push('');
  parts.push('(Re-dispatched by the bg-retry loop — full prompt was not');
  parts.push('persisted. The dashboard recovered this instance after the');
  parts.push('plugin was reachable. The original prompt preview is above;');
  parts.push('if more context is required, inspect the linked task.)');
  parts.push('');
  parts.push('---');
  parts.push(`Subtask ID: ${inst.taskId || '(unknown)'}`);
  parts.push(`Assigned agent: ${inst.agent || 'tyr'}`);
  parts.push(`Parent task ID: ${inst.mainTaskId || '(none)'}`);
  parts.push(`Instance ID: ${inst.instanceId}`);
  return parts.join('\n');
}

/**
 * One pass of the retry loop. Walks every bg state file, identifies
 * candidates via `shouldRetryDispatch`, and calls `retryDispatchOnce`
 * for each. Failures are caught so a single broken file cannot
 * poison the rest of the pass.
 *
 * @returns {Promise<{ scanned: number, retried: number, succeeded: number, failed: number, skipped: number }>}
 */
export async function tickRetryLoop() {
  if (inFlightTick) {
    return { scanned: 0, retried: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  inFlightTick = true;
  const summary = { scanned: 0, retried: 0, succeeded: 0, failed: 0, skipped: 0 };
  try {
    const now = Date.now();
    for (const dir of BG_DIRS) {
      if (!existsSync(dir)) continue;
      let files;
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      for (const f of files) {
        summary.scanned += 1;
        const file = join(dir, f);
        const inst = readBgFile(file);
        if (!inst) {
          summary.skipped += 1;
          continue;
        }
        if (!shouldRetryDispatch(inst, now)) {
          summary.skipped += 1;
          continue;
        }
        summary.retried += 1;
        let result;
        try {
          result = await retryDispatchOnce(inst.instanceId || f.replace(/\.json$/, ''));
        } catch (err) {
          summary.failed += 1;
          // eslint-disable-next-line no-console
          console.warn(
            `[bg-retry] retry for ${inst.instanceId || f} threw: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        if (result.ok) {
          summary.succeeded += 1;
          // eslint-disable-next-line no-console
          console.log(
            `[bg-retry] recovered ${inst.instanceId} → sessionId=${result.sessionId}` +
              (result.logPath ? ` (repaired logPath)` : ''),
          );
        } else {
          summary.failed += 1;
          // eslint-disable-next-line no-console
          console.log(
            `[bg-retry] ${inst.instanceId} retry #${result.retryCount ?? '?'} failed: ${result.reason}`,
          );
        }
      }
    }
    return summary;
  } finally {
    inFlightTick = false;
    lastTickAt = Date.now();
  }
}

/**
 * Start the periodic retry loop. Idempotent.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]  override the default 30s tick
 */
export function startBgRetryLoop({ intervalMs } = {}) {
  if (intervalHandle) return { ok: true, alreadyRunning: true };
  const ms = typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : RETRY_INTERVAL_MS;
  intervalHandle = setInterval(() => {
    tickRetryLoop().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[bg-retry] tick threw: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, ms);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
  // Kick off a first tick on the next event-loop turn so the
  // dashboard recovers any pre-existing stuck instances immediately
  // after a restart, without waiting 30s.
  setImmediate(() => {
    tickRetryLoop().catch(() => { /* logged inside */ });
  });
  // eslint-disable-next-line no-console
  console.log(`[bg-retry] started (interval=${ms}ms, maxRetries=${MAX_DISPATCH_RETRIES})`);
  return { ok: true, alreadyRunning: false, intervalMs: ms };
}

/**
 * Stop the periodic retry loop. Safe to call when never started.
 */
export function stopBgRetryLoop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export const _BG_RETRY_INTERNAL = {
  BG_DIRS,
  RETRY_INTERVAL_MS,
  DISPATCH_GRACE_MS,
  MAX_DISPATCH_RETRIES,
};

// Silence unused-import warnings for helpers used transitively.
void mkdirSync;