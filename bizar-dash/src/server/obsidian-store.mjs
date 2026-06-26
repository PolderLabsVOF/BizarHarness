/**
 * src/server/obsidian-store.mjs
 *
 * Per-project Obsidian vault for long-term agent memory. Each project
 * gets an `.obsidian/` directory inside its worktree root. Notes are
 * plain Markdown files git-tracked so the vault survives across clones
 * and machines. Obsidian itself can open the directory as a vault;
 * the agent sees the same files via the API.
 *
 * Conventions
 * ───────────
 *   .obsidian/
 *     ├── vault.json               vault metadata (Obsidian format)
 *     ├── README.md                project-level overview (rendered in dashboard)
 *     ├── INDEX.md                  auto-generated index of all notes
 *     ├── daily/                   daily journal entries
 *     │   └── YYYY-MM-DD.md
 *     ├── decisions/               architecture / design decisions
 *     ├── patterns/                code patterns learned
 *     ├── api/                     API contracts discovered
 *     └── tasks/                   per-task learnings
 *
 * Files are markdown with YAML frontmatter (id, title, tags, created, updated).
 * The dashboard exposes CRUD + search via REST.
 *
 * Why Obsidian and not just SQLite?
 * ──────────────────────────────────
 * 1. Git-trackable, portable, human-readable
 * 2. Renders in Obsidian.app for the user to browse
 * 3. Plugins (graph view, backlinks, dataview) work out of the box
 * 4. Plain markdown so any tool (cat, grep, IDE) can read it
 * 5. Backlinks emerge naturally as agents cross-link notes
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

/**
 * @param {string} projectRoot — absolute path to the project's working dir
 * @returns {string} absolute path to the project's `.obsidian/` dir
 */
export function obsidianVaultDir(projectRoot) {
  return join(projectRoot, '.obsidian');
}

/** Standard subdirectories inside every Obsidian vault. */
const STANDARD_SUBDIRS = ['daily', 'decisions', 'patterns', 'api', 'tasks'];

/**
 * Initialize the vault for a project. Creates `.obsidian/`, the standard
 * subdirectories, a README.md, and a vault.json. Idempotent.
 *
 * @returns {{ vaultDir: string, created: string[] }}
 */
export function initObsidianVault(projectRoot) {
  const vaultDir = obsidianVaultDir(projectRoot);
  const created = [];
  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true });
    created.push('.obsidian/');
  }
  for (const sub of STANDARD_SUBDIRS) {
    const subPath = join(vaultDir, sub);
    if (!existsSync(subPath)) {
      mkdirSync(subPath, { recursive: true });
      created.push(`.obsidian/${sub}/`);
    }
  }
  const readmePath = join(vaultDir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# ${projectRoot.split('/').pop() || 'Project'} — Obsidian Vault\n\n` +
        `Long-term memory for this project's AI agents.\n\n` +
        `## Structure\n\n` +
        `- \`daily/\` — daily journal entries (one file per day)\n` +
        `- \`decisions/\` — architecture / design decisions\n` +
        `- \`patterns/\` — code patterns learned\n` +
        `- \`api/\` — API contracts discovered\n` +
        `- \`tasks/\` — per-task learnings\n\n` +
        `All notes are plain markdown with YAML frontmatter.\n` +
        `Agents maintain this vault automatically.\n`,
      'utf8',
    );
    created.push('.obsidian/README.md');
  }
  const vaultJsonPath = join(vaultDir, 'vault.json');
  if (!existsSync(vaultJsonPath)) {
    writeFileSync(
      vaultJsonPath,
      JSON.stringify(
        {
          name: projectRoot.split('/').pop() || 'Project',
          version: '1.0.0',
          format: 'obsidian-vault',
          createdAt: new Date().toISOString(),
          managedBy: 'bizar-dash',
        },
        null,
        2,
      ),
      'utf8',
    );
    created.push('.obsidian/vault.json');
  }
  return { vaultDir, created };
}

/** Parse a markdown file's YAML frontmatter. Returns { frontmatter, body }. */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const frontmatter = {};
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) frontmatter[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { frontmatter, body };
}

function serializeFrontmatter(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${typeof v === 'string' && v.includes(':') ? `"${v}"` : v}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Recursively walk the vault directory and return all .md files.
 * @returns {Array<{ path: string, relPath: string, mtime: number, size: number }>}
 */
export function listVaultNotes(projectRoot) {
  const vaultDir = obsidianVaultDir(projectRoot);
  if (!existsSync(vaultDir)) return [];
  const out = [];
  function walk(dir, prefix) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(full, rel);
      } else if (e.name.endsWith('.md')) {
        try {
          const st = statSync(full);
          out.push({ path: full, relPath: rel, mtime: st.mtimeMs, size: st.size });
        } catch { /* ignore */ }
      }
    }
  }
  walk(vaultDir, '');
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Read a single note by its path relative to the vault root.
 * Returns { relPath, frontmatter, body, raw, mtime, size } or null.
 */
export function readVaultNote(projectRoot, relPath) {
  const vaultDir = obsidianVaultDir(projectRoot);
  const filePath = resolveSafe(vaultDir, relPath);
  if (!filePath || !existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf8');
  const st = statSync(filePath);
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    relPath,
    frontmatter,
    body,
    raw,
    mtime: st.mtimeMs,
    size: st.size,
  };
}

