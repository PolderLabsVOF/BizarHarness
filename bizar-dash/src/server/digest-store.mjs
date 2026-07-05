/**
 * src/server/digest-store.mjs
 *
 * v4.8.0 — Auto-generated weekly digests.
 *
 * Aggregates the last 7 days of activity (tasks, memory notes, chat
 * sessions, schedules, background agents, token usage) into a human-
 * readable markdown digest, saved to the digests directory.
 *
 * Storage:
 *   Primary:  ~/.local/share/bizar/digests/weekly-YYYY-MM-DD.md
 *   Secondary: <projectRoot>/.obsidian/digests/ (if vault exists)
 *
 * The digest index metadata is stored in a companion JSON index at
 * ~/.local/share/bizar/digests/.index.json so list/del operations
 * stay fast without re-reading every markdown file.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { tasksStore } from './tasks-store.mjs';
import { schedulesStore } from './schedules-store.mjs';
import { activityLog } from './activity-log.mjs';
import { backgroundStore } from './background-store.mjs';
import { queryUsage } from './minimax-usage-store.mjs';

// Allow test override without patching process.env.HOME (which can be racy
// with ESM module-level evaluation order in the Node test runner).
const STORE_HOME = process.env.BIZAR_STORE_HOME
  ? process.env.BIZAR_STORE_HOME
  : join(homedir(), '.local', 'share', 'bizar');
const DIGESTS_DIR = join(STORE_HOME, 'digests');
const INDEX_FILE = join(DIGESTS_DIR, '.index.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function dateStr(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function humanDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function loadIndex() {
  return safeReadJSON(INDEX_FILE, { digests: [] });
}

function saveIndex(index) {
  ensureDir(DIGESTS_DIR);
  atomicWriteJson(INDEX_FILE, index);
}

function digestFilename(weekStart) {
  return `weekly-${weekStart}.md`;
}

function digestPath(weekStart) {
  return join(DIGESTS_DIR, digestFilename(weekStart));
}

function buildDigestId() {
  return 'dig_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Compute the date range for digest generation.
 * If weekStart/End are not provided, defaults to last 7 days.
 */
export function computeWeekRange(weekStart, weekEnd) {
  const now = new Date();
  const end = weekEnd ? new Date(weekEnd) : new Date(now);
  const start = weekStart
    ? new Date(weekStart)
    : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { weekStart: dateStr(start), weekEnd: dateStr(end) };
}

// ── Section query helpers ───────────────────────────────────────────────────

function queryTasksCompleted({ weekStart, weekEnd }) {
  const startMs = new Date(weekStart).getTime();
  const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
  try {
    const tasks = tasksStore.loadTasks('default', { includeArchived: true });
    return tasks
      .filter((t) => {
        if (t.status !== 'done') return false;
        const completed = t.completedAt ? new Date(t.completedAt).getTime() : 0;
        return completed >= startMs && completed <= endMs;
      })
      .map((t) => ({
        id: t.id,
        title: t.title,
        completedAt: t.completedAt,
        priority: t.priority,
      }));
  } catch {
    return { error: 'tasks store unavailable' };
  }
}

function queryTasksCreated({ weekStart, weekEnd }) {
  const startMs = new Date(weekStart).getTime();
  const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
  try {
    const tasks = tasksStore.loadTasks('default', { includeArchived: true });
    return tasks
      .filter((t) => {
        const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
        return created >= startMs && created <= endMs;
      })
      .map((t) => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        priority: t.priority,
      }));
  } catch {
    return { error: 'tasks store unavailable' };
  }
}

