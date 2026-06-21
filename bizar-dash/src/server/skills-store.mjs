/**
 * src/server/skills-store.mjs
 *
 * v3.1.0 — Skills registry. Wraps the `skills` CLI (npm i -g skills)
 * and exposes a stable JSON surface for the dashboard.
 *
 *   - list:   skills list --json
 *   - search: skills search <query>   (or local mock)
 *   - install: skills add <pkg>
 *   - disable / enable: edit a small registry under
 *     ~/.config/bizar/skills-state.json so we don't tamper with the
 *     upstream CLI's own state.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const HOME = homedir();
const STATE_FILE = join(HOME, '.config', 'bizar', 'skills-state.json');

// Atomic JSON write: serialize to a sibling temp file, then rename into
// place. `rename` is atomic on POSIX (same filesystem), so a crash
// between write and rename never leaves a half-written / corrupt file.
function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Categories surfaced in the Skills view. Matched against the
 * `category` field returned by `skills list --json`. The CLI's actual
 * output is loosely categorized, so we accept any string.
 */
export const CATEGORIES = [
  { id: 'all', label: 'All', icon: 'sparkles' },
  { id: 'languages', label: 'Programming Languages', icon: 'code' },
  { id: 'frameworks', label: 'Frameworks', icon: 'layers' },
  { id: 'tools', label: 'Tools', icon: 'wrench' },
  { id: 'testing', label: 'Testing', icon: 'flask' },
  { id: 'design', label: 'Design', icon: 'palette' },
  { id: 'reasoning', label: 'Reasoning', icon: 'brain' },
  { id: 'planning', label: 'Planning', icon: 'map' },
  { id: 'gitops', label: 'GitOps', icon: 'git-branch' },
  { id: 'docs', label: 'Docs', icon: 'book' },
];

function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return {};
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    atomicWriteJson(STATE_FILE, state);
  } catch {
    /* best effort */
  }
}

function safeExec(args, { timeoutMs = 8000 } = {}) {
  return execFileP('skills', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })
    .then((r) => r.stdout)
    .catch((err) => {
      // Don't throw — return empty so the UI can fall back to a mock.
      // eslint-disable-next-line no-console
      console.warn('[skills] command failed:', err.message);
      return '';
    });
}

/** Local mock used as a fallback if the CLI isn't installed. */
function mockCatalog() {
  return [
    {
      id: 'anthropics/skills',
      name: 'Anthropic Skills',
      description: 'Curated skill set from Anthropic — Claude prompt patterns, agents, evals.',
      category: 'reasoning',
      source: 'anthropics/skills',
      tags: ['reasoning', 'agents'],
      version: '1.0.0',
      installCmd: 'skills add anthropics/skills',
    },
    {
      id: 'vercel-labs/agent-skills',
      name: 'Vercel Agent Skills',
      description: 'Vercel-Labs agent skill set — React, Next.js, frontend performance.',
      category: 'frameworks',
      source: 'vercel-labs/agent-skills',
      tags: ['react', 'nextjs', 'frontend'],
      version: '1.0.0',
      installCmd: 'skills add vercel-labs/agent-skills',
    },
    {
      id: 'supabase/agent-skills',
      name: 'Supabase Agent Skills',
      description: 'Supabase agent skill set — Postgres, Auth, Edge Functions.',
      category: 'tools',
      source: 'supabase/agent-skills',
      tags: ['postgres', 'auth'],
      version: '1.0.0',
      installCmd: 'skills add supabase/agent-skills',
    },
    {
      id: 'mattpocock/skills',
      name: 'Matt Pocock Skills',
      description: 'TypeScript, TDD, testing patterns from Matt Pocock.',
      category: 'testing',
      source: 'mattpocock/skills',
      tags: ['typescript', 'tdd'],
      version: '1.0.0',
      installCmd: 'skills add mattpocock/skills',
    },
    {
      id: 'cloudflare/skills',
      name: 'Cloudflare Skills',
      description: 'Cloudflare Workers, Durable Objects, Agents SDK.',
      category: 'tools',
      source: 'cloudflare/skills',
      tags: ['cloudflare', 'workers'],
      version: '1.0.0',
      installCmd: 'skills add cloudflare/skills',
    },
    {
      id: 'anthropics/claude-code-skills',
      name: 'Claude Code Skills',
      description: 'Skills for Claude Code — prompt patterns and tool usage.',
      category: 'reasoning',
      source: 'anthropics/claude-code-skills',
      tags: ['claude', 'code'],
      version: '1.0.0',
      installCmd: 'skills add anthropics/claude-code-skills',
    },
  ];
}

