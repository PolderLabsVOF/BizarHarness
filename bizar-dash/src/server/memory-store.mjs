/**
 * src/server/memory-store.mjs
 *
 * MarkdownMemoryStore — reads/writes Obsidian-compatible `.md` notes with YAML
 * frontmatter for the Bizar Memory Service. Supports three modes:
 *   local-only  — vault at <projectRoot>/.obsidian/
 *   managed    — vault at ~/.local/share/bizar/memory/<repoName>/projects/<projectId>/
 *   linked     — alias for managed
 *
 * The project namespace directory is created LAZY on first writeNote, not at
 * initVault time (F7 invariant).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, lstatSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve as pathResolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter, serializeFrontmatter } from './yaml.mjs';
import { validateNote } from './memory-schema.mjs';
import { scan as scanSecrets, hasHighFindings } from './memory-secrets.mjs';
import { atomicWriteJson, safeReadJSON, safeReadText } from '../../../cli/atomic.mjs';
import * as memoryGit from './memory-git.mjs';

const HOME = homedir();
const BIZAR_MEMORY_ROOT = join(HOME, '.local', 'share', 'bizar', 'memory');

/**
 * Path safety: reject any relPath that would escape the vault root.
 *
 * Defenses (in order):
 *   1. Empty / null-byte injection → reject.
 *   2. Explicit segment check for `..` and absolute path prefixes → reject
 *      before path.resolve normalizes them away. The check is on SEGMENTS
 *      (`..` separated by `/` or `\`), so filenames like `my..note.md` are
 *      still allowed.
 *   3. Post-resolve check: the resulting absolute path must be inside
 *      vaultRoot (relative path must not start with `..`).
 *   4. Symlink guard: if the resolved path is a pre-existing symlink, refuse.
 *      This blocks an attacker who placed a symlink inside the vault pointing
 *      outside from writing/reading through it.
 *
 * Known limitation: the symlink guard is not TOCTOU-safe. A swap between
 * lstatSync and the subsequent read/write/delete is still possible. For a
 * full TOCTOU fix the read/write/delete would need to use O_NOFOLLOW and
 * operate on an open fd, not a path. This is acceptable for the current
 * threat model (the vault is a per-user directory, not a multi-tenant FS).
 *
 * @param {string} vaultRoot
 * @param {string} relPath
 * @returns {string | null} — resolved absolute path, or null if unsafe
 */
function resolveSafe(vaultRoot, relPath) {
  if (!relPath || relPath.includes('\0')) return null;
  // Segment-level check: reject any `..` segment or absolute-path prefix
  // BEFORE path.resolve normalizes them away. This explicitly rejects
  // paths like `notes/../escape.md`, while still allowing filenames like
  // `my..note.md` (the substring `..` inside a single segment is fine).
  const segments = relPath.split(/[\\/]+/);
  if (segments.includes('..') || segments[0] === '') return null;
  const abs = pathResolve(vaultRoot, relPath);
  const rel = relative(vaultRoot, abs);
  if (rel.startsWith('..') || abs !== pathResolve(abs)) return null;
  // Symlink guard (see note above re: TOCTOU). Note: existsSync follows
  // symlinks, so we MUST use lstatSync directly — existsSync + isSymbolicLink
  // misses dangling symlinks (target doesn't exist). lstatSync returns a
  // Stats object even for dangling symlinks; catch only unexpected errors
  // (e.g. EACCES on the parent directory).
  try {
    if (lstatSync(abs).isSymbolicLink()) return null;
  } catch {
    // Path doesn't exist or parent dir inaccessible — not a symlink,
    // proceed. (A fresh write won't traverse a symlink because the
    // symlink itself doesn't exist yet at write time.)
  }
  return abs;
}

/**
 * Read the per-project memory config file (.bizar/memory.json).
 *
 * @param {string} projectRoot
 * @returns {{ exists: boolean, config: Record<string, unknown>, error?: string }}
 */
export function loadConfig(projectRoot) {
  const configPath = join(projectRoot, '.bizar', 'memory.json');
  const raw = safeReadJSON(configPath, null);
  if (raw === null) {
    return {
      exists: false,
      config: {
        mode: 'local-only',
        projectId: projectRoot.split('/').pop() || 'unknown',
        repoName: '',
      },
    };
  }
  return { exists: true, config: raw };
}

/**
 * Write the per-project memory config file.
 *
 * @param {string} projectRoot
 * @param {Record<string, unknown>} config
 * @returns {{ ok: boolean, error?: string }}
 */
