/**
 * src/server/projects-store.mjs
 *
 * v3.0.0 — Per-project state registry.
 *
 * Project identification: the project's path basename (e.g.,
 * `/home/user/myapp` → `myapp`). If the basename collides, the full path
 * becomes the id.
 *
 * Storage:
 *   ~/.config/opencode/projects.json         — registry (list + active id)
 *   ~/.config/opencode/projects/<id>/        — per-project data dir
 *     tasks.json, plans.json, schedules.json, mods.json, state.json,
 *     sessions/ (chat sessions)
 *
 * The bizar core runtime (bizar package) and the dashboard both call into
 * this module. All file ops are defensive — missing files / parse errors
 * are silent.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { readdir as readdirAsync, stat as statAsync } from 'node:fs/promises';
import { join, basename, dirname, resolve as pathResolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const OPENCODE_DIR = join(HOME, '.config', 'opencode');
const PROJECTS_FILE = join(OPENCODE_DIR, 'projects.json');
const PROJECTS_DIR = join(OPENCODE_DIR, 'projects');

/**
 * v3.6.0 — Markers that identify a directory as a "project root".
 *
 * If a directory contains any of these (or the dotdir form of them),
 * the scan treats it as a project and registers it. Kept in sync with
 * the documentation shown in the Add Project dialog.
 */
export const PROJECT_ROOT_MARKERS = [
  '.git',
  '.bizar',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
];

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

function ensureProjectsDir() {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  mkdirSync(OPENCODE_DIR, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function loadRegistry() {
  const data = safeReadJSON(PROJECTS_FILE, null);
  if (!data || typeof data !== 'object') {
    return { projects: [], active: null };
  }
  if (!Array.isArray(data.projects)) data.projects = [];
  return data;
}

function saveRegistry(reg) {
  ensureProjectsDir();
  atomicWriteJson(PROJECTS_FILE, reg);
}

function projectIdFromPath(path) {
  const b = basename(path);
  return b || 'project';
}

function projectDir(id) {
  return join(PROJECTS_DIR, id);
}

function readProjectFile(id, name, fallback) {
  const file = join(projectDir(id), name);
  return safeReadJSON(file, fallback);
}

function writeProjectFile(id, name, data) {
  ensureProjectsDir();
  const dir = projectDir(id);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, name), data);
}

function uniqueProjectId(absPath, reg) {
  const existingByPath = reg.projects.find((p) => p.path === absPath);
  if (existingByPath?.id) return existingByPath.id;
  const baseId = projectIdFromPath(absPath);
  const same = reg.projects.find((p) => p.id === baseId);
  if (!same || same.path === absPath) return baseId;
  return `${baseId}-${randomBytes(3).toString('hex')}`;
}

/**
 * Public API.
 */
