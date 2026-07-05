/**
 * src/server/memory-obsidian.mjs
 *
 * v4.7.0 — Obsidian-flavoured façade for the Bizar Memory Service.
 *
 * The Memory tab treats Obsidian as one of four memory sources (alongside
 * LightRAG, git, and semantic search). This module gives that source a
 * single import surface that the dashboard can hit without re-deriving the
 * vault layout or wikilink semantics from raw `memory-store` calls.
 *
 * The Obsidian CRUD itself lives in `memory-store.mjs` — re-exporting from
 * there keeps the schema/secret/git-side-effects behaviour in one place.
 * This façade adds:
 *   - tree()         — recursive folder tree for the Memory tab browser
 *   - listBacklinks() — wikilink reverse index
 *   - linkGraph()     — node/edge dump for graph visualisation
 *   - diffVault()     — quick textual diff of two notes
 *
 * No new state, no new files on disk — these are all derived from existing
 * memory-store primitives.
 */

import { statSync, readdirSync, existsSync } from 'node:fs';
import { join, basename as pathBasename, relative } from 'node:path';
import {
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  searchVault,
  findBacklinks as _findBacklinks,
  vaultStats,
  resolveVault,
} from './memory-store.mjs';

// ── Re-exports (verbatim) ──────────────────────────────────────────────────

export {
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  searchVault,
  vaultStats,
  resolveVault,
};

// ── Folder tree ────────────────────────────────────────────────────────────

/**
 * Build a recursive folder tree of the vault, useful for the Memory tab
 * folder browser. Each node is either a folder (with children) or a leaf
 * (with size + mtime).
 *
 * @param {string} projectRoot
 * @param {{ maxDepth?: number }} [opts]
 * @returns {{
 *   name: string,
 *   path: string,
 *   type: 'folder'|'note',
 *   size?: number,
 *   mtime?: number,
 *   children?: Array<ReturnType<typeof tree>>,
 * }|null}
 */
export function tree(projectRoot, { maxDepth = 6 } = {}) {
  const info = vaultStats(projectRoot);
  if (!info.exists || !info.vaultRoot || !existsSync(info.vaultRoot)) return null;
  return buildNode(info.vaultRoot, info.vaultRoot, maxDepth, 0);
}

function buildNode(absPath, vaultRoot, maxDepth, depth) {
  const stat = statMaybe(absPath);
  const name = pathBasename(absPath) || absPath;
  const rel = relative(vaultRoot, absPath).split('\\').join('/');

  if (stat && stat.isFile()) {
    return {
      name: name.replace(/\.md$/i, ''),
      path: rel || name,
      type: 'note',
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  }

  // Directory
  const children = [];
  if (depth < maxDepth) {
    let entries;
    try {
      entries = readdirSync(absPath, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childPath = join(absPath, e.name);
      children.push(buildNode(childPath, vaultRoot, maxDepth, depth + 1));
    }
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return {
    name,
    path: rel,
    type: 'folder',
    children,
  };
}

function statMaybe(p) {
  try { return statSync(p); } catch { return null; }
}

// ── Backlinks ──────────────────────────────────────────────────────────────

/**
 * List notes that link TO `targetRelPath` via wikilinks.
 *
 * @param {string} projectRoot
 * @param {string} targetRelPath
 * @returns {Array<{ fromRelPath: string, fromTitle: string, snippet: string, mtime: number }>}
 */
export function listBacklinks(projectRoot, targetRelPath) {
  return _findBacklinks(projectRoot, targetRelPath);
}

// ── Link graph ─────────────────────────────────────────────────────────────

/**
 * Build a simple node/edge representation of wikilinks across the vault,
 * suitable for the Memory tab link-graph visualizer.
 *
 * Each node is a note (identified by relPath). Each edge is a wikilink
 * reference from one note to another. Self-links and dangling links
 * (wikilinks to non-existent notes) are included with `dangling: true`.
 *
 * @param {string} projectRoot
 * @param {{ limit?: number }} [opts]
 * @returns {{ nodes: Array<{ id: string, label: string, mtime: number }>, edges: Array<{ from: string, to: string, raw: string, dangling: boolean }> }}
 */
export function linkGraph(projectRoot, { limit = 500 } = {}) {
  const notes = listNotes(projectRoot);
  const known = new Set();
  for (const n of notes) known.add(n.relPath.replace(/\.md$/i, ''));

  const nodes = notes.slice(0, limit).map((n) => ({
    id: n.relPath,
    label: n.frontmatter?.title || pathBasename(n.relPath).replace(/\.md$/i, ''),
    mtime: n.mtime,
  }));

  const edges = [];
  const WIKILINK_RE = /\[\[([^\]\n|#]+?)(?:#[^\]\n|]+?)?(?:\|[^\]\n]+?)?\]\]/g;

  for (const note of notes) {
    const body = note.body || '';
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      const target = resolveWikilinkTarget(raw, note.relPath);
      if (!target) continue;
      const dangling = !known.has(target);
      edges.push({ from: note.relPath, to: `${target}.md`, raw, dangling });
      if (edges.length >= limit * 4) break;
    }
    if (edges.length >= limit * 4) break;
  }

  return { nodes, edges };
}

/**
 * Resolve a wikilink target string against Obsidian's rules.
 * Returns the relPath-without-extension if the target exists, or `null` if
 * the wikilink is empty / unparseable.
 */
function resolveWikilinkTarget(raw, fromRelPath) {
  if (!raw) return null;
  const stripped = raw.split('#')[0].split('|')[0].trim();
  if (!stripped) return null;
  if (stripped.includes('/')) return stripped.replace(/\.md$/i, '');
  return stripped.replace(/\.md$/i, '');
}

// ── Diff (textual) ─────────────────────────────────────────────────────────

/**
 * Lightweight textual diff between two notes. Returns { from, to, lines }.
 * `lines` is an array of { kind: 'same'|'add'|'del', text } entries.
 *
 * Used by the Memory → Git Sync panel to show the working-tree diff of
 * a single file. Not a full Myers diff — just a sorted-set diff which is
 * good enough for "what changed?" UI.
 *
 * @param {string} projectRoot
 * @param {string} fromPath — '' for "no previous version"
 * @param {string} toPath
 */
export function diffVault(projectRoot, fromPath, toPath) {
  const from = fromPath ? readNote(projectRoot, fromPath) : null;
  const to = toPath ? readNote(projectRoot, toPath) : null;
  const fromLines = splitLines(from?.body || '');
  const toLines = splitLines(to?.body || '');

  const fromSet = new Set(fromLines);
  const toSet = new Set(toLines);

  const lines = [];
  for (const t of toLines) {
    if (!fromSet.has(t)) lines.push({ kind: 'add', text: t });
    else lines.push({ kind: 'same', text: t });
  }
  for (const f of fromLines) {
    if (!toSet.has(f)) lines.push({ kind: 'del', text: f });
  }

  return { from: fromPath || null, to: toPath || null, lines };
}

function splitLines(s) {
  if (!s) return [];
  return s.split(/\r?\n/).filter((l) => l.length > 0);
}