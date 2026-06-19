/**
 * src/server/mods-loader.mjs
 *
 * v3.0.0 — Mods system for Bizar.
 *
 * A mod is a folder with a `mod.json` manifest. The loader scans
 * `~/.config/bizar/mods/<mod-id>/` and exposes a list of valid mods.
 *
 * Mods can contribute:
 *   - agents    (markdown files with frontmatter)
 *   - commands  (markdown files with frontmatter)
 *   - routes    (Node.js modules that export `register({ app, state })`)
 *   - views     (declarative metadata — actual rendering done by host)
 *   - tui       (declarative metadata)
 *   - hooks     (declarative metadata)
 *
 * For v3 MVP, the loader only:
 *   - Lists installed mods (manifest)
 *   - Enables / disables (writes enabled flag back to mod.json)
 *   - Installs a mod from a local path (copies files into the mods dir)
 *   - Uninstalls (removes the mod folder)
 *
 * The dashboard can render a "Hello" tab for any mod whose manifest type
 * is `view` and that registers a route. v3 keeps this minimal.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');
const MODS_DIR = join(BIZAR_HOME, 'mods');

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

function listModFolders() {
  if (!existsSync(MODS_DIR)) return [];
  return readdirSync(MODS_DIR)
    .map((name) => {
      const full = join(MODS_DIR, name);
      const st = statSync(full);
      if (!st.isDirectory()) return null;
      return { id: name, dir: full };
    })
    .filter(Boolean);
}

function loadMod({ id, dir }) {
  const manifest = safeReadJSON(join(dir, 'mod.json'), null);
  if (!manifest || typeof manifest !== 'object') {
    return {
      id,
      name: id,
      version: '?',
      author: '',
      description: '(no valid mod.json)',
      enabled: false,
      type: 'unknown',
      error: 'missing or invalid mod.json',
      path: dir,
    };
  }
  // Files — list the entry points that exist
  const files = [];
  for (const sub of ['agents', 'commands', 'routes', 'views', 'tui', 'hooks', 'web']) {
    const subPath = join(dir, sub);
    if (existsSync(subPath)) {
      try {
        for (const f of readdirSync(subPath)) {
          files.push({ category: sub, name: f, path: join(sub, f) });
        }
      } catch {
        /* ignore */
      }
    }
  }
  return {
    id: manifest.id || id,
    name: manifest.name || id,
    version: manifest.version || '0.0.0',
    author: manifest.author || '',
    description: manifest.description || '',
    bizar: manifest.bizar || '*',
    type: manifest.type || 'full',
    enabled: manifest.enabled !== false,
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
    entry: manifest.entry || {},
    files,
    path: dir,
    installedAt: manifest.installedAt || null,
  };
}

export const modsLoader = {
  HOME,
  BIZAR_HOME,
  MODS_DIR,

  /** Ensure the mods directory exists. */
  ensureModsDir() {
    mkdirSync(MODS_DIR, { recursive: true });
  },

  /** List all installed mods. */
  list() {
    this.ensureModsDir();
    return listModFolders().map(loadMod);
  },

  /** Read a single mod by id. */
  get(id) {
    const dir = join(MODS_DIR, id);
    if (!existsSync(dir)) return null;
    return loadMod({ id, dir });
  },

  /** Persist a mod's enabled flag to its mod.json. */
  setEnabled(id, enabled) {
    const dir = join(MODS_DIR, id);
    if (!existsSync(dir)) return null;
    const manifest = safeReadJSON(join(dir, 'mod.json'), null);
    if (!manifest) return null;
    manifest.enabled = !!enabled;
    writeFileSync(join(dir, 'mod.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return loadMod({ id, dir });
  },

  /**
   * Install a mod from a local path. Copies the folder into
   * `~/.config/bizar/mods/<id>/`. The id is the source folder's basename.
   */
  installFromPath(sourcePath) {
    if (!existsSync(sourcePath)) {
      throw new Error(`source path does not exist: ${sourcePath}`);
    }
    const st = statSync(sourcePath);
    if (!st.isDirectory()) {
      throw new Error(`source must be a directory: ${sourcePath}`);
    }
    const id = basename(sourcePath);
    const target = join(MODS_DIR, id);
    this.ensureModsDir();
    if (existsSync(target)) {
      throw new Error(`mod "${id}" already installed`);
    }
    // Read the manifest first to verify
    const manifest = safeReadJSON(join(sourcePath, 'mod.json'), null);
    if (!manifest) {
      throw new Error('source has no mod.json manifest');
    }
    cpSync(sourcePath, target, { recursive: true });
    // Stamp installation time
    const fresh = safeReadJSON(join(target, 'mod.json'), {});
    fresh.installedAt = new Date().toISOString();
    fresh.id = fresh.id || id;
    writeFileSync(join(target, 'mod.json'), JSON.stringify(fresh, null, 2) + '\n', 'utf8');
    return loadMod({ id, dir: target });
  },

  /** Remove a mod folder. */
  uninstall(id) {
    const dir = join(MODS_DIR, id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  },

  /** List files inside a mod. */
  listFiles(id) {
    const dir = join(MODS_DIR, id);
    if (!existsSync(dir)) return [];
    const out = [];
    function walk(p, prefix) {
      let entries;
      try {
        entries = readdirSync(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(p, e.name), rel);
        else if (e.isFile()) {
          out.push({ path: rel, size: statSync(join(p, e.name)).size });
        }
      }
    }
    walk(dir, '');
    return out;
  },

  /** Read a file inside a mod (path relative to mod root). */
  readFile(id, relPath) {
    const dir = join(MODS_DIR, id);
    const full = join(dir, relPath);
    if (!full.startsWith(dir)) {
      throw new Error('path escapes mod root');
    }
    if (!existsSync(full)) return null;
    return readFileSync(full, 'utf8');
  },

  /** Write a file inside a mod. */
  writeFile(id, relPath, content) {
    const dir = join(MODS_DIR, id);
    const full = join(dir, relPath);
    if (!full.startsWith(dir)) {
      throw new Error('path escapes mod root');
    }
    mkdirSync(dirnameSafe(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    return true;
  },
};

function dirnameSafe(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '.' : p.slice(0, idx);
}
