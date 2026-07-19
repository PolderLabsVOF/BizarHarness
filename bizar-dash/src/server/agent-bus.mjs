/**
 * src/server/agent-bus.mjs
 *
 * v10.6.0 — G-autoloop Phase 4. Inter-agent messaging bus.
 *
 * Inspired by xhluca/agent-talk (a thin plugin over retalk). That
 * project is intentionally minimal — a messaging primitive with no
 * shared task list, no lead, no automatic synthesis, no routing —
 * justified by contrasting itself with Claude Code Agent Teams. We
 * port its core pattern (peer-addressed messages over a persistent
 * channel store) and add the higher-level primitives that Bizar's
 * orchestrator needs:
 *
 *   - request / response  (correlation IDs)
 *   - steer               (in-flight plan adjustment on the receiver)
 *   - correct             (steer + attached before/after diff)
 *   - handoff             (transfer task ownership to another agent)
 *   - ack / status / error (control-plane signals)
 *   - presence            (announce / heartbeat / leave)
 *
 * Persistence: every message appends to a per-channel JSONL file
 * under `.bizar/agent-bus/<channel>.jsonl`. This gives every agent
 * (and the operator) a full audit trail — important for post-mortem
 * analysis when autonomous loops run for hours.
 *
 * Transport: dual-mode. The same publish call writes to the JSONL
 * log AND emits on an in-process Node EventEmitter. In-process
 * consumers get real-time delivery with zero filesystem overhead.
 * Cross-process consumers (CLI tools, separate dashboard workers)
 * poll the JSONL tail.
 *
 * Crypto / encryption: NONE. Bizar runs single-tenant on a local
 * box. agent-talk's E2E is overkill here. The defence layer for
 * secrets is .gitignore + the Bizar trust model, not transport
 * crypto. (We can add signed envelopes via packages/sdk/src/federation/
 * later if cross-machine becomes a real requirement.)
 *
 * Address shape: `agent://<name>` (loose) or `agent://<name>/<sid>`
 * (targeted at one specific session of an agent). Loose addressing
 * means "any live session of <name>". Targeted addressing requires
 * the receiving agent to expose its current session id via /presence.
 */

/**
 * @typedef {Object} AgentMessage
 * @property {string} id          ULID-ish (time + random)
 * @property {string} from        e.g. "agent://odin"
 * @property {string} to          e.g. "agent://thor" or "agent://*"
 * @property {string} channel     human-readable channel name ("default", "task-tsk_abc", "goal-G-xyz")
 * @property {'request'|'response'|'steer'|'correct'|'handoff'|'ack'|'status'|'error'} kind
 * @property {Object} payload     kind-specific body
 * @property {string} ts          ISO timestamp
 * @property {string=} correlationId  set on `response` to link to a `request`
 * @property {string=} taskId     optional task linkage
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';

const HOME = homedir();

/** Root directory for persistent message logs and presence state. */
export const AGENT_BUS_ROOT = process.env.BIZAR_AGENT_BUS_ROOT
  || join(HOME, '.bizar', 'agent-bus');

/** Per-channel message log. */
export const AGENT_BUS_LOG_DIR = join(AGENT_BUS_ROOT, 'channels');

/** Presence registry — single JSON file. Reread on every change. */
export const AGENT_BUS_PRESENCE_FILE = join(AGENT_BUS_ROOT, 'presence.json');

/**
 * Default channel when callers omit one. Multi-agent broadcasts in
 * "default" channel; per-task/per-goal channels are auto-created on
 * first publish to avoid collisions.
 */
export const DEFAULT_CHANNEL = 'default';

const VALID_KINDS = new Set(['request', 'response', 'steer', 'correct', 'handoff', 'ack', 'status', 'error']);

/**
 * In-process event emitter — same message stream that hits the
 * JSONL log. All subscribers see every message; they filter on
 * `to` and `channel` themselves. The emitter is module-level so
 * every consumer in the same Node process gets the live stream.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let presence = {};
try {
  if (existsSync(AGENT_BUS_PRESENCE_FILE)) {
    presence = JSON.parse(readFileSync(AGENT_BUS_PRESENCE_FILE, 'utf8'));
  }
} catch { /* fresh start */ }

function persistPresence() {
  mkdirSync(AGENT_BUS_ROOT, { recursive: true });
  const tmp = AGENT_BUS_PRESENCE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(presence, null, 2));
  renameSync(tmp, AGENT_BUS_PRESENCE_FILE);
}

/**
 * Generate a sortable id. Encodes time + 8 random bytes as hex. Not
 * a ULID but close enough — monotonically sortable by `ts`, distinct
 * across concurrent writers within ~1ms thanks to randomness.
 *
 * @returns {string}
 */
function newId() {
  const time = Date.now().toString(36);
  const rand = randomBytes(8).toString('hex');
  return `${time}-${rand}`;
}

/**
 * Validate an address. We accept loose (`agent://odin`) and
 * targeted (`agent://odin/session-abc123`) plus the broadcast
 * wildcard `agent://*` for fan-out.
 *
 * @param {string} addr
 * @returns {boolean}
 */
