/**
 * src/server/claude-session-watcher.mjs
 *
 * F-040 — Live Agent Dashboard. Watches every Claude Code session
 * JSONL under `~/.claude/sessions/<sessionId>/messages.jsonl` and
 * surfaces Agent-tool activity to the dashboard's Agents view.
 *
 * Why this exists:
 *   The dashboard already tracks dashboard-spawned `claude --bg`
 *   sessions via claude-bg-spawner.mjs. But Claude Code sessions
 *   started in the user's terminal (`claude`, `claude --resume …`,
 *   or subagent dispatches via the Agent tool) are invisible to the
 *   dashboard. They DO leave a complete activity trail in
 *   `~/.claude/sessions/<id>/messages.jsonl` — so this module tails
 *   those files and emits the same kinds of events the bg-spawner
 *   emits when it sees Agent dispatches / session results.
 *
 * Wire shape:
 *   - `start()` boots a directory watcher + one fs.watch per file
 *     that currently exists. New session subdirs are picked up via
 *     the directory watcher event and via a periodic backstop
 *     re-scan every 5s.
 *   - For each file we track a `lastSize`. On change, we read the
 *     delta (bytes between lastSize and current fs.stat().size),
 *     split on `\n`, and emit one event per line. Robust to
 *     truncation (file shorter than lastSize → reset position to 0
 *     and re-read).
 *   - The watcher is idempotent: a second `start()` returns false.
 *
 * Test seams:
 *   - `_testProcessTail({ filePath, lastSize })` lets a unit test
 *     drive the tail logic without touching fs.watch.
 *   - `_testInit({ sessionDir, onEvent })` returns a `{ stop }`
 *     handle that wires up fs.watch without the 5s backstop poll.
 *
 * Events emitted (consumed by routes/agents.mjs):
 *   - { type: 'claude:tool-use', sessionId, toolUseId, name, args, agentName, ts }
 *   - { type: 'claude:session-activity', sessionId, agentName?, lastToolName?, lastTs }
 *   - { type: 'claude:session-ended', sessionId, reason, ts }
 *
 * The watcher does NOT broadcast directly — it forwards parsed
 * events to the `onEvent` callback provided at start(). The router
 * (or test harness) decides how to fan them out (REST + WS bus +
 * agentStore.updateStatus).
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
export const CLAUDE_SESSIONS_DIR = join(HOME, '.claude', 'sessions');

const POLL_INTERVAL_MS = 5_000;

let _active = false;
let _sessionDir = CLAUDE_SESSIONS_DIR;
let _onEvent = null;
const _fileWatchers = new Map(); // filePath -> { watcher, lastSize }
let _dirWatcher = null;
let _pollTimer = null;

function defaultOnEvent() {
  /* no-op (test seam) */
}

/**
 * Extract the agent name from a Claude Code Agent tool_use block.
 * Tries subagent_type → agent → name → type → "claude".
 */
function pickAgentName(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const cand =
    toolInput.subagent_type ||
    toolInput.agent ||
    toolInput.name ||
    toolInput.type;
  if (typeof cand === 'string' && cand.trim()) return cand.trim().slice(0, 64);
  return null;
}

/**
 * Walk a JSONL line and surface its top-level content blocks.
 * Claude Code stores content as either a string or an array of
 * blocks ({ type: 'text' | 'tool_use' | 'tool_result' | ... }).
 */
function extractContentBlocks(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const message = parsed.message || parsed;
  const c = message && message.content;
  if (typeof c === 'string') return [];
  if (!Array.isArray(c)) return [];
  return c.filter((b) => b && typeof b === 'object');
}

/**
 * Read the delta between lastSize and the current file size and
 * return complete JSONL lines. Robust to truncation (file shorter
 * than lastSize → reset position to 0). When the file ends mid-line,
 * we back off `newSize` so the partial fragment gets re-read on the
 * next tick.
 *
 * @param {string} filePath
 * @param {number} lastSize
 * @returns {{ lines: string[], newSize: number, truncated: boolean }}
 */
export function _testProcessTail(filePath, lastSize) {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    return { lines: [], newSize: lastSize, truncated: false };
  }
  const curSize = st.size;
  if (curSize === lastSize) {
    return { lines: [], newSize: lastSize, truncated: false };
  }
  const truncated = curSize < lastSize;
  if (truncated) lastSize = 0;

  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return { lines: [], newSize: lastSize, truncated };
  }
  const slice = text.slice(lastSize, curSize);
  const parts = slice.split('\n');
  let newSize = curSize;
  if (parts.length === 0) {
    return { lines: [], newSize: lastSize, truncated };
  }
  if (parts[parts.length - 1] === '') {
    // File ended in \n → last segment is the empty remainder. Drop it.
    parts.pop();
  } else {
    // Partial trailing line: back up so we re-read it next tick.
    const tail = parts[parts.length - 1];
    newSize = curSize - Buffer.byteLength(tail, 'utf8');
    parts.pop();
  }
  const lines = parts.filter((p) => p.length > 0);
  return { lines, newSize, truncated };
}

/**
 * Parse one JSONL line and emit zero or more events via onEvent.
 */