export function saveConfig(projectRoot, config) {
  try {
    const configDir = join(projectRoot, '.bizar');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    const configPath = join(configDir, 'memory.json');
    atomicWriteJson(configPath, config);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Resolve the effective vault root, namespaces, and related paths based on mode.
 *
 * @param {string} projectRoot
 * @returns {{ mode: string, projectId: string, vaultRoot: string, repoPath: string | null, configDir: string, gitRemote: string | null, branch: string, lightragDir: string, namespaces: object }}
 */
export function resolveVault(projectRoot) {
  const { config } = loadConfig(projectRoot);
  const mr = config.memoryRepo || {};
  const mode = mr.mode || config.mode || 'local-only';
  const projectId = config.projectId || projectRoot.split('/').pop() || 'unknown';
  const branch = mr.branch || config.branch || 'main';
  const gitRemote = mr.remote || config.gitRemote || null;

  let vaultRoot;
  let repoPath;
  if (mode === 'local-only') {
    vaultRoot = join(projectRoot, '.obsidian');
    repoPath = null;
  } else {
    // managed or linked — path may be absolute, ~-relative, or a sibling of projectRoot
    const rawPath = mr.path || config.repoName || join(projectRoot, '.bizar', 'memory');
    const expanded = rawPath.startsWith('~') ? join(HOME, rawPath.slice(1)) : rawPath;
    repoPath = expanded;
    vaultRoot = join(expanded, 'projects', projectId);
  }

  const configDir = join(projectRoot, '.bizar');
  const lightragDir = join(projectRoot, '.bizar', 'memory-cache');
  const namespaces = config.namespaces || {
    project: `projects/${projectId}`,
    global: 'global/bizar',
    user: `users/${process.env.USER || process.env.USERNAME || 'local'}`,
  };

  return { mode, projectId, vaultRoot, repoPath, configDir, gitRemote, branch, lightragDir, namespaces };
}

/**
 * Resolve the absolute path of a namespace root.
 *
 * For `project`, returns vaultRoot (the existing default). For `global` and
 * `user`, returns `<vaultRoot>/<namespaces.global|user>` in both modes —
 * `writeNote('global/bizar/foo.md', …)` already places files there in both
 * local-only and managed mode, so this matches the on-disk layout that
 * existing callers rely on.
 *
 * (Note: an earlier draft distinguished local-only vs managed, putting
 * global under `<repoPath>/global/bizar` in managed mode. That diverged from
 * where writeNote actually creates the file, which is always under
 * vaultRoot. This implementation matches the on-disk reality.)
 *
 * @param {{ mode: string, vaultRoot: string, namespaces: object }} vaultInfo
 * @param {'project'|'global'|'user'} namespace
 * @returns {string|null} absolute path, or null if the namespace is unknown
 */
export function resolveNamespaceRoot(vaultInfo, namespace) {
  if (namespace === 'project') return vaultInfo.vaultRoot;
  const ns = vaultInfo.namespaces?.[namespace];
  if (!ns) return null;
  return join(vaultInfo.vaultRoot, ns);
}

/**
 * Initialize the vault for a project. In local-only mode, creates .obsidian/
 * and standard subdirectories. In managed mode, the shared repo is assumed to
 * already exist; this function only ensures the .bizar/memory.json is set up.
 *
 * NOTE: The project namespace directory (projects/<id>/) is NOT created here.
 * It is created lazily on first writeNote (F7 invariant).
 *
 * @param {string} projectRoot
 * @returns {{ ok: boolean, vaultRoot: string, created: string[], error?: string }}
 */
export function initVault(projectRoot) {
  const { config } = loadConfig(projectRoot);
  const mr = config.memoryRepo || {};
  const mode = mr.mode || config.mode || 'local-only';
  const created = [];

  if (mode === 'local-only') {
    const vaultRoot = join(projectRoot, '.obsidian');
    const subdirs = ['daily', 'decisions', 'patterns', 'api', 'tasks', 'global', 'users'];
    if (!existsSync(vaultRoot)) {
      mkdirSync(vaultRoot, { recursive: true });
      created.push('.obsidian/');
    }
    for (const sub of subdirs) {
      const subPath = join(vaultRoot, sub);
      if (!existsSync(subPath)) {
        mkdirSync(subPath, { recursive: true });
        created.push(`.obsidian/${sub}/`);
      }
    }
    return { ok: true, vaultRoot, created };
  } else {
    // managed / linked — create the shared repo at repoPath with `git init`
    const { repoPath, vaultRoot } = resolveVault(projectRoot);
    if (!existsSync(repoPath)) {
      mkdirSync(repoPath, { recursive: true });
      created.push(repoPath);
    }
    // git init if not already a git repo
    const isGit = existsSync(join(repoPath, '.git'));
    if (!isGit) {
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'pipe' });
        created.push(`${repoPath}/.git/`);
      } catch (err) {
        return { ok: false, vaultRoot, created, error: `git init failed: ${err.message}` };
      }
      // Write and commit a .gitignore for runtime artifacts
      const gitignorePath = join(repoPath, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath,
          '# Lock files — runtime state, not memory\n' +
          '**/.sync.lock\n' +
          '**/*.pid\n' +
          '**/*.log\n' +
          '**/.DS_Store\n' +
          '\n' +
          '# Local-only metadata\n' +
          '**/.bizar-memory/cache/\n' +
          '**/.bizar-memory/index-ledger.local.json\n',
          'utf8');
        created.push(`${repoPath}/.gitignore`);
        try {
          execFileSync('git', ['add', '.gitignore'], { cwd: repoPath });
          execFileSync('git', ['commit', '-m', 'chore: initial .gitignore for memory repo'], {
            cwd: repoPath,
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: 'Bizar Memory',
              GIT_AUTHOR_EMAIL: 'bizar-memory@local',
              GIT_COMMITTER_NAME: 'Bizar Memory',
              GIT_COMMITTER_EMAIL: 'bizar-memory@local',
            },
          });
        } catch (e) {
          // best-effort; not fatal
        }
      }
    }
    // Ensure projects/, global/, users/ exist so writeNote can find them without
    // creating the project-specific namespace (F7 invariant — only the projects/<id>
    // subdirectory is created lazily on first writeNote)
    const projectsDir = join(repoPath, 'projects');
    if (!existsSync(projectsDir)) {
      mkdirSync(projectsDir, { recursive: true });
      created.push(`${repoPath}/projects/`);
    }
    const globalDir = join(repoPath, 'global', 'bizar');
    if (!existsSync(globalDir)) {
      mkdirSync(globalDir, { recursive: true });
      created.push(`${repoPath}/global/bizar/`);
    }
    const usersDir = join(repoPath, 'users');
    if (!existsSync(usersDir)) {
      mkdirSync(usersDir, { recursive: true });
      created.push(`${repoPath}/users/`);
    }
    return { ok: true, vaultRoot, created };
  }
}

