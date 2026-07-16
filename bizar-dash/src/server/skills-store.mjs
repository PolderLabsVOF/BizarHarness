// src/server/skills-store.mjs
//
// v4.0.0 - Skills registry that scans SKILL.md files from all local
// sources rather than relying on the `skills` CLI npm registry.
//
// Sources (in priority order for conflicts):
//   1. ~/.cline/skills/<name>/SKILL.md    - user-overridable builtins
//   2. ~/.agents/skills/<name>/SKILL.md      - user-added skills
//   3. bizar-dash/skills/<name>/SKILL.md     - BizarHarness shipped
//   4. .agents/skills/<name>/SKILL.md        - project-local
//   5. .cline/skills/<name>/SKILL.md      - project-local
//
// Each SKILL.md is parsed for YAML frontmatter (description:) and
// the first # H1 heading (display name fallback).  No external deps.
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

/** Project root is injected at construction time. */
let PROJECT_ROOT = process.cwd();

export function setProjectRoot(p) { PROJECT_ROOT = p; }

// -- Source directories --------------------------------------------------------

/** All SKILL.md scan roots in priority order (first wins for conflicts). */
function sourceRoots() {
  return [
    { dir: join(HOME, '.cline', 'skills'),   source: 'user'    },
    { dir: join(HOME, '.agents', 'skills'),     source: 'user'    },
    { dir: join(PROJECT_ROOT, 'bizar-dash', 'skills'), source: 'shipped' },
    { dir: join(PROJECT_ROOT, '.agents', 'skills'),   source: 'project' },
    { dir: join(PROJECT_ROOT, '.cline', 'skills'), source: 'project' },
  ];
}

// -- Frontmatter parser (no external deps) ------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Returns { description, name, ...rest } from frontmatter, plus the body.
 */
function parseFrontmatter(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { description: '', name: '', body: raw };

  const fmStr = fmMatch[1];
  const body  = fmMatch[2];
  const fm    = {};

  // Very simple YAML key: value parser (values only - no nested structures)
  for (const line of fmStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    fm[key] = val;
  }

  return {
    description: fm.description || '',
    name:        fm.name        || '',
    body,
    ...fm,
  };
}

/**
 * Extract display name from body: first # Heading or ## Heading.
 * Returns null if none found.
 */
function extractHeading(body) {
  const m = body.match(/^#{1,2}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// -- Core scanner -------------------------------------------------------------

/**
 * Scan one directory for SKILL.md files.
 * Returns an array of parsed skill objects.
 */
function scanDir(dir, source) {
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const mdPath = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(mdPath)) continue;
      let raw;
      try {
        raw = readFileSync(mdPath, 'utf8');
      } catch {
        continue;
      }
      const { description, name: fmName, body } = parseFrontmatter(raw);
      const displayName = fmName || extractHeading(body) || entry.name;
      const relPath = mdPath; // absolute path to the file

      out.push({
        name:        displayName,
        description: description.slice(0, 200),
        source,
        path:        relPath,
        body,        // full body for detail view
        kind:        'skills', // v10.0.6 — annotate for ?kind= filter
        id:          entry.name, // stable id for selection state
      });
    }
  } catch {
    // Directory unreadable - skip
  }
  return out;
}

/** In-memory cache with manual invalidation. */
let _cache    = null;
let _cacheAge = 0;
const CACHE_TTL_MS = 30_000;

function getCache() {
  if (_cache && Date.now() - _cacheAge < CACHE_TTL_MS) return _cache;
  const skills = [];
  for (const { dir, source } of sourceRoots()) {
    skills.push(...scanDir(dir, source));
  }
  _cache    = skills;
  _cacheAge = Date.now();
  return skills;
}

export function invalidateCache() {
  _cache    = null;
  _cacheAge = 0;
}

// -- Fuzzy search (simple includes-based, no external deps) --------------------

function fuzzyMatch(skill, q) {
  const hay = `${skill.name} ${skill.description}`.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/);
  return terms.every((t) => hay.includes(t));
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// -- Public API ----------------------------------------------------------------

export const skillsStore = {
  /** List all skills grouped by source. */
  async list() {
    return getCache();
  },

  /**
   * Fuzzy search by name + description.
   * Returns plain objects - NO ANSI codes, NO formatted terminal output.
   */
  async search(query) {
    const q = (query || '').trim();
    const all = getCache();
    if (!q) return all;
    return all.filter((s) => fuzzyMatch(s, q));
  },

  /**
   * Return a single skill by source + name.
   */
  async get(source, name) {
    const all = getCache();
    return all.find(
      (s) => s.source === source && (s.name === name || s.path.endsWith(`/${name}/SKILL.md`)),
    ) || null;
  },

  /** Force a cache refresh. */
  refresh() {
    invalidateCache();
    return getCache();
  },
};
