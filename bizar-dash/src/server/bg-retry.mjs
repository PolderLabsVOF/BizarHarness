/**
 * src/server/bg-retry.mjs
 *
 * v6.3.0 — Periodic recovery for background-agent instances stuck
 * in `dispatchPending: true` with `toolCallCount === 0`.
 *
 * Why this exists:
 *   Before v6.3.0, the task delegator's `dispatchToBackground` would
 *   short-circuit when `pingClaudeSdk()` returned false and the
 *   `claude` binary wasn't on PATH. The bg state file was written
 *   with `dispatchPending: true` and the actual spawn never happened.
 *   The only recovery path was the user manually hitting
 *   `POST /api/tasks/:id/start` (or restarting the dashboard).
 *
 * What this module does:
 *   - On a 30s timer, walk every bg state file under BG_DIRS.
 *   - For any instance whose `dispatchPending === true` AND
 *     `toolCallCount === 0` AND `startedAt` is older than the
 *     30-second grace window, attempt to re-dispatch by spawning
 *     `claude -p "<prompt>"` via `claude-runner.mjs`.
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
import { tasksStore } from './tasks-store.mjs';
import {
  deriveAbsoluteBgLogPath,
  isBrokenBgLogPath,
  getActualBgLogPath,
} from './lib/path-safe.mjs';
import { spawnAgent } from './claude-runner.mjs';

const HOME = homedir();

// Mirrors background-store.mjs BG_DIRS + task-delegator.mjs BG_DIRS.
const BG_DIRS = [
  join(HOME, '.cache', 'bizar', 'bg'),
  join(HOME, '.config', 'cline', 'bg'),
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
 *     returned a Claude Code session").
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
  const sessionId = inst.sessionId;
  const emptySession = sessionId === null || sessionId === undefined || sessionId === '';
  if (inst.dispatchPending !== true && !emptySession) return false;
  return true;
}

/**
 * Repair a bg instance's `logPath` if it is missing or broken.
 */
function repairLogPath(inst) {
  const current = inst.logPath;
  if (!isBrokenBgLogPath(current)) {
    return { repaired: false, logPath: typeof current === 'string' ? current : '' };
  }
  let worktree = '';
  if (typeof inst.worktree === 'string') worktree = inst.worktree;
  if (!worktree) worktree = process.cwd();
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

  const { repaired, logPath } = repairLogPath(inst);

  // Verify the Claude Code runtime is reachable.
  let claudeAvailable = false;
  try {
    const { pingClaudeSdk } = await import('./claude-sdk.mjs');
    claudeAvailable = await pingClaudeSdk();
  } catch {
    claudeAvailable = false;
  }
  if (!claudeAvailable) {
    try {
      const { spawnSync } = await import('node:child_process');
      const probe = spawnSync('claude', ['-v'], { stdio: 'ignore', timeout: 1500 });
      claudeAvailable = probe.status === 0;
    } catch {
      claudeAvailable = false;
    }
  }
  if (!claudeAvailable) {
    const updated = {
      ...inst,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      ...(repaired ? { logPath } : {}),
      retryError: 'claude runtime unavailable',
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'claude_unavailable', retryCount };
  }

  // Spawn the Claude Code process for this bg instance.
  let sessionId = null;
  try {
    const promptText = buildReplayPromptText(inst);
    const dispatchWorktree = inst.worktree || process.cwd();
    const spawnRes = await spawnAgent({
      prompt: promptText,
      agent: inst.agent || 'tyr',
      worktree: dispatchWorktree,
      logPath: repaired ? logPath : (inst.logPath || getActualBgLogPath({ sessionId: instanceId })),
      title: `retry:${instanceId}`,
    });
    if (!spawnRes.ok || !spawnRes.sessionId) {
      const updated = {
        ...inst,
        retryCount,
        lastRetryAt: Date.now(),
        lastActivityAt: Date.now(),
        ...(repaired ? { logPath } : {}),
        retryError: spawnRes.error || 'spawn failed',
      };
      atomicWriteJson(found.file, updated);
      return { ok: false, reason: 'spawn_failed', retryCount };
    }
    sessionId = spawnRes.sessionId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = {
      ...inst,
      retryCount,
      lastRetryAt: Date.now(),
      lastActivityAt: Date.now(),
      ...(repaired ? { logPath } : {}),
      retryError: `spawn threw: ${message}`,
    };
    atomicWriteJson(found.file, updated);
    return { ok: false, reason: 'spawn_threw', retryCount };
  }

  // Success path.
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
    const logFile = getActualBgLogPath({ sessionId: sessionId || instanceId });
    backgroundStore.spawnTmuxFor(
      tmuxName,
      { command: 'tail', args: ['-n', '200', '-F', logFile] },
      inst.worktree || undefined,
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
 * stored.
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
  parts.push('Claude Code runtime was reachable. The original prompt');
  parts.push('preview is above; if more context is required, inspect the');
  parts.push('linked task.)');
  parts.push('');
  parts.push('---');
  parts.push(`Subtask ID: ${inst.taskId || '(unknown)'}`);
  parts.push(`Assigned agent: ${inst.agent || 'tyr'}`);
  parts.push(`Parent task ID: ${inst.mainTaskId || '(none)'}`);
  parts.push(`Instance ID: ${inst.instanceId}`);
  parts.push(`Runtime: Claude Code (claude -p)`);
  return parts.join('\n');
}

/**
 * One pass of the retry loop. Walks every bg state file, identifies
 * candidates via `shouldRetryDispatch`, and calls `retryDispatchOnce`
 * for each.
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

void mkdirSync;