/**
 * List all notes in the vault. Returns enriched note metadata.
 *
 * @param {string} projectRoot
 * @param {{ namespace?: string, root?: string }} [opts]
 *   `namespace`: subdirectory under `root` to walk (e.g. `projects/<id>`).
 *   `root`:      override the root used as the walking base. Defaults to
 *                `vaultRoot` from resolveVault. Used by namespace helpers
 *                in cli/memory.mjs to list global / user notes.
 * @returns {Array<{ relPath: string, mtime: number, size: number, frontmatter: Record<string, unknown>, body: string, schemaValid: boolean }>}
 */
export function listNotes(projectRoot, opts = {}) {
  const { vaultRoot } = resolveVault(projectRoot);
  const root = opts.root || vaultRoot;
  if (!existsSync(root)) return [];

  const namespace = opts.namespace || '';
  const searchRoot = namespace ? join(root, namespace) : root;
  if (!existsSync(searchRoot)) return [];

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
          const raw = readFileSync(full, 'utf8');
          const { frontmatter, body } = parseFrontmatter(raw);
          const { valid } = validateNote(frontmatter, body);
          out.push({ relPath: rel, mtime: st.mtimeMs, size: st.size, frontmatter, body, schemaValid: valid });
        } catch { /* skip unreadable */ }
      }
    }
  }
  walk(searchRoot, '');
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Read a single note by relative path. Returns null if not found.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @param {{ root?: string }} [opts]  optional override for the root used by
 *                                    resolveSafe; defaults to vaultRoot
 * @returns {{ relPath: string, frontmatter: Record<string, unknown>, body: string, raw: string, mtime: number, size: number, schemaValid: boolean } | null}
 */
