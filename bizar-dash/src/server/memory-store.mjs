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

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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
 * @param {string} vaultRoot
 * @param {string} relPath
 * @returns {string | null} — resolved absolute path, or null if unsafe
 */
function resolveSafe(vaultRoot, relPath) {
  if (!relPath || relPath.includes('\0')) return null;
  const abs = pathResolve(vaultRoot, relPath);
  const rel = relative(vaultRoot, abs);
  if (rel.startsWith('..') || abs !== pathResolve(abs)) return null;
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
 * @param {{ namespace?: string }} [opts]
 * @returns {Array<{ relPath: string, mtime: number, size: number, frontmatter: Record<string, unknown>, body: string, schemaValid: boolean }>}
 */
export function listNotes(projectRoot, opts = {}) {
  const { vaultRoot } = resolveVault(projectRoot);
  if (!existsSync(vaultRoot)) return [];

  const namespace = opts.namespace || '';
  const searchRoot = namespace ? join(vaultRoot, namespace) : vaultRoot;
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
 * @returns {{ relPath: string, frontmatter: Record<string, unknown>, body: string, raw: string, mtime: number, size: number, schemaValid: boolean } | null}
 */
export function readNote(projectRoot, relPath) {
  const { vaultRoot } = resolveVault(projectRoot);
  const filePath = resolveSafe(vaultRoot, relPath);
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
 * @returns {boolean}
 */
export function deleteNote(projectRoot, relPath) {
  const { vaultRoot } = resolveVault(projectRoot);
  const filePath = resolveSafe(vaultRoot, relPath);
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