function inferCategoryFromTags(tags = []) {
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.some((t) => /react|next|vue|svelte|frontend|tailwind/.test(t))) return 'frameworks';
  if (lower.some((t) => /tdd|test|jest|vitest|playwright|pytest/.test(t))) return 'testing';
  if (lower.some((t) => /postgres|auth|cloudflare|supabase|kubernetes|docker/.test(t))) return 'tools';
  if (lower.some((t) => /design|ui|ux|figma|tailwind|theme/.test(t))) return 'design';
  if (lower.some((t) => /reasoning|agent|claude|gpt|llm|chat/.test(t))) return 'reasoning';
  if (lower.some((t) => /plan|roadmap|architecture/.test(t))) return 'planning';
  if (lower.some((t) => /git|github|gh|ci|deploy/.test(t))) return 'gitops';
  if (lower.some((t) => /doc|readme|wiki|changelog/.test(t))) return 'docs';
  if (lower.some((t) => /python|js|ts|rust|go|kotlin|swift|c\+\+|ruby|java|php/.test(t))) return 'languages';
  return 'tools';
}

export const skillsStore = {
  STATE_FILE,
  CATEGORIES,

  /** List installed skills. */
  async list() {
    const state = loadState();
    const out = await safeExec(['list', '--json']);
    let items = [];
    if (out && out.trim().startsWith('[')) {
      try {
        items = JSON.parse(out);
      } catch {
        items = [];
      }
    } else if (out && out.trim().startsWith('{')) {
      // Some versions return { skills: [...] }
      try {
        const parsed = JSON.parse(out);
        items = parsed.skills || parsed.items || [];
      } catch {
        items = [];
      }
    }
    // If the CLI is not installed or returned nothing, fall back to a
    // minimal local mock so the UI is still useful in dev.
    if (items.length === 0) {
      items = mockCatalog().map((m) => ({ ...m, installed: true, mock: true }));
    }
    return items.map((it) => {
      const id = it.id || it.name || it.source || it.path || 'unknown';
      const name = it.name || id.split('/').pop() || id;
      const tags = Array.isArray(it.tags) ? it.tags : [];
      const category = it.category || inferCategoryFromTags(tags);
      const enabled = state[id]?.enabled !== false; // default enabled
      return {
        id,
        name,
        description: it.description || '',
        category,
        tags,
        version: it.version || '0.0.0',
        source: it.source || id,
        path: it.path || null,
        installed: true,
        enabled,
        mock: !!it.mock,
      };
    });
  },

  /** Search the registry. Falls back to a mock local index. */
  async search(query) {
    const trimmed = (query || '').trim();
    let items = [];
    if (trimmed) {
      const out = await safeExec(['search', trimmed]);
      if (out) {
        try {
          const parsed = JSON.parse(out);
          items = Array.isArray(parsed) ? parsed : parsed.results || parsed.items || [];
        } catch {
          // Fall through to text-mode parse.
          items = out
            .split(/\r?\n/)
            .filter((l) => l.trim())
            .map((l) => ({ name: l.trim(), id: l.trim(), source: l.trim() }));
        }
      }
    }
    if (items.length === 0) {
      // Mock fallback: filter the mock catalog by query.
      const q = trimmed.toLowerCase();
      items = mockCatalog().filter((m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
      );
      if (items.length === 0 && !q) items = mockCatalog();
    }
    return items.map((it) => {
      const id = it.id || it.name || it.source || 'unknown';
      const name = it.name || id.split('/').pop() || id;
      const tags = Array.isArray(it.tags) ? it.tags : [];
      return {
        id,
        name,
        description: it.description || '',
        category: it.category || inferCategoryFromTags(tags),
        tags,
        version: it.version || '0.0.0',
        source: it.source || id,
        installCmd: it.installCmd || `skills add ${id}`,
      };
    });
  },

  /** Install a skill by name/source. */
  async install(name, source) {
    const target = source || name;
    const out = await safeExec(['add', target], { timeoutMs: 60_000 });
    return {
      ok: true,
      name: target,
      output: typeof out === 'string' ? out : String(out || ''),
    };
  },

  /** Disable a skill (kept on disk, not loaded). */
  disable(id) {
    const state = loadState();
    state[id] = { ...(state[id] || {}), enabled: false, disabledAt: Date.now() };
    saveState(state);
    return { ok: true, enabled: false };
  },

  enable(id) {
    const state = loadState();
    state[id] = { ...(state[id] || {}), enabled: true, enabledAt: Date.now() };
    saveState(state);
    return { ok: true, enabled: true };
  },
};