/** Path safety: never let a note path escape the vault dir. */
function resolveSafe(vaultDir, relPath) {
  if (!relPath || relPath.includes('\0')) return null;
  const abs = resolve(vaultDir, relPath);
  const rel = relative(vaultDir, abs);
  if (rel.startsWith('..') || abs !== resolve(abs)) return null;
  return abs;
}

/**
 * Create or update a note. `relPath` is relative to the vault root,
 * e.g. "daily/2026-06-25.md" or "decisions/use-svelte.md".
 * `frontmatter` is a key/value map; `body` is the markdown content.
 */
export function writeVaultNote(projectRoot, relPath, { frontmatter = {}, body = '' } = {}) {
  const vaultDir = obsidianVaultDir(projectRoot);
  if (!existsSync(vaultDir)) initObsidianVault(projectRoot);
  const filePath = resolveSafe(vaultDir, relPath);
  if (!filePath) throw new Error(`Invalid note path: ${relPath}`);
  mkdirSync(dirname(filePath), { recursive: true });
  const fm = {
    id: relPath.replace(/\.md$/, '').replace(/[\\/]/g, '-'),
    title: frontmatter.title || relPath.replace(/\.md$/, '').split('/').pop(),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.join(', ') : (frontmatter.tags || ''),
    created: frontmatter.created || new Date().toISOString(),
    updated: new Date().toISOString(),
    ...frontmatter,
  };
  delete fm.id; delete fm.title; delete fm.tags; delete fm.created; delete fm.updated;
  // Restore the canonical fields explicitly
  const finalFm = {
    id: relPath.replace(/\.md$/, '').replace(/[\\/]/g, '-'),
    title: frontmatter.title || relPath.replace(/\.md$/, '').split('/').pop(),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.join(', ') : (frontmatter.tags || ''),
    created: frontmatter.created || new Date().toISOString(),
    updated: new Date().toISOString(),
    ...frontmatter,
  };
  const content = serializeFrontmatter(finalFm) + '\n' + body;
  writeFileSync(filePath, content, 'utf8');
  return readVaultNote(projectRoot, relPath);
}

/** Delete a note by relative path. */
export function deleteVaultNote(projectRoot, relPath) {
  const filePath = resolveSafe(obsidianVaultDir(projectRoot), relPath);
  if (!filePath || !existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

/** Recursive search across all notes. Returns matching {relPath, snippet, score}. */
export function searchVault(projectRoot, query, { limit = 25 } = {}) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const results = [];
  for (const note of listVaultNotes(projectRoot)) {
    let raw;
    try { raw = readFileSync(note.path, 'utf8'); } catch { continue; }
    const lower = raw.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(t)) score += (lower.split(t).length - 1);
    }
    if (score === 0) continue;
    // Snippet around first match
    const idx = lower.indexOf(tokens[0]);
    const start = Math.max(0, idx - 60);
    const end = Math.min(raw.length, idx + 160);
    const snippet = (start > 0 ? '…' : '') + raw.slice(start, end).replace(/\s+/g, ' ').trim();
    results.push({ relPath: note.relPath, snippet, score, mtime: note.mtime });
    if (results.length >= limit * 4) break;
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Rebuild the auto-generated INDEX.md listing all notes grouped by folder. */
export function rebuildIndex(projectRoot) {
  const vaultDir = obsidianVaultDir(projectRoot);
  if (!existsSync(vaultDir)) return null;
  const notes = listVaultNotes(projectRoot);
  const grouped = {};
  for (const n of notes) {
    const folder = n.relPath.includes('/') ? n.relPath.split('/')[0] : '_root';
    if (!grouped[folder]) grouped[folder] = [];
    grouped[folder].push(n);
  }
  const lines = ['---', 'title: Index', `updated: ${new Date().toISOString()}`, '---', '',
    '# Index', '', 'Auto-generated by the Obsidian vault integration.', ''];
  for (const folder of Object.keys(grouped).sort()) {
    lines.push(`## ${folder}`, '');
    for (const n of grouped[folder].slice(0, 50)) {
      lines.push(`- [[${n.relPath.replace(/\.md$/, '')}]]`);
    }
    if (grouped[folder].length > 50) {
      lines.push(`- _…and ${grouped[folder].length - 50} more_`);
    }
    lines.push('');
  }
  const indexPath = join(vaultDir, 'INDEX.md');
  writeFileSync(indexPath, lines.join('\n'), 'utf8');
  return indexPath;
}

/** Vault summary stats. */
export function vaultStats(projectRoot) {
  const vaultDir = obsidianVaultDir(projectRoot);
  const exists = existsSync(vaultDir);
  if (!exists) {
    return { exists: false, vaultDir, noteCount: 0, totalSize: 0 };
  }
  const notes = listVaultNotes(projectRoot);
  const totalSize = notes.reduce((acc, n) => acc + n.size, 0);
  const folders = new Set(notes.map((n) => n.relPath.split('/')[0]));
  return {
    exists: true,
    vaultDir,
    noteCount: notes.length,
    totalSize,
    folderCount: folders.size,
    folders: [...folders].sort(),
    lastModified: notes[0]?.mtime || null,
  };
}