export const projectsStore = {
  HOME,
  OPENCODE_DIR,
  PROJECTS_DIR,
  PROJECTS_FILE,

  /** Return the full registry. */
  list() {
    const reg = loadRegistry();
    // Augment with disk status (active/inactive/error)
    const out = (reg.projects || []).map((p) => {
      let status = 'inactive';
      if (p.path && existsSync(p.path)) {
        status = p.id === reg.active ? 'active' : 'inactive';
      } else if (p.path) {
        status = 'error';
      }
      return { ...p, status };
    });
    return { projects: out, active: reg.active };
  },

  /** Add a project by absolute path. Returns the new project entry. */
  add(path, name) {
    if (!path || typeof path !== 'string') {
      throw new Error('path is required');
    }
    const reg = loadRegistry();
    const absPath = pathResolve(path);
    const id = uniqueProjectId(absPath, reg);
    const existing = reg.projects.find((p) => p.id === id);
    const now = new Date().toISOString();
    if (existing) {
      existing.path = absPath;
      existing.lastAccessed = now;
      saveRegistry(reg);
      return existing;
    }
    const entry = {
      id,
      name: name || id,
      path: absPath,
      lastAccessed: now,
      status: 'inactive',
      summary: '',
    };
    reg.projects.push(entry);
    if (!reg.active) reg.active = id;
    saveRegistry(reg);
    // Make sure the per-project dir exists
    ensureProjectsDir();
    mkdirSync(projectDir(id), { recursive: true });
    return entry;
  },

  /** Remove a project from the registry. Per-project data is NOT deleted. */
  remove(id) {
    const reg = loadRegistry();
    reg.projects = reg.projects.filter((p) => p.id !== id);
    if (reg.active === id) reg.active = reg.projects[0]?.id || null;
    saveRegistry(reg);
    return true;
  },

  /** Switch the active project. Returns the new active entry or null. */
  activate(id) {
    const reg = loadRegistry();
    const found = reg.projects.find((p) => p.id === id);
    if (!found) return null;
    reg.active = id;
    found.lastAccessed = new Date().toISOString();
    saveRegistry(reg);
    return found;
  },

  /** Get the active project entry, or null. */
  active() {
    const reg = loadRegistry();
    return reg.projects.find((p) => p.id === reg.active) || null;
  },

  /** Touch the lastAccessed timestamp. */
  touch(id) {
    const reg = loadRegistry();
    const found = reg.projects.find((p) => p.id === id);
    if (found) {
      found.lastAccessed = new Date().toISOString();
      saveRegistry(reg);
    }
  },

  /**
   * v3.0.4 — Auto-detect the user's current working directory.
   *
   * If `cwd` is not already registered, add it. If no active project
   * exists, set it as active. Idempotent: safe to call on every server
   * startup, and safe to call multiple times.
   *
   * Returns the resulting active project entry, or null if `cwd` was
   * not a string / could not be resolved.
   */
  autoDetect({ cwd } = {}) {
    if (!cwd || typeof cwd !== 'string') return null;
    const abs = pathResolve(cwd);
    const reg = loadRegistry();
    const id = uniqueProjectId(abs, reg);
    const existing = reg.projects.find((p) => p.id === id);
    const now = new Date().toISOString();
    if (existing) {
      // Keep the existing path/name in sync if the cwd moved, but
      // do not stomp on a user-edited name.
      existing.path = abs;
      existing.lastAccessed = now;
      // Don't change the active project — the user already chose one.
      saveRegistry(reg);
      return existing;
    }
    const entry = {
      id,
      name: basename(abs) || id,
      path: abs,
      lastAccessed: now,
      status: 'inactive',
      summary: '',
    };
    reg.projects.push(entry);
    if (!reg.active) reg.active = id;
    saveRegistry(reg);
    // Make sure the per-project dir exists so the rest of the server
    // can write to it without further checks.
    ensureProjectsDir();
    mkdirSync(projectDir(id), { recursive: true });
    return entry;
  },

  /**
   * v3.6.0 — Walk a directory and add any subdirectory that looks
   * like a project root as a registered project. Idempotent: paths
   * already in the registry are skipped silently.
   *
   * Detection: a directory is a "project root" if it contains any
   * of `PROJECT_ROOT_MARKERS` (see the exported list at the top of
   * this file). We do NOT recurse into a detected project — the
   * scan is intentionally one level deep so a checked-out `node_modules`
   * inside a project doesn't get re-registered.
   *
   * @param {string} rootDir
   * @param {object} [opts]
   * @param {number} [opts.maxDepth=1]   — currently unused; reserved for future two-level scans.
   * @returns {Promise<{ added: Array<{id: string, path: string, name: string}>, skipped: number, scanned: number, error?: string }>}
   */
  async scanDirectory(rootDir, { maxDepth = 1 } = {}) {
    const result = { added: [], skipped: 0, scanned: 0 };
    if (!rootDir || typeof rootDir !== 'string') {
      result.error = 'rootDir must be a non-empty string';
      return result;
    }
    void maxDepth; // Reserved for future two-level scans.
    const absRoot = pathResolve(rootDir);

    try {
      // Confirm the root is a directory before reading its children.
      const rootStat = await statAsync(absRoot);
      if (!rootStat || !rootStat.isDirectory()) {
        result.error = 'rootDir is not a directory';
        return result;
      }

      const children = await readdirAsync(absRoot, { withFileTypes: true });
      for (const child of children) {
        // Only descend into directories. Skip symlinks so we don't
        // accidentally pull in something outside the configured root.
        if (!child.isDirectory() || child.isSymbolicLink()) continue;
        result.scanned += 1;
        const childPath = pathResolve(absRoot, child.name);

        // Check for any project-root marker. Stat each one in a
        // try/catch so a single permission error doesn't sink the
        // entire scan.
        let isProject = false;
        for (const marker of PROJECT_ROOT_MARKERS) {
          try {
            const s = await statAsync(pathResolve(childPath, marker));
            if (s && (s.isDirectory() || s.isFile())) {
              isProject = true;
              break;
            }
          } catch {
            // ENOENT / EACCES / EPERM on the marker — keep looking.
          }
        }
        if (!isProject) continue;

        try {
          // Snapshot the registry *before* `add()` so we can tell
          // whether the entry already existed. The existing add()
          // doesn't expose this distinction (it always bumps
          // lastAccessed), so we have to peek.
          const before = loadRegistry();
          const existed = before.projects.some(
            (p) => p.path === childPath || p.id === basename(childPath),
          );
          const entry = this.add(childPath);
          if (existed) {
            result.skipped += 1;
          } else {
            result.added.push({ id: entry.id, path: entry.path, name: entry.name });
          }
        } catch {
          // `add()` throws only on truly invalid input. Don't fail
          // the whole scan — count and continue.
          result.skipped += 1;
        }
      }
    } catch (err) {
      result.error = (err && err.message) || String(err);
    }
    return result;
  },

  /** Per-project file helpers. */
  readProjectFile,
  writeProjectFile,
  projectDir,

  /** Return path to the per-project data dir; ensure it exists. */
  ensureProjectDir(id) {
    ensureProjectsDir();
    const dir = projectDir(id);
    mkdirSync(dir, { recursive: true });
    return dir;
  },

  /** Generate a short random id with prefix. */
  genId(prefix = 'id') {
    return prefix + '_' + randomBytes(6).toString('hex').slice(0, 10);
  },
};