export function isValidAddress(addr) {
  return typeof addr === 'string'
    && /^agent:\/\/([a-z0-9_-]+|\*)(\/[a-z0-9_-]+)?$/.test(addr);
}

/**
 * Resolve a loose address to its currently live targeted
 * session(s). Returns an array of `{ name, sessionId }`. Empty
 * array if the agent is not present.
 *
 * @param {string} addr e.g. "agent://odin"
 */
export function resolveAddress(addr) {
  if (!isValidAddress(addr)) return [];
  const m = /^agent:\/\/([a-z0-9_-]+)(?:\/([a-z0-9_-]+))?$/.exec(addr);
  if (!m) return [];
  const [, name, sid] = m;
  if (sid) {
    const p = presence[name];
    if (p && p.sessionId === sid) return [{ name, sessionId: sid }];
    return [];
  }
  // Loose: return every live session of `name`.
  const list = [];
  for (const [n, p] of Object.entries(presence)) {
    if (n === name && p.sessionId) list.push({ name: n, sessionId: p.sessionId });
  }
  return list;
}

/**
 * Publish a message. Returns the assigned message id.
 *
 * @param {Omit<AgentMessage, 'id' | 'ts'>} msg
 * @returns {string} id
 */
export function publish(msg) {
  if (!msg || typeof msg !== 'object') {
    throw new TypeError('publish: msg must be an object');
  }
  if (!isValidAddress(msg.from)) {
    throw new TypeError(`publish: invalid from address: ${msg.from}`);
  }
  if (!isValidAddress(msg.to)) {
    throw new TypeError(`publish: invalid to address: ${msg.to}`);
  }
  if (!VALID_KINDS.has(msg.kind)) {
    throw new TypeError(`publish: invalid kind: ${msg.kind}`);
  }
  const channel = msg.channel || DEFAULT_CHANNEL;
  const record = {
    id: msg.id || newId(),
    from: msg.from,
    to: msg.to,
    channel,
    kind: msg.kind,
    payload: msg.payload ?? {},
    correlationId: msg.correlationId || null,
    taskId: msg.taskId || null,
    ts: new Date().toISOString(),
  };

  // 1. Append to JSONL log (persistent audit).
  const logFile = join(AGENT_BUS_LOG_DIR, `${channel}.jsonl`);
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, JSON.stringify(record) + '\n');

  // 2. Notify in-process subscribers.
  emitter.emit('message', record);
  emitter.emit(`channel:${channel}`, record);

  return record.id;
}

/**
 * Convenience: send a steered adjustment to an agent. Wraps
 * `publish` with `kind: 'steer'`. Returns the assigned id.
 *
 * @param {string} from
 * @param {string} to
 * @param {string} note
 * @param {Object} [opts]
 * @param {string} [opts.channel]
 * @param {string} [opts.taskId]
 */
export function steer(from, to, note, opts = {}) {
  return publish({
    from,
    to,
    channel: opts.channel,
    taskId: opts.taskId,
    kind: 'steer',
    payload: { note: String(note || '') },
  });
}

/**
 * Convenience: send a correction (a steer with attached before/after
 * diff). The receiver should reconcile its current state against
 * the `before` field and apply the `after` change.
 *
 * @param {string} from
 * @param {string} to
 * @param {string} note
 * @param {Object} correction { before, after, reason? }
 * @param {Object} [opts]
 */
export function correct(from, to, note, correction = {}, opts = {}) {
  return publish({
    from,
    to,
    channel: opts.channel,
    taskId: opts.taskId,
    kind: 'correct',
    payload: {
      note: String(note || ''),
      before: correction.before ?? null,
      after: correction.after ?? null,
      reason: correction.reason || null,
    },
  });
}

/**
 * Convenience: hand off a task to another agent. The receiver should
 * claim ownership (update tasks-store with `assignee`/`updatedBy`)
 * and resume work.
 *
 * @param {string} from
 * @param {string} to
 * @param {string} taskId
 * @param {string} [reason]
 * @param {Object} [opts]
 */
export function handoff(from, to, taskId, reason = '', opts = {}) {
  return publish({
    from,
    to,
    channel: opts.channel,
    taskId,
    kind: 'handoff',
    payload: { taskId, reason: String(reason || '') },
  });
}

/**
 * Convenience: send a request and (optionally) wait for a
 * correlated response. The returned Promise resolves when a
 * `response` message with matching `correlationId` arrives via
 * `subscribe`, or rejects on timeout.
 *
 * @param {string} from
 * @param {string} to
 * @param {Object} payload
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=30000]
 * @param {string} [opts.channel]
 * @returns {Promise<AgentMessage>}
 */
export function request(from, to, payload, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || 30000;
  const channel = opts.channel || DEFAULT_CHANNEL;
  const id = newId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      reject(Object.assign(new Error(`timeout waiting for response to ${id}`), { code: 'TIMEOUT', requestId: id }));
    }, timeoutMs);
    const onMessage = (msg) => {
      if (settled) return;
      if (msg.kind !== 'response') return;
      if (msg.correlationId === id) {
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(msg);
      }
    };
    const unsub = subscribe(onMessage);
    // Subscribe BEFORE publish so a synchronous response from a
    // same-process subscriber is not missed.
    publish({
      id,
      from,
      to,
      channel,
      kind: 'request',
      payload: payload ?? {},
    });
  });
}