export function readNote(projectRoot, relPath, opts = {}) {
  const vaultInfo = resolveVault(projectRoot);
  const root = opts.root || vaultInfo.vaultRoot;
  const filePath = resolveSafe(root, relPath);
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const st = statSync(filePath);
    const { frontmatter, body } = parseFrontmatter(raw);
    const { valid } = validateNote(frontmatter, body);
    return { relPath, frontmatter, body, raw, mtime: st.mtimeMs, size: st.size, schemaValid: valid };
  } catch {
    return null;
  }
}

/**
 * Write a note. Validates frontmatter, scans for secrets, writes the file.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @param {{ frontmatter: Record<string, unknown>, body: string }} note
 * @returns {{ relPath: string, frontmatter: Record<string, unknown>, body: string, raw: string, mtime: number, size: number, schemaValid: boolean }}
 * @throws {Error} if schema validation fails or HIGH-severity secret found
 */
export function writeNote(projectRoot, relPath, { frontmatter, body }) {
  const { vaultRoot } = resolveVault(projectRoot);

  // Validate frontmatter
  const { valid, errors, warnings } = validateNote(frontmatter, body);
  if (!valid) {
    const err = new Error(`schema validation failed: ${errors.join('; ')}`);
    err.code = 'SCHEMA_VALIDATION_FAILED';
    throw err;
  }

  // Scan for secrets
  const secretResult = scanSecrets(body);
  if (hasHighFindings(secretResult)) {
    const snippets = secretResult.findings
      .filter((f) => f.severity === 'HIGH')
      .map((f) => `line ${f.line}: ${f.snippet}`)
      .join('\n');
    const err = new Error(`HIGH-severity secret detected:\n${snippets}`);
    err.code = 'SECRET_DETECTED';
    err.findings = secretResult.findings;
    throw err;
  }

  // Build file content
  const filePath = resolveSafe(vaultRoot, relPath);
  if (!filePath) {
    throw new Error(`Invalid note path: ${relPath}`);
  }

  // Lazily create the project namespace directory (F7 — not created at initVault)
  const nsDir = dirname(filePath);
  if (!existsSync(nsDir)) {
    mkdirSync(nsDir, { recursive: true });
  }

  const yamlBlock = serializeFrontmatter(frontmatter);
  const content = `---\n${yamlBlock}\n---\n\n${body}`;
  writeFileSync(filePath, content, 'utf8');

  // Auto-commit the written file to git (if configured).
  // The lock serializes commits, not writes — concurrent writes will each
  // trigger their own commit, which is the intended behaviour.
  (() => {
    try {
      if (!memoryGit.isGitInstalled()) return;
      const { config } = loadConfig(projectRoot);
      if (config.mode === 'local-only') return;
      if (config.git?.autoCommitOnMemoryWrite !== true) return;
      const lockResult = memoryGit.acquireLock(vaultRoot);
      if (!lockResult || lockResult.error) return; // skip if locked or error
      try {
        memoryGit.addFile(vaultRoot, relPath);
        const summary = frontmatter.title || relPath;
        const message = (config.git.commitMessageTemplate || 'memory(BizarHarness): {summary}')
          .replace('{summary}', summary);
        memoryGit.commit(vaultRoot, message, { author: config.git.commitAuthor });
      } finally {
        lockResult.release();
      }
    } catch (err) {
      // Log but never re-throw — the write already succeeded; a failed
      // auto-commit is recoverable on next write or manual commit.
      console.error('[memory-store] autoCommitOnMemoryWrite failed:', err?.message || err);
    }
  })();

  const st = statSync(filePath);
  return {
    relPath,
    frontmatter,
    body,
    raw: content,
    mtime: st.mtimeMs,
    size: st.size,
    schemaValid: true,
  };
}

/**
 * Delete a note by relative path.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @param {{ root?: string }} [opts]  optional override for the root used by
 *                                    resolveSafe; defaults to vaultRoot
 * @returns {boolean}
 */
