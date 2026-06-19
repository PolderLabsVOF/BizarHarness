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
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const OPENCODE_DIR = join(HOME, '.config', 'opencode');
const PROJECTS_FILE = join(OPENCODE_DIR, 'projects.json');
const PROJECTS_DIR = join(OPENCODE_DIR, 'projects');

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
  writeFileSync(PROJECTS_FILE, JSON.stringify(reg, null, 2) + '\n', 'utf8');
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
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + '\n', 'utf8');
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
    const id = projectIdFromPath(path);
    const reg = loadRegistry();
    const existing = reg.projects.find((p) => p.id === id);
    const now = new Date().toISOString();
    if (existing) {
      existing.path = path;
      existing.lastAccessed = now;
      saveRegistry(reg);
      return existing;
    }
    const entry = {
      id,
      name: name || id,
      path,
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