function processLine(sessionId, raw, onEvent) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;

  const blocks = extractContentBlocks(parsed);
  let lastToolName = null;

  for (const block of blocks) {
    if (!block) continue;
    if (block.type === 'tool_use' || block.name) {
      const toolName = (block.name || '').toString();
      const toolUseId = (block.id || '').toString();
      lastToolName = toolName || lastToolName;
      if (toolName === 'Agent') {
        const agentName = pickAgentName(block.input);
        const args = block.input || {};
        const ts = Number(parsed.timestamp) || Date.now();
        onEvent({
          type: 'claude:tool-use',
          sessionId,
          toolUseId,
          name: toolName,
          args,
          agentName: agentName || 'claude',
          ts,
        });
      }
    }
  }

  // Session-level events.
  const t = (parsed.type || '').toString();
  if (t === 'result') {
    const sub = (parsed.subtype || '').toString();
    const ts = Number(parsed.timestamp) || Date.now();
    if (sub === 'success') {
      onEvent({ type: 'claude:session-activity', sessionId, lastToolName, lastTs: ts });
      onEvent({ type: 'claude:session-ended', sessionId, reason: 'completed', ts });
    } else if (sub === 'error_during_execution') {
      onEvent({ type: 'claude:session-activity', sessionId, lastToolName, lastTs: ts });
      onEvent({ type: 'claude:session-ended', sessionId, reason: 'failed', ts });
    }
  } else if (t === 'system' && parsed.subtype === 'init') {
    onEvent({ type: 'claude:session-activity', sessionId, lastTs: Date.now() });
  } else if (t === 'assistant' || t === 'user') {
    onEvent({ type: 'claude:session-activity', sessionId, lastToolName, lastTs: Date.now() });
  }
}

function sessionIdFromPath(filePath) {
  // The session id is the parent dir of `messages.jsonl`. Matches
  // both `~/.claude/sessions/<id>/messages.jsonl` (production) and
  // any `<root>/<id>/messages.jsonl` (tests).
  const m = /\/([^/]+)\/messages\.jsonl$/.exec(filePath);
  return m ? m[1] : '';
}

/**
 * Wire up fs.watch for one JSONL file. Maintains a per-file
 * lastSize and emits events for every complete line appended.
 */
function watchFile(filePath, onEvent) {
  if (_fileWatchers.has(filePath)) return;
  let lastSize = 0;

  // Initial drain — read whatever is already in the file.
  try {
    const initial = readFileSync(filePath, 'utf8');
    if (initial) {
      const parts = initial.split('\n');
      if (parts.length && parts[parts.length - 1] === '') parts.pop();
      for (const p of parts) {
        if (!p) continue;
        processLine(sessionIdFromPath(filePath), p, onEvent);
      }
      lastSize = Buffer.byteLength(initial, 'utf8');
    }
  } catch {
    /* file might not exist yet */
  }

  let watcher;
  try {
    watcher = watch(filePath, { persistent: false }, () => {
      try {
        const { lines, newSize } = _testProcessTail(filePath, lastSize);
        lastSize = newSize;
        for (const ln of lines) {
          processLine(sessionIdFromPath(filePath), ln, onEvent);
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    return; // fs.watch can throw on some platforms; ignore.
  }
  _fileWatchers.set(filePath, { watcher, lastSize });
}

function stopFileWatchers() {
  for (const { watcher } of _fileWatchers.values()) {
    try {
      watcher.close?.();
    } catch {
      /* ignore */
    }
  }
  _fileWatchers.clear();
}

/**
 * Re-scan the session directory. Picks up newly created session
 * subdirs and attaches watchers to their messages.jsonl. Existing
 * watchers are left alone (idempotent).
 */
function scanSessionDir() {
  if (!_onEvent || !_sessionDir) return;
  if (!existsSync(_sessionDir)) return;
  let dirs;
  try {
    dirs = readdirSync(_sessionDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const id of dirs) {
    const fp = join(_sessionDir, id, 'messages.jsonl');
    if (existsSync(fp) && !_fileWatchers.has(fp)) {
      watchFile(fp, _onEvent);
    }
  }
}

/**
 * Boot the watcher. Idempotent.
 *
 * @param {{ sessionDir?: string, onEvent?: (evt: object) => void }} [opts]
 * @returns {boolean} true when started, false when already active
 */
export function start(opts = {}) {
  if (_active) return false;
  _sessionDir = opts.sessionDir || CLAUDE_SESSIONS_DIR;
  _onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : defaultOnEvent;

  scanSessionDir();

  try {
    if (existsSync(_sessionDir)) {
      _dirWatcher = watch(_sessionDir, { persistent: false }, () => scanSessionDir());
    }
  } catch {
    /* ignore */
  }

  _pollTimer = setInterval(() => scanSessionDir(), POLL_INTERVAL_MS);
  if (_pollTimer.unref) _pollTimer.unref();

  _active = true;
  return true;
}

/**
 * Stop the watcher. Idempotent.
 *
 * @returns {boolean} true when something was stopped, false when already idle
 */
export function stop() {
  if (!_active) return false;
  _active = false;
  stopFileWatchers();
  try {
    _dirWatcher?.close?.();
  } catch {
    /* ignore */
  }
  _dirWatcher = null;
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = null;
  _onEvent = null;
  return true;
}

export function isActive() {
  return _active;
}

/**
 * Test seam: same as `start()` but skips the 5s backstop poll so
 * tests can drive end-to-end behaviour deterministically.
 */
export function _testInit({ sessionDir, onEvent }) {
  // Reset state without firing the periodic timer.
  if (_active) stop();
  _sessionDir = sessionDir;
  _onEvent = onEvent || defaultOnEvent;
  scanSessionDir();
  _dirWatcher = watch(_sessionDir, { persistent: false }, () => scanSessionDir());
  _active = true;
  return {
    stop() {
      stopFileWatchers();
      try {
        _dirWatcher?.close?.();
      } catch {
        /* ignore */
      }
      _dirWatcher = null;
      _active = false;
      _onEvent = null;
    },
  };
}

export const claudeSessionWatcher = {
  start,
  stop,
  isActive,
  CLAUDE_SESSIONS_DIR,
};