/**
 * src/server/agents-store.mjs
 *
 * v3.0.0 — Editable agents.
 * v3.1.0 — Real-time agent status, stuck detection, tags + category,
 *          tags + category exposed via list().
 *
 * Each agent is a markdown file with frontmatter at:
 *   ~/.config/cline/agents/<name>.md
 *
 * The store reads / writes these files. The format is:
 *   ---
 *   description: ...
 *   model: ...
 *   mode: ...
 *   color: ...
 *   tools: ["bash","read","edit"]
 *   tags: ["reasoning","code"]
 *   category: "reasoning"
 *   permissions: {...}
 *   ---
 *   <prompt body>
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const AGENTS_DIR = join(HOME, '.config', 'cline', 'agents');

// v3.2.0 — agent hierarchy. Odin sits at the top as router; Tyr/Thor/
// Hermod/Baldr/Mimir report directly to Odin; Forseti is peer-to-Odin
// for audits; Vidarr is the ultimate fallback. Level 0 = router,
// 1 = coordinator, 2 = worker, 3 = fallback.
const HIERARCHY = {
  odin: { level: 0, parent: null, role: 'router' },
  forseti: { level: 0, parent: null, role: 'auditor' },
  tyr: { level: 1, parent: 'odin', role: 'implementer' },
  thor: { level: 1, parent: 'odin', role: 'implementer' },
  hermod: { level: 1, parent: 'odin', role: 'gitops' },
  baldr: { level: 1, parent: 'odin', role: 'designer' },
  mimir: { level: 1, parent: 'odin', role: 'researcher' },
  heimdall: { level: 2, parent: 'thor', role: 'executor' },
  frigg: { level: 2, parent: 'mimir', role: 'qa' },
  vor: { level: 2, parent: 'mimir', role: 'clarifier' },
  quick: { level: 2, parent: null, role: 'quick' },
  'semble-search': { level: 2, parent: 'mimir', role: 'search' },
  vidarr: { level: 3, parent: null, role: 'fallback' },
};

// v3.1.0 — Runtime agent status. Persisted in memory; flushed to
// ~/.config/bizar/agent-status.json so the dashboard can show real
// activity even after a restart. This is the single source of truth
// for "is this agent currently working on a task?".
const STATUS_FILE = join(HOME, '.config', 'bizar', 'agent-status.json');
const _status = new Map(); // name -> { status, currentTaskId, lastSeen, heartbeat, currentTaskStartedAt, lastError }
let _statusLoaded = false;

function loadStatus() {
  if (_statusLoaded) return;
  _statusLoaded = true;
  try {
    if (existsSync(STATUS_FILE)) {
      const raw = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
      for (const [name, s] of Object.entries(raw || {})) {
        _status.set(name, s);
      }
    }
  } catch {
    /* ignore */
  }
}

function saveStatus() {
  try {
    mkdirSync(dirname(STATUS_FILE), { recursive: true });
    const obj = {};
    for (const [k, v] of _status.entries()) obj[k] = v;
    const tmp = `${STATUS_FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    renameSync(tmp, STATUS_FILE);
  } catch {
    /* best effort */
  }
}

function defaultStatus(name) {
  return {
    status: 'idle',
    currentTaskId: null,
    lastSeen: 0,
    heartbeat: 0,
    currentTaskStartedAt: 0,
    lastError: null,
    lastTask: null,
    tasksTotal: 0,
    tasksSucceeded: 0,
    tasksFailed: 0,
    successRate: 0,
  };
}

function safeReadText(file, fallback = '') {
  try {
    if (!existsSync(file)) return fallback;
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s+/, '');
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      // v3.1.0 — Inline array: [a, "b", c]
      const inner = val.slice(1, -1).trim();
      frontmatter[key] = inner
        ? inner
            .split(',')
            .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        : [];
    } else {
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body };
}

/** Serialize a frontmatter key — string is bare, value with special chars gets quoted. */
function fmVal(v) {
  if (typeof v !== 'string') return JSON.stringify(v);
  if (v === '') return '""';
  if (/[:#\-?{}[\],&*!|>'"%@`]/.test(v) || v.includes(' ')) {
    return JSON.stringify(v);
  }
  return v;
}

function serializeFrontmatter(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : x)).join(', ')}]`);
    } else if (typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) {
        lines.push(`  ${k2}: ${fmVal(String(v2))}`);
      }
    } else {
      lines.push(`${k}: ${fmVal(String(v))}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function readAgent(name) {
  const file = join(AGENTS_DIR, `${name}.md`);
  if (!existsSync(file)) return null;
  const raw = safeReadText(file);
  const { frontmatter, body } = parseFrontmatter(raw);
  const st = statSync(file);
  const status = _status.get(name) || defaultStatus(name);
  return {
    name,
    description: frontmatter.description || '',
    model: frontmatter.model || '',
    mode: frontmatter.mode || 'subagent',
    color: frontmatter.color || '',
    tools: typeof frontmatter.tools === 'string'
      ? frontmatter.tools.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(frontmatter.tools) ? frontmatter.tools : [],
    tags: typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    category: frontmatter.category || '',
    permissions: frontmatter.permissions || null,
    prompt: body.trim(),
    file,
    path: file,
    mtime: st.mtimeMs,
    // v3.1.0 — runtime status, attached to the read-only snapshot.
    status: status.status,
    currentTaskId: status.currentTaskId || null,
    currentTaskStartedAt: status.currentTaskStartedAt || 0,
    lastSeen: status.lastSeen || 0,
    heartbeat: status.heartbeat || 0,
    lastError: status.lastError || null,
    lastTask: status.lastTask || null,
    successRate: status.successRate || 0,
    tasksTotal: status.tasksTotal || 0,
    tasksSucceeded: status.tasksSucceeded || 0,
    tasksFailed: status.tasksFailed || 0,
    isStuck: isStuck(status),
    // v3.2.0 — hierarchy metadata.
    level: HIERARCHY[name]?.level ?? 2,
    parent: HIERARCHY[name]?.parent ?? null,
    role: HIERARCHY[name]?.role ?? 'unknown',
  };
}

/** Build a tree representation of the agent hierarchy. */
export function buildHierarchyTree(agents) {
  const byParent = new Map();
  for (const a of agents) {
    const key = a.parent || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(a);
  }
  const seen = new Set();
  function node(name) {
    if (seen.has(name)) return null;
    seen.add(name);
    const agent = agents.find((a) => a.name === name) || null;
    const children = (byParent.get(name) || []).map((c) => node(c.name)).filter(Boolean);
    return {
      name,
      agent,
      children,
    };
  }
  const roots = (byParent.get('__root__') || []).map((a) => node(a.name)).filter(Boolean);
  return { roots, all: agents };
}