function queryMemoryWrites({ weekStart, weekEnd, projectRoot }) {
  const startMs = new Date(weekStart).getTime();
  const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
  const vaultRoot = join(projectRoot, '.obsidian');
  if (!existsSync(vaultRoot)) return [];
  const notes = [];
  function walk(dir, prefix) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue;
        walk(full, rel);
      } else if (e.name.endsWith('.md')) {
        try {
          const st = statSync(full);
          if (st.mtimeMs >= startMs && st.mtimeMs <= endMs) {
            notes.push({ relPath: rel, mtime: st.mtimeMs });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }
  walk(vaultRoot, '');
  return notes;
}

function queryChatSessions({ weekStart, weekEnd }) {
  const startMs = new Date(weekStart).getTime();
  const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
  try {
    const recent = activityLog.recent(500);
    return recent.filter((e) => {
      const ts = e.ts ? new Date(e.ts).getTime() : 0;
      return ts >= startMs && ts <= endMs;
    });
  } catch {
    return [];
  }
}

function querySchedulesFired({ weekStart, weekEnd }) {
  const startMs = new Date(weekStart).getTime();
  const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
  const fired = [];
  try {
    const schedules = schedulesStore.list('default');
    for (const s of schedules) {
      const history = s.history || [];
      for (const h of history) {
        const ts = h.ts ? new Date(h.ts).getTime() : 0;
        if (ts >= startMs && ts <= endMs) {
          fired.push({ scheduleName: s.name, result: h.result, ts: h.ts });
        }
      }
    }
  } catch {
    // ignore
  }
  return fired;
}

function queryBgAgentsCompleted({ weekStart, weekEnd }) {
  const startMs = new Date(weekStart).getTime();
  const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
  try {
    const agents = backgroundStore.list();
    return agents.filter((a) => {
      const ts = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      return ts >= startMs && ts <= endMs;
    });
  } catch {
    return [];
  }
}

function queryUsageStats({ weekStart, weekEnd }) {
  try {
    const startMs = new Date(weekStart).getTime();
    const endMs = new Date(weekEnd + 'T23:59:59.999Z').getTime();
    return queryUsage({ range: 'custom', from: startMs, to: endMs });
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * The ordered list of digest sections and their label/query tuples.
 */
export const DIGEST_SECTIONS = [
  { kind: 'tasks', label: 'Tasks completed', query: queryTasksCompleted },
  { kind: 'tasks-created', label: 'Tasks created', query: queryTasksCreated },
  { kind: 'memory-writes', label: 'Memory notes written', query: queryMemoryWrites },
  { kind: 'chat-sessions', label: 'Chat sessions', query: queryChatSessions },
  { kind: 'schedules-fired', label: 'Schedules fired', query: querySchedulesFired },
  { kind: 'bg-agents-completed', label: 'Background agents completed', query: queryBgAgentsCompleted },
  { kind: 'usage-stats', label: 'Token usage', query: queryUsageStats },
];

/**
 * Generate a weekly digest for the given date range.
 *
 * @param {object} opts
 * @param {string} [opts.weekStart]  — ISO date string YYYY-MM-DD (inclusive)
 * @param {string} [opts.weekEnd]    — ISO date string YYYY-MM-DD (inclusive)
 * @param {string} [opts.projectRoot]
 * @param {boolean} [opts.dryRun]    — if true, returns markdown but does NOT save
 * @returns {{ markdown: string, sections: object, weekStart: string, weekEnd: string, dryRun: boolean }}
 */
export async function generateWeeklyDigest({ weekStart, weekEnd, projectRoot = process.cwd(), dryRun = false } = {}) {
  const range = computeWeekRange(weekStart, weekEnd);
  const start = range.weekStart;
  const end = range.weekEnd;
  const ctx = { weekStart: start, weekEnd: end, projectRoot };

  const sections = {};
  for (const section of DIGEST_SECTIONS) {
    try {
      sections[section.kind] = await section.query(ctx);
    } catch (err) {
      sections[section.kind] = { error: err.message };
    }
  }

  const markdown = buildDigestMarkdown({ weekStart: start, weekEnd: end, sections });

  return { markdown, sections, weekStart: start, weekEnd: end, dryRun };
}

/**
 * Build the markdown string from section data.
 */
function buildDigestMarkdown({ weekStart, weekEnd, sections }) {
  const now = new Date();
  const lines = [];

  lines.push('---');
  lines.push(`title: "Weekly Digest ${weekStart} – ${weekEnd}"`);
  lines.push(`date: ${dateStr(now)}`);
  lines.push('type: digest');
  lines.push(`weekStart: ${weekStart}`);
  lines.push(`weekEnd: ${weekEnd}`);
  lines.push('---');
  lines.push('');
  lines.push('# Weekly Digest');
  lines.push('');
  lines.push(`**Week:** ${humanDate(weekStart)} – ${humanDate(weekEnd)}`);
  lines.push(`**Generated:** ${now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`);
  lines.push('');

  // ── Tasks completed ──
  lines.push('## Tasks completed');
  const tasksCompleted = sections['tasks'] || [];
  if (Array.isArray(tasksCompleted) && tasksCompleted.length > 0) {
    for (const t of tasksCompleted) {
      const completedDate = t.completedAt ? humanDate(t.completedAt) : 'this week';
      lines.push(`- **${t.title}** (\`#${t.id}\`) — Completed ${completedDate}`);
    }
  } else {
    lines.push('*No tasks completed this week.*');
  }
  lines.push('');

  // ── Tasks created ──
  lines.push('## Tasks created');
  const tasksCreated = sections['tasks-created'] || [];
  if (Array.isArray(tasksCreated) && tasksCreated.length > 0) {
    for (const t of tasksCreated) {
      const createdDate = t.createdAt ? humanDate(t.createdAt) : 'this week';
      lines.push(`- **${t.title}** (\`#${t.id}\`) — Created ${createdDate}`);
    }
  } else {
    lines.push('*No tasks created this week.*');
  }
  lines.push('');

  // ── Memory notes written ──
  lines.push('## Memory notes written');
  const memoryWrites = sections['memory-writes'] || [];
  if (Array.isArray(memoryWrites) && memoryWrites.length > 0) {
    for (const n of memoryWrites) {
      const noteDate = n.mtime ? humanDate(new Date(n.mtime).toISOString()) : '';
      lines.push(`- \`${n.relPath}\` — ${noteDate}`);
    }
  } else {
    lines.push('*No memory notes written this week.*');
  }
  lines.push('');

  // ── Chat sessions ──
  lines.push('## Chat sessions');
  const chatSessions = sections['chat-sessions'] || [];
  if (Array.isArray(chatSessions) && chatSessions.length > 0) {
    const byKind = {};
    for (const s of chatSessions) {
      const kind = s.kind || 'unknown';
      byKind[kind] = (byKind[kind] || 0) + 1;
    }
    const total = chatSessions.length;
    const kindSummary = Object.entries(byKind)
      .map(([k, c]) => `${c} ${k}`)
      .join(', ');
    lines.push(`- **${total}** session(s) (${kindSummary})`);
  } else {
    lines.push('*No chat sessions recorded this week.*');
  }
  lines.push('');

  // ── Schedules fired ──
  lines.push('## Schedules fired');
  const schedulesFired = sections['schedules-fired'] || [];
  if (Array.isArray(schedulesFired) && schedulesFired.length > 0) {
    const byName = {};
    for (const s of schedulesFired) {
      const name = s.scheduleName || 'unknown';
      byName[name] = (byName[name] || 0) + 1;
    }
    for (const [name, count] of Object.entries(byName)) {
      lines.push(`- **${name}** — fired ${count} time(s)`);
    }
  } else {
    lines.push('*No schedules fired this week.*');
  }
  lines.push('');

  // ── Background agents completed ──
  lines.push('## Background agents completed');
  const bgAgents = sections['bg-agents-completed'] || [];
  const comp = Array.isArray(bgAgents) ? bgAgents.filter((a) => a.status === 'done').length : 0;
  const fail = Array.isArray(bgAgents) ? bgAgents.filter((a) => a.status === 'failed').length : 0;
  lines.push(`- **${comp}** completed, **${fail}** failed`);
  if (Array.isArray(bgAgents) && bgAgents.length > 0) {
    lines.push('');
    for (const a of bgAgents) {
      const agentDate = a.completedAt ? humanDate(a.completedAt) : '';
      lines.push(`- \`${a.instanceId || 'unknown'}\` — ${a.status} — ${agentDate}`);
    }
  }
  lines.push('');

  // ── Token usage ──
  lines.push('## Token usage');
  const usageStats = sections['usage-stats'];
  if (usageStats && usageStats.totals) {
    const t = usageStats.totals;
    lines.push(`- Total requests: **${t.requests}**`);
    lines.push(`- Total tokens: **${t.totalTokens.toLocaleString()}**`);
    lines.push(`- Prompt tokens: **${t.promptTokens.toLocaleString()}**`);
    lines.push(`- Completion tokens: **${t.completionTokens.toLocaleString()}**`);
    lines.push(`- Estimated cost: **$${t.costEstimate.toFixed(4)}**`);
    lines.push(`- Errors: **${t.errors}**`);
  } else {
    lines.push('*Token usage data not available.*');
  }
  lines.push('');

  // ── Footer ──
  lines.push('---');
  lines.push('_Generated by BizarHarness v4.8.0 — Weekly Digest_');

  return lines.join('\n');
}

/**
 * Save a digest to disk.
 *
 * @param {object} opts
 * @param {string} opts.markdown  — the markdown content
 * @param {string} opts.weekStart — YYYY-MM-DD for the filename
 * @param {string} [opts.projectRoot] — optional, to also write to vault
 * @returns {{ ok: boolean, paths: string[] }}
 */
export async function saveDigest({ markdown, weekStart, projectRoot }) {
  ensureDir(DIGESTS_DIR);
  const paths = [];

  // Primary: digests dir
  const primaryPath = digestPath(weekStart);
  writeFileSync(primaryPath, markdown, 'utf8');
  paths.push(primaryPath);

  // Update the index
  const index = loadIndex();
  const st = statSync(primaryPath);
  const existingIdx = index.digests.findIndex((d) => d.weekStart === weekStart);
  const entry = {
    id: buildDigestId(),
    weekStart,
    createdAt: new Date().toISOString(),
    sizeBytes: st.size,
    path: primaryPath,
    filename: digestFilename(weekStart),
  };
  if (existingIdx >= 0) {
    index.digests[existingIdx] = { ...index.digests[existingIdx], ...entry };
  } else {
    index.digests.push(entry);
  }
  index.digests.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  saveIndex(index);

  // Secondary: project vault
  if (projectRoot) {
    const vaultDigestsDir = join(projectRoot, '.obsidian', 'digests');
    if (existsSync(join(projectRoot, '.obsidian'))) {
      ensureDir(vaultDigestsDir);
      const vaultFile = join(vaultDigestsDir, digestFilename(weekStart));
      writeFileSync(vaultFile, markdown, 'utf8');
      paths.push(vaultFile);
    }
  }

  return { ok: true, paths };
}

/**
 * List available digests, sorted by weekStart descending.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @returns {Array<{ path: string, weekStart: string, createdAt: string, sizeBytes: number }>}
 */
export async function listDigests({ limit = 20 } = {}) {
  const index = loadIndex();
  return index.digests.slice(0, Math.max(1, limit));
}

/**
 * Read a digest by its file path.
 *
 * @param {string} filePath
 * @returns {{ content: string, weekStart: string, sizeBytes: number, path: string } | null}
 */
export async function getDigest(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf8');
    const st = statSync(filePath);
    const fn = basename(filePath);
    const m = fn.match(/weekly-(\d{4}-\d{2}-\d{2})/);
    const weekStart = m ? m[1] : null;
    return { content, weekStart, sizeBytes: st.size, path: filePath };
  } catch {
    return null;
  }
}

/**
 * Delete a digest by its file path.
 *
 * @param {string} filePath
 * @returns {{ ok: boolean, error?: string }}
 */
export async function deleteDigest(filePath) {
  if (!filePath) return { ok: false, error: 'no path provided' };
  const fn = basename(filePath);
  const m = fn.match(/weekly-(\d{4}-\d{2}-\d{2})/);
  const weekStart = m ? m[1] : null;

  if (weekStart) {
    const index = loadIndex();
    index.digests = index.digests.filter((d) => d.weekStart !== weekStart);
    saveIndex(index);
  }

  try {
    if (existsSync(filePath)) unlinkSync(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Generate and save a weekly digest in one call.
 *
 * @param {object} opts
 * @param {string} [opts.weekStart]
 * @param {string} [opts.weekEnd]
 * @param {string} [opts.projectRoot]
 * @param {boolean} [opts.dryRun]  — if true, just return without saving
 * @returns {Promise<object>}
 */
export async function generateAndSave({ weekStart, weekEnd, projectRoot, dryRun = false } = {}) {
  const result = await generateWeeklyDigest({ weekStart, weekEnd, projectRoot, dryRun });
  if (dryRun) return result;
  const saveResult = await saveDigest({ markdown: result.markdown, weekStart: result.weekStart, projectRoot });
  return { ...result, saveResult };
}

// ── Test reset (for tests only) ─────────────────────────────────────────────

/**
 * Wipe all digest data. For test isolation only.
 */
export function __resetStoreForTests() {
  try {
    const index = loadIndex();
    for (const d of index.digests) {
      try { unlinkSync(d.path); } catch { /* ignore */ }
    }
    try { unlinkSync(INDEX_FILE); } catch { /* ignore */ }
  } catch { /* ignore */ }
}