export function deleteNote(projectRoot, relPath, opts = {}) {
  const vaultInfo = resolveVault(projectRoot);
  const root = opts.root || vaultInfo.vaultRoot;
  const filePath = resolveSafe(root, relPath);
  if (!filePath || !existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

/**
 * Full-text search across vault notes.
 *
 * @param {string} projectRoot
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ relPath: string, snippet: string, score: number, mtime: number }>}
 */
export function searchVault(projectRoot, query, { limit = 25 } = {}) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  const results = [];
  for (const note of listNotes(projectRoot)) {
    const lower = (note.body + ' ' + JSON.stringify(note.frontmatter)).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(t)) score += (lower.split(t).length - 1);
    }
    if (score === 0) continue;
    const idx = lower.indexOf(tokens[0]);
    const start = Math.max(0, idx - 60);
    const end = Math.min(lower.length, idx + 160);
    const snippet = (start > 0 ? '…' : '') + lower.slice(start, end).replace(/\s+/g, ' ').trim();
    results.push({ relPath: note.relPath, snippet, score, mtime: note.mtime });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Scan a single note for secrets.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {{ safe: boolean, findings: Array<{ id: string, severity: string, line: number, snippet: string }> }}
 */
export function scanForSecrets(projectRoot, relPath) {
  const note = readNote(projectRoot, relPath);
  if (!note) return { safe: true, findings: [] };
  return scanSecrets(note.body);
}

/**
 * Validate all notes in the vault against the schema.
 *
 * @param {string} projectRoot
 * @returns {Array<{ relPath: string, errors: string[] }>}
 */
export function validateAll(projectRoot) {
  const notes = listNotes(projectRoot);
  const results = [];
  for (const note of notes) {
    const { errors } = validateNote(note.frontmatter, note.body);
    if (errors.length > 0) {
      results.push({ relPath: note.relPath, errors });
    }
  }
  return results;
}

// ── v4.7.0 — Memory tab helpers ─────────────────────────────────────────────
//
// Lightweight helpers used by the dedicated Memory view: backlinks (wikilink
// reverse index) and a vault-stats summary for the overview card.

/**
 * Find every note in the vault that links TO `targetRelPath` via a wikilink.
 *
 * A wikilink matches one of:
 *   - `[[target]]`
 *   - `[[target|alias]]`
 *   - `[[target#heading]]`
 *   - `[[target#heading|alias]]`
 *
 * The match is by basename without extension (Obsidian's wikilink semantics)
 * AND by full relPath-without-extension, so `[[notes/foo]]` matches
 * `notes/foo.md` and `[[foo]]` matches `foo.md` anywhere in the vault.
 *
 * @param {string} projectRoot
 * @param {string} targetRelPath — the note we want backlinks for
 * @returns {Array<{ fromRelPath: string, fromTitle: string, snippet: string, mtime: number }>}
 */
export function findBacklinks(projectRoot, targetRelPath) {
  if (!targetRelPath) return [];
  const targetBase = basenameOf(targetRelPath).replace(/\.md$/i, '');
  const targetStripped = targetRelPath.replace(/\.md$/i, '');
  if (!targetBase && !targetStripped) return [];

  const out = [];
  const WIKILINK_RE = /\[\[([^\]\n|]+?)(?:\|[^\]\n]+?)?(?:#[^\]\n]+?)?\]\]/g;

  for (const note of listNotes(projectRoot)) {
    if (note.relPath === targetRelPath) continue; // skip self
    const body = note.body || '';
    const matches = [];
    let m;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      const stripped = raw.split('#')[0].trim();
      if (!stripped) continue;
      const baseOnly = stripped.split('/').pop() || stripped;
      if (baseOnly === targetBase || stripped === targetStripped) {
        matches.push({ raw, idx: m.index });
      }
    }
    if (matches.length === 0) continue;

    // Build a snippet around the FIRST match — 80 chars each side.
    const first = matches[0];
    const start = Math.max(0, first.idx - 80);
    const end = Math.min(body.length, first.idx + first.raw.length + 80);
    const snippet = (start > 0 ? '…' : '') +
      body.slice(start, end).replace(/\s+/g, ' ').trim() +
      (end < body.length ? '…' : '');

    out.push({
      fromRelPath: note.relPath,
      fromTitle: note.frontmatter?.title || basenameOf(note.relPath).replace(/\.md$/i, ''),
      snippet,
      mtime: note.mtime,
    });
  }

  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Minimal basename helper — avoids pulling `path.basename` into the bundle. */
function basenameOf(p) {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * High-level stats used by the Memory tab and Overview status card.
 *
 * @param {string} projectRoot
 * @returns {{ exists: boolean, vaultRoot: string, mode: string, noteCount: number, totalSize: number, folderCount: number, folders: string[], lastModified: number|null, gitClean: boolean|null, gitBranch: string|null }}
 */
export function vaultStats(projectRoot) {
  const { exists, config } = loadConfig(projectRoot);
  if (!exists) {
    return {
      exists: false,
      vaultRoot: '',
      mode: 'local-only',
      noteCount: 0,
      totalSize: 0,
      folderCount: 0,
      folders: [],
      lastModified: null,
      gitClean: null,
      gitBranch: null,
    };
  }

  const { vaultRoot, mode, branch } = resolveVault(projectRoot);
  if (!vaultRoot || !existsSync(vaultRoot)) {
    return {
      exists: true,
      vaultRoot: vaultRoot || '',
      mode,
      noteCount: 0,
      totalSize: 0,
      folderCount: 0,
      folders: [],
      lastModified: null,
      gitClean: null,
      gitBranch: branch || config?.branch || 'main',
    };
  }

  const notes = listNotes(projectRoot);
  const totalSize = notes.reduce((acc, n) => acc + (n.size || 0), 0);
  const folders = new Set();
  for (const n of notes) {
    const seg = n.relPath.split('/');
    if (seg.length > 1) folders.add(seg[0]);
  }

  let gitClean = null;
  let gitBranch = null;
  if (mode === 'managed' || mode === 'linked') {
    try {
      const { isGitInstalled, status: gitStatus } = memoryGit;
      if (isGitInstalled()) {
        const gs = gitStatus(vaultRoot);
        gitClean = gs.clean;
        gitBranch = gs.branch;
      }
    } catch {
      // ignore — git is optional
    }
  }

  return {
    exists: true,
    vaultRoot,
    mode,
    noteCount: notes.length,
    totalSize,
    folderCount: folders.size,
    folders: [...folders].sort(),
    lastModified: notes[0]?.mtime || null,
    gitClean,
    gitBranch: gitBranch || branch || config?.branch || 'main',
  };
}

// ── LightRAG integration (v4.1.0) ──────────────────────────────────────────
//
// Re-export the LightRAG orchestrator from the memory-store module so the
// dashboard, CLI, and tests have a single import surface. The actual
// implementation lives in `memory-lightrag.mjs`.

export {
  resolveLightRAGConfig,
  isInstalled as isLightRAGInstalled,
  isRunning as isLightRAGRunning,
  startServer as startLightRAG,
  stopServer as stopLightRAG,
  ensureRunning as ensureLightRAGRunning,
  insertNote as insertLightRAGNote,
  insertAllNotes as insertLightRAGAll,
  reindexVault,
  query as queryLightRAG,
} from './memory-lightrag.mjs';

// ── v4.6.0 LightRAG default model helpers ──────────────────────────────────
//
// Free opencode Zen defaults — no API key required for free-tier models.
// Operators can override per-project via:
//   - env:  BIZAR_LIGHTRAG_LLM, BIZAR_LIGHTRAG_EMBEDDING
//   - config: .bizar/memory.json#lightrag.llmModel / .embeddingModel
//
// The dashboard surfaces these via /api/lightrag/defaults so the
// settings view can show "currently using: opencode/gpt-5-nano (free)".

export const LIGHTRAG_DEFAULT_LLM = 'opencode/gpt-5-nano';
export const LIGHTRAG_DEFAULT_EMBEDDING = 'opencode/text-embedding-3-small';

/**
 * Return the effective LightRAG model defaults, applying env-var
 * overrides on top of the built-in opencode-Zen-free defaults.
 *
 * @returns {{ llm: string, embedding: string, source: 'opencode-free' | 'env', llmSource: 'default' | 'env', embeddingSource: 'default' | 'env' }}
 */
export function getDefaultLightRAGConfig() {
  const llmEnv = typeof process.env.BIZAR_LIGHTRAG_LLM === 'string' && process.env.BIZAR_LIGHTRAG_LLM.trim()
    ? process.env.BIZAR_LIGHTRAG_LLM.trim()
    : null;
  const embEnv = typeof process.env.BIZAR_LIGHTRAG_EMBEDDING === 'string' && process.env.BIZAR_LIGHTRAG_EMBEDDING.trim()
    ? process.env.BIZAR_LIGHTRAG_EMBEDDING.trim()
    : null;
  const llm = llmEnv || LIGHTRAG_DEFAULT_LLM;
  const embedding = embEnv || LIGHTRAG_DEFAULT_EMBEDDING;
  const source = (llmEnv || embEnv) ? 'env' : 'opencode-free';
  return {
    llm,
    embedding,
    source,
    llmSource: llmEnv ? 'env' : 'default',
    embeddingSource: embEnv ? 'env' : 'default',
  };
}
