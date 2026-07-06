/**
 * src/server/memory-store.mjs
 *
 * MarkdownMemoryStore — reads/writes Obsidian-compatible `.md` notes with YAML
 * frontmatter for the Bizar Memory Service. Supports three modes:
 *   local-only  — vault at <projectRoot>/.obsidian/
 *   managed    — vault at ~/.bizar_memory/<repoName>/projects/<projectId>/
 *   linked     — alias for managed
 *
 * The project namespace directory is created LAZY on first writeNote, not at
 * initVault time (F7 invariant).
 *
 * v5.x — Default vault root relocated from `~/.local/share/bizar/memory` to
 * `~/.bizar_memory` per issue #5. The old path still works if `BIZAR_MEMORY_VAULT`
 * is set; on first run, `ensureVaultExists()` emits a one-time notice when the
 * old path exists and the new one doesn't, but does NOT auto-migrate (too
 * risky to move user data without consent).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, lstatSync, unlinkSync } from 'node:fs';
import { execFileSync as _execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve as pathResolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter, serializeFrontmatter } from './yaml.mjs';
import { validateNote } from './memory-schema.mjs';
import { scan as scanSecrets, hasHighFindings } from './memory-secrets.mjs';
import { atomicWriteJson, safeReadJSON, safeReadText } from '../../../cli/atomic.mjs';
import * as memoryGit from './memory-git.mjs';
import { warn as loggerWarn } from './logger.mjs';

/**
 * Resolve the `git` binary path once at module load time.
 *
 * When the dashboard runs under systemd, PATH typically does not include
 * /usr/bin — this helper finds git's absolute path so that all
 * execFileSync calls work regardless of the process's environment.
 *
 * @returns {string} absolute path to git, or 'git' as a best-effort fallback
 */