/**
 * Respond to a request. Sets `correlationId` automatically.
 *
 * @param {AgentMessage} requestMsg
 * @param {string} from
 * @param {Object} payload
 * @returns {string} response id
 */
export function respond(requestMsg, from, payload) {
  return publish({
    from,
    to: requestMsg.from,
    channel: requestMsg.channel,
    taskId: requestMsg.taskId,
    kind: 'response',
    correlationId: requestMsg.id,
    payload: payload ?? {},
  });
}

/**
 * Subscribe to all messages in the current process. Returns an
 * unsubscribe function. The listener receives every message
 * published after subscription.
 *
 * @param {(msg: AgentMessage) => void} listener
 * @returns {() => void}
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribe: listener must be a function');
  }
  emitter.on('message', listener);
  return () => emitter.off('message', listener);
}

/**
 * Subscribe to messages on a specific channel only. Slightly cheaper
 * than `subscribe` for high-frequency per-task channels.
 *
 * @param {string} channel
 * @param {(msg: AgentMessage) => void} listener
 */
export function subscribeChannel(channel, listener) {
  const ev = `channel:${channel}`;
  emitter.on(ev, listener);
  return () => emitter.off(ev, listener);
}

/**
 * Read recent messages from a channel's JSONL log. Used by:
 *   - the dashboard Loops sidebar (initial render before live subscription)
 *   - cross-process consumers (CLI tools that tail the log)
 *   - the E2E tests (assert persisted messages round-trip)
 *
 * @param {string} channel
 * @param {Object} [opts]
 * @param {number} [opts.limit=50]       max messages to return
 * @param {string} [opts.since]          ISO ts — only messages after this
 * @returns {AgentMessage[]}
 */
export function readChannel(channel, opts = {}) {
  const limit = Number(opts.limit) || 50;
  const since = opts.since || null;
  const logFile = join(AGENT_BUS_LOG_DIR, `${channel || DEFAULT_CHANNEL}.jsonl`);
  if (!existsSync(logFile)) return [];
  const text = readFileSync(logFile, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (since && msg.ts <= since) continue;
      out.push(msg);
    } catch { /* skip corrupt line — append-only JSONL can survive a torn write */ }
  }
  return out.slice(-limit);
}

/**
 * Announce presence. Idempotent: calling with the same (name,
 * sessionId) updates the heartbeat timestamp; calling with a
 * different session id replaces the prior entry.
 *
 * @param {Object} entry
 * @param {string} entry.name             agent name (e.g. "odin")
 * @param {string} entry.sessionId        session id or process id
 * @param {string=} entry.capabilities    free-form: ["plan","impl","test"]
 * @param {string=} entry.currentTask    task id the agent is currently working on
 * @param {string=} entry.model           model name
 */
export function announce(entry) {
  if (!entry || !entry.name) throw new TypeError('announce: name required');
  if (!entry.sessionId) throw new TypeError('announce: sessionId required');
  presence[entry.name] = {
    sessionId: entry.sessionId,
    capabilities: entry.capabilities || [],
    currentTask: entry.currentTask || null,
    model: entry.model || null,
    lastSeenAt: new Date().toISOString(),
  };
  persistPresence();
}

/**
 * Remove an agent from presence. Called on clean shutdown.
 *
 * @param {string} name
 */
export function leave(name) {
  if (presence[name]) {
    delete presence[name];
    persistPresence();
  }
}

/**
 * Heartbeat — bump `lastSeenAt` for an agent without changing
 * other fields. Cheap; no file lock, just overwrite.
 *
 * @param {string} name
 * @param {string} sessionId
 */
export function heartbeat(name, sessionId) {
  if (!presence[name] || presence[name].sessionId !== sessionId) return;
  presence[name].lastSeenAt = new Date().toISOString();
  // Lazy persist — every N calls. Avoids fsync thrash on tight loops.
  persistPresence();
}

/**
 * Snapshot of presence — used by /api/agents/presence and tests.
 * Stale entries (lastSeenAt > 5 min ago) are filtered out.
 *
 * @returns {Object} { [name]: { sessionId, capabilities, currentTask, lastSeenAt } }
 */
export function getPresence() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const out = {};
  for (const [name, p] of Object.entries(presence)) {
    const t = Date.parse(p.lastSeenAt);
    if (!Number.isFinite(t) || t < cutoff) continue;
    out[name] = p;
  }
  return out;
}

/**
 * Convenience for tests: reset all state. Calls leave() on every
 * known agent and unlinks the log/presence files.
 */
export function _resetForTests() {
  for (const name of Object.keys(presence)) delete presence[name];
  try { persistPresence(); } catch { /* */ }
  // Drop all subscribers on the global + per-channel events so tests
  // don't see messages from prior cases.
  emitter.removeAllListeners('message');
  for (const ev of emitter.eventNames()) {
    if (typeof ev === 'string' && ev.startsWith('channel:')) {
      emitter.removeAllListeners(ev);
    }
  }
}