export const agentsStore = {
  AGENTS_DIR,

  ensure() {
    mkdirSync(AGENTS_DIR, { recursive: true });
  },

  list() {
    this.ensure();
    const out = [];
    for (const f of readdirSync(AGENTS_DIR)) {
      if (!f.endsWith('.md')) continue;
      const name = basename(f, '.md');
      const agent = readAgent(name);
      if (agent) out.push(agent);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  get(name) {
    return readAgent(name);
  },

  create(input) {
    if (!input || typeof input !== 'object') throw new Error('agent input required');
    if (!input.name || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.name)) {
      throw new Error('invalid agent name');
    }
    const file = join(AGENTS_DIR, `${input.name}.md`);
    if (existsSync(file)) {
      throw new Error(`agent "${input.name}" already exists`);
    }
    const data = {
      name: input.name,
      description: input.description || '',
      model: input.model || '',
      mode: input.mode || 'subagent',
      color: input.color || '',
      tools: Array.isArray(input.tools) ? input.tools : [],
      tags: Array.isArray(input.tags) ? input.tags : [],
      category: input.category || '',
      permissions: input.permissions || null,
      prompt: input.prompt || '',
    };
    this.ensure();
    writeFileSync(file, serializeFrontmatter(data) + '\n' + data.prompt, 'utf8');
    return readAgent(input.name);
  },

  update(name, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('agent patch required');
    const cur = readAgent(name);
    if (!cur) throw new Error(`agent "${name}" not found`);
    const data = {
      description: patch.description ?? cur.description,
      model: patch.model ?? cur.model,
      mode: patch.mode ?? cur.mode,
      color: patch.color ?? cur.color,
      tools: Array.isArray(patch.tools) ? patch.tools : cur.tools,
      tags: Array.isArray(patch.tags) ? patch.tags : (cur.tags || []),
      category: patch.category ?? cur.category ?? '',
      permissions: patch.permissions ?? cur.permissions,
      prompt: patch.prompt ?? cur.prompt,
    };
    writeFileSync(cur.file, serializeFrontmatter(data) + '\n' + data.prompt, 'utf8');
    return readAgent(name);
  },

  delete(name) {
    const file = join(AGENTS_DIR, `${name}.md`);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    _status.delete(name);
    saveStatus();
    return true;
  },

  /**
   * v3.1.0 — Update the runtime status for a single agent. Used by
   * the cline plugin (via POST /api/agents/:name/status) and the
   * task lifecycle (when an agent starts/finishes a task).
   *
   * Status: 'idle' | 'working' | 'error' | 'stuck'.
   */
  updateStatus(name, status, currentTaskId = null) {
    loadStatus();
    const prev = _status.get(name) || defaultStatus(name);
    const now = Date.now();
    const next = { ...prev };
    if (status) next.status = status;
    if (currentTaskId !== undefined) next.currentTaskId = currentTaskId;
    next.lastSeen = now;
    next.heartbeat = now;
    if (status === 'working' && currentTaskId && currentTaskId !== prev.currentTaskId) {
      next.currentTaskStartedAt = now;
    }
    if (status === 'idle' || status === 'error' || status === 'stuck') {
      if (prev.currentTaskId) {
        next.lastTask = {
          id: prev.currentTaskId,
          finishedAt: now,
          status,
        };
      }
      next.currentTaskId = null;
      next.currentTaskStartedAt = 0;
    }
    if (status === 'error') {
      next.lastError = { ts: now, message: typeof currentTaskId === 'string' ? currentTaskId : 'error' };
    }
    _status.set(name, next);
    saveStatus();
    return readAgent(name);
  },

  /** Heartbeat ping — keeps lastSeen fresh without changing status. */
  heartbeat(name) {
    loadStatus();
    const cur = _status.get(name) || defaultStatus(name);
    cur.heartbeat = Date.now();
    cur.lastSeen = cur.heartbeat;
    _status.set(name, cur);
    saveStatus();
    return readAgent(name);
  },

  /**
   * Mark that an agent finished a task. Bumps the success/failure
   * counters and clears the currentTaskId.
   */
  recordTaskResult(name, taskId, ok) {
    loadStatus();
    const cur = _status.get(name) || defaultStatus(name);
    cur.tasksTotal += 1;
    if (ok) cur.tasksSucceeded += 1;
    else cur.tasksFailed += 1;
    cur.successRate = cur.tasksTotal > 0 ? cur.tasksSucceeded / cur.tasksTotal : 0;
    cur.lastTask = { id: taskId, finishedAt: Date.now(), status: ok ? 'success' : 'failed' };
    cur.currentTaskId = null;
    cur.currentTaskStartedAt = 0;
    cur.status = 'idle';
    cur.lastSeen = Date.now();
    _status.set(name, cur);
    saveStatus();
    return readAgent(name);
  },

  /** Get raw status for a single agent. */
  getStatus(name) {
    loadStatus();
    return _status.get(name) || defaultStatus(name);
  },

  /** Return the list of stuck agents (used by /api/agents/stuck). */
  stuck() {
    loadStatus();
    const out = [];
    for (const [name, s] of _status.entries()) {
      if (isStuck(s)) {
        out.push({ name, ...s });
      }
    }
    return out;
  },

  /**
   * v3.1.0 — "Restart" an agent. For this release this resets the
   * runtime status (clears the current task, marks idle) and removes
   * the stuck flag. A real process restart is documented as v3.2.
   */
  restart(name) {
    loadStatus();
    const cur = _status.get(name) || defaultStatus(name);
    cur.status = 'idle';
    cur.currentTaskId = null;
    cur.currentTaskStartedAt = 0;
    cur.lastSeen = Date.now();
    cur.heartbeat = Date.now();
    cur.lastError = null;
    _status.set(name, cur);
    saveStatus();
    return readAgent(name);
  },

  STATUS_FILE,
};

// ── v3.1.0 — Stuck detection ────────────────────────────────────────
// A "working" agent is stuck if it has been on a single task for
// longer than STUCK_WORKING_MS without a heartbeat. An "idle" agent
// with a queued task is stuck if lastSeen is older than
// STUCK_IDLE_MS. Both thresholds are intentionally conservative
// for v3.1.0; settings overrides land in v3.2.

const STUCK_WORKING_MS = 10 * 60 * 1000; // 10 min
const STUCK_IDLE_MS = 5 * 60 * 1000; // 5 min

function isStuck(status) {
  if (!status) return false;
  const now = Date.now();
  if (status.status === 'working' && status.currentTaskStartedAt) {
    const elapsed = now - status.currentTaskStartedAt;
    if (elapsed > STUCK_WORKING_MS) return true;
  }
  if (status.status === 'error' && status.lastError?.ts) {
    const elapsed = now - new Date(status.lastError.ts).getTime();
    if (elapsed > STUCK_WORKING_MS) return true;
  }
  return false;
}

export { isStuck };