function resolveGitBinary() {
  try {
    const out = _execFileSync('which', ['git'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (out) return out;
  } catch { /* which not available or failed */ }

  const fallbacks = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/opt/git/bin/git'];
  for (const f of fallbacks) {
    try {
      _execFileSync(f, ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      return f;
    } catch { /* keep looking */ }
  }

  return 'git';
}

/** Cached absolute path to the git binary. */
const GIT_BIN = resolveGitBinary();

/** Wrapper that always uses the resolved GIT_BIN path. */
function execFileSync(args, opts) {
  return _execFileSync(GIT_BIN, args, opts);
}

const HOME = homedir();

/**
 * Default vault root — auto-created on first use.
 * Override with BIZAR_MEMORY_VAULT env var.
 *
 * v5.x — moved from `~/.local/share/bizar/memory` to `~/.bizar_memory` so the
 * vault lives at a memorable, top-level location in the user's home.
 */
export const DEFAULT_MEMORY_VAULT = join(HOME, '.bizar_memory');

/**
 * v5.x — Legacy vault path kept for migration detection only. The old
 * `~/.local/share/bizar/memory` location is no longer the default; if a
 * user still has notes there, `ensureVaultExists()` logs a one-time
 * notice pointing them at the migration command.
 */
export const LEGACY_MEMORY_VAULT = join(HOME, '.local', 'share', 'bizar', 'memory');

/**
 * Default git remote — set via BIZAR_MEMORY_GIT_REMOTE to enable sync.
 */
export const DEFAULT_GIT_REMOTE = process.env.BIZAR_MEMORY_GIT_REMOTE || null;

const BIZAR_MEMORY_ROOT = join(HOME, '.bizar_memory');

/**
 * Return the effective vault root for the default memory vault.
 * Override with BIZAR_MEMORY_VAULT env var.
 *
 * @returns {string}
 */
export function currentVault() {
  return process.env.BIZAR_MEMORY_VAULT || DEFAULT_MEMORY_VAULT;
}

/**
 * Ensure the default memory vault directory exists and is git-initialised.
 * Idempotent — calling multiple times is safe.
 *
 * v5.x — On first call with a fresh default vault, if the legacy
 * `~/.local/share/bizar/memory` path exists and the new
 * `~/.bizar_memory` doesn't, log a one-time migration notice. We do
 * NOT auto-migrate: the user owns the data and may have already moved
 * it, or may want to keep the old path via `BIZAR_MEMORY_VAULT`.
 *
 * @returns {string} the vault path that was ensured
 */
export function ensureVaultExists() {
  const vault = currentVault();
  if (!existsSync(vault)) {
    // v5.x — Migration notice: legacy path exists, new default does not.
    // Only emit when the user is using the default (no env override) and
    // the new path doesn't exist yet.
    if (
      !process.env.BIZAR_MEMORY_VAULT &&
      vault === DEFAULT_MEMORY_VAULT &&
      existsSync(LEGACY_MEMORY_VAULT)
    ) {
      console.warn(
        `[memory-store] Detected a legacy memory vault at ${LEGACY_MEMORY_VAULT}.\n` +
          `[memory-store] The default location has moved to ${DEFAULT_MEMORY_VAULT}.\n` +
          `[memory-store] To keep using the old vault, set BIZAR_MEMORY_VAULT=${LEGACY_MEMORY_VAULT}.\n` +
          `[memory-store] To migrate, move the contents manually: ` +
          `mv ${LEGACY_MEMORY_VAULT}/* ${DEFAULT_MEMORY_VAULT}/\n` +
          `[memory-store] (not auto-migrated — please review before moving user data).`,
      );
    }
    mkdirSync(vault, { recursive: true, mode: 0o700 });
    if (!existsSync(join(vault, '.git'))) {
      try {
        execFileSync(['init'], { cwd: vault, stdio: 'pipe' });
        execFileSync(['config', 'user.email', 'bizar@localhost'], { cwd: vault, stdio: 'pipe' });
        execFileSync(['config', 'user.name', 'BizarHarness'], { cwd: vault, stdio: 'pipe' });
      } catch (err) {
        loggerWarn('failed to init git in vault', { vault, err: err.message });
      }
    }
  }
  return vault;
}

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
 * v6.x — `vaultRoot` is now always the GENERAL vault root (e.g. `~/.bizar_memory`).
 * A new `projectVaultRoot` field carries the project-specific subdirectory for
 * note storage in managed/linked mode (`~/.bizar_memory/projects/<projectId>`).
 * This distinction lets the UI display the general root while the store still
 * writes notes to the correct project subdirectory.
 *
 * @param {string} projectRoot
 * @returns {{ mode: string, projectId: string, vaultRoot: string, projectVaultRoot: string, repoPath: string | null, configDir: string, gitRemote: string | null, branch: string, lightragDir: string, namespaces: object }}
 */
export function resolveVault(projectRoot) {
  const { config } = loadConfig(projectRoot);
  const mr = config.memoryRepo || {};
  const mode = mr.mode || config.mode || 'local-only';
  const projectId = config.projectId || projectRoot.split('/').pop() || 'unknown';
  const branch = mr.branch || config.branch || 'main';
  const gitRemote = mr.remote || config.gitRemote || null;

  let vaultRoot;
  let projectVaultRoot;
  let repoPath;
  if (mode === 'local-only') {
    vaultRoot = join(projectRoot, '.obsidian');
    projectVaultRoot = vaultRoot;
    repoPath = null;
  } else {
    // managed or linked — path may be absolute, ~-relative, or a sibling of projectRoot
    const rawPath = mr.path || config.repoName || join(projectRoot, '.bizar', 'memory');
    const expanded = rawPath.startsWith('~') ? join(HOME, rawPath.slice(1)) : rawPath;
    repoPath = expanded;
    vaultRoot = expanded; // v6.x — general root, e.g. ~/.bizar_memory
    projectVaultRoot = join(expanded, 'projects', projectId); // project-specific subdirectory
  }

  const configDir = join(projectRoot, '.bizar');
  const lightragDir = join(projectRoot, '.bizar', 'memory-cache');
  const namespaces = config.namespaces || {
    project: `projects/${projectId}`,
    global: 'global/bizar',
    user: `users/${process.env.USER || process.env.USERNAME || 'local'}`,
  };

  return { mode, projectId, vaultRoot, projectVaultRoot, repoPath, configDir, gitRemote, branch, lightragDir, namespaces };
}

/**
 * Resolve the absolute path of a namespace root.
 *
 * For `project`, returns projectVaultRoot (the directory where project notes
 * are stored: `<vaultRoot>/projects/<projectId>` in managed mode, or
 * `<projectRoot>/.obsidian` in local-only mode). For `global` and `user`,
 * returns `<vaultRoot>/<namespaces.X>` — these namespaces live at the vault
 * root level, not inside the project subdirectory.
 *
 * Routing: writeNote/readNote/deleteNote use this to determine where files
 * live. Project relPaths go to projectVaultRoot; global/ and users/ relPaths
 * go to vaultRoot-based paths.
 *
 * @param {{ mode: string, vaultRoot: string, projectVaultRoot: string, namespaces: object }} vaultInfo
 * @param {'project'|'global'|'user'} namespace
 * @returns {string|null} absolute path, or null if the namespace is unknown
 */
export function resolveNamespaceRoot(vaultInfo, namespace) {
  if (namespace === 'project') return vaultInfo.projectVaultRoot;
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
        execFileSync(['init', '-b', 'main'], { cwd: repoPath, stdio: 'pipe' });
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
          execFileSync(['add', '.gitignore'], { cwd: repoPath });
          execFileSync(['commit', '-m', 'chore: initial .gitignore for memory repo'], {
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
  const { projectVaultRoot } = resolveVault(projectRoot);
  const root = opts.root || projectVaultRoot;
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
  const { vaultRoot, projectVaultRoot } = resolveVault(projectRoot);
  // When opts.root is explicitly provided, use it. Otherwise route based on
  // namespace so reads find notes where writeNote placed them.
  let root;
  if (opts.root) {
    root = opts.root;
  } else {
    const isProjectNamespace = !relPath.startsWith('global/') && !relPath.startsWith('users/');
    root = isProjectNamespace ? projectVaultRoot : vaultRoot;
  }
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
  const { vaultRoot, projectVaultRoot } = resolveVault(projectRoot);

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

  // Determine the effective vault root based on namespace.
  // Project notes (relPaths that don't start with global/ or users/) go under
  // projectVaultRoot. Global and user notes go under vaultRoot.
  // This matches the layout resolveNamespaceRoot returns for each namespace.
  const isProjectNamespace = !relPath.startsWith('global/') && !relPath.startsWith('users/');
  const noteVaultRoot = isProjectNamespace ? projectVaultRoot : vaultRoot;

  // Build file content
  const filePath = resolveSafe(noteVaultRoot, relPath);
  if (!filePath) {
    throw new Error(`Invalid note path: ${relPath}`);
  }

  // Lazily create the namespace directory (not created at initVault)
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
  const { vaultRoot, projectVaultRoot } = resolveVault(projectRoot);
  // When opts.root is explicitly provided, use it. Otherwise route based on
  // namespace so deletes find notes where writeNote placed them.
  let root;
  if (opts.root) {
    root = opts.root;
  } else {
    const isProjectNamespace = !relPath.startsWith('global/') && !relPath.startsWith('users/');
    root = isProjectNamespace ? projectVaultRoot : vaultRoot;
  }
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

  const { vaultRoot, projectVaultRoot } = resolveVault(projectRoot);

  // Collect notes from all namespaces by walking vaultRoot (which contains
  // projects/<id>/, global/, and users/ as siblings). This finds project,
  // global, and user notes in a single scan. relPaths returned are vaultRoot-
  // relative (e.g. "projects/<id>/decisions/foo.md" or "global/bizar/foo.md").
  // For project notes, strip the "projects/<id>/" prefix so the relPath matches
  // what writeNote uses (projectVaultRoot-relative).
  const projectPrefix = join('projects', projectVaultRoot.split('/').pop());
  const allNotes = listNotes(projectRoot, { root: vaultRoot });

  const results = [];
  for (const note of allNotes) {
    let relPath = note.relPath;
    if (relPath.startsWith(projectPrefix)) {
      relPath = relPath.slice(projectPrefix.length + 1);
    }
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
    results.push({ relPath, snippet, score, mtime: note.mtime });
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

  const { vaultRoot, projectVaultRoot, mode, branch } = resolveVault(projectRoot);
  if (!projectVaultRoot || !existsSync(projectVaultRoot)) {
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
        const gs = gitStatus(projectVaultRoot);
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

// ── v5.5.2 Legacy config migration ─────────────────────────────────────────
//
// When the user upgrades from pre-v5.5.2, their `.bizar/memory.json` may
// still point `git.repoPath` at the legacy path
// (`~/.local/share/bizar/memory/bizar-memory`). The new default vault root
// is `~/.bizar_memory/bizar-memory`. This helper detects the stale path and
// auto-corrects the config so all git checks work immediately after upgrade.
//
// Behaviour:
//   - Only migrates if the legacy path doesn't exist but the new one does.
//   - Only migrates if `git.repoPath` is explicitly set in the config.
//   - Idempotent — once migrated, the new path exists and the check is a
//     no-op on subsequent boots.
//   - Returns { migrated: true } only on actual change; { migrated: false }
//     for all other cases (already correct, not applicable, or failure).
//
// Called once at dashboard startup from server.mjs.

/**
 * Detect and fix a stale `git.repoPath` pointing at the legacy vault location.
 *
 * @param {string} projectRoot — project root (where `.bizar/memory.json` lives)
 * @returns {{ migrated: boolean, from?: string, to?: string, error?: string }}
 */
export function migrateLegacyGitRepoPath(projectRoot) {
  const configPath = join(projectRoot, '.bizar', 'memory.json');
  let raw;
  try {
    raw = safeReadJSON(configPath, null);
  } catch {
    return { migrated: false };
  }
  if (!raw) return { migrated: false };

  const gitBlock = raw.git || raw.memoryRepo || {};
  const currentRepoPath = gitBlock.repoPath;
  if (!currentRepoPath || typeof currentRepoPath !== 'string') return { migrated: false };

  const expanded = currentRepoPath.startsWith('~')
    ? join(HOME, currentRepoPath.slice(1))
    : currentRepoPath;

  // Only migrate when the configured path doesn't exist but the new default does.
  if (existsSync(expanded)) return { migrated: false };

  const newDefault = join(DEFAULT_MEMORY_VAULT, 'bizar-memory');
  if (!existsSync(newDefault)) return { migrated: false };

  // Verify the new path is actually a git repo before migrating.
  if (!existsSync(join(newDefault, '.git'))) return { migrated: false };

  // Apply the fix: update gitBlock.repoPath (or memoryRepo.repoPath) to newDefault.
  try {
    const updated = JSON.parse(JSON.stringify(raw));
    if (!updated.git) updated.git = {};
    if (!updated.memoryRepo) updated.memoryRepo = {};
    updated.git.repoPath = newDefault;
    updated.memoryRepo.path = newDefault;
    atomicWriteJson(configPath, updated);
    console.warn(
      `[memory-store] Auto-migrated git.repoPath from legacy path\n` +
        `[memory-store]   FROM: ${expanded}\n` +
        `[memory-store]   TO:   ${newDefault}\n` +
        `[memory-store] Please restart the dashboard to pick up the new path.`,
    );
    return { migrated: true, from: expanded, to: newDefault };
  } catch (err) {
    return { migrated: false, error: err.message };
  }
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
 * Build a wikilink link graph from all .md notes in the vault.
 *
 * Nodes: one per note (id = relPath, label = title or basename).
 * Edges: one per wikilink [[Target]] found in note bodies.
 *
 * @param {{ projectRoot: string, vaultPath?: string|null, limit?: number }} opts
 * @returns {{ nodes: Array<{id:string,label:string,type:string,size:number,group:string}>, edges: Array<{source:string,target:string,type:string,weight:number}> }}
 */
export function getObsidianLinkGraph({ projectRoot, vaultPath = null, limit = 200 }) {
  const { vaultRoot } = resolveVault(projectRoot);
  const root = vaultPath || vaultRoot;
  const nodesMap = new Map(); // id → node
  const edges = [];

  // Collect all notes.
  const notes = listNotesForGraph(root);
  const sliced = notes.slice(0, limit);

  for (const note of sliced) {
    if (!nodesMap.has(note.relPath)) {
      nodesMap.set(note.relPath, {
        id: note.relPath,
        label: note.frontmatter?.title || note.relPath.split('/').pop()?.replace(/\.md$/i, '') || note.relPath,
        type: 'note',
        size: 1,
        group: note.relPath.split('/')[0] || 'root',
      });
    }

    // Extract wikilinks from body.
    const WIKILINK_RE = /\[\[([^\]\n|]+?)(?:\|[^\]\n]+?)?(?:#[^\]\n]+?)?\]\]/g;
    const body = note.body || '';
    let m;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      const target = raw.split('#')[0].trim().split('/').pop() || raw;
      // Resolve to a note id (basename match).
      const targetId = resolveWikilinkTarget(target, notes);
      if (targetId && targetId !== note.relPath) {
        edges.push({
          source: note.relPath,
          target: targetId,
          type: 'links_to',
          weight: 1,
        });
        // Ensure target node exists.
        if (!nodesMap.has(targetId)) {
          nodesMap.set(targetId, {
            id: targetId,
            label: target,
            type: 'note',
            size: 1,
            group: targetId.split('/')[0] || 'root',
          });
        }
      }
    }
  }

  return {
    nodes: [...nodesMap.values()].slice(0, limit),
    edges: edges.slice(0, limit * 3),
  };
}

/**
 * List notes from a specific root path (not the project vault root).
 * Used by getObsidianLinkGraph for scanning arbitrary vaults.
 */
function listNotesForGraph(scanRoot) {
  if (!existsSync(scanRoot)) return [];
  const out = [];
  function walk(dir, prefix) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(full, rel);
      } else if (e.name.endsWith('.md')) {
        try {
          const raw = readFileSync(full, 'utf8');
          const { frontmatter, body } = parseFrontmatter(raw);
          out.push({ relPath: rel, frontmatter, body });
        } catch { /* skip */ }
      }
    }
  }
  walk(scanRoot, '');
  return out;
}

/**
 * Resolve a wikilink target (e.g. "My Note" or "subdir/My Note") to a note id.
 * Uses basename matching (Obsidian semantics).
 */
function resolveWikilinkTarget(targetName, notes) {
  const normalized = targetName.replace(/\.md$/i, '').toLowerCase();
  // Try exact relPath match first.
  for (const n of notes) {
    const base = n.relPath.replace(/\.md$/i, '').toLowerCase();
    if (base === normalized || base.endsWith('/' + normalized)) {
      return n.relPath;
    }
  }
  // Fallback: basename-only match.
  for (const n of notes) {
    const base = n.relPath.split('/').pop()?.replace(/\.md$/i, '').toLowerCase();
    if (base === normalized) {
      return n.relPath;
    }
  }
  return null;
}

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
