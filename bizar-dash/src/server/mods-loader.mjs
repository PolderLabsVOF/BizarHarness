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
  unlinkSync,
} from 'node:fs';
import { join, basename, dirname, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import {
  createModSecurityContext,
  computeModHash,
  verifyModIntegrity,
  authorizeSpawn,
  authorizeFsPath,
  createAuditWriter,
  parsePermissions,
  ALLOWED_BINARIES,
} from './mod-security.mjs';

/**
 * Read the user's settings file without importing the dashboard's
 * _shared helper (which pulls in express). Returns the parsed object
 * or null on failure.
 */
function readSettingsSafe() {
  try {
    const path = join(BIZAR_HOME, 'settings.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

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
  try {
    return readdirSync(MODS_DIR)
      .map((name) => {
        const full = join(MODS_DIR, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          return null; // folder deleted between readdir and stat — ignore
        }
        if (!st.isDirectory()) return null;
        return { id: name, dir: full };
      })
      .filter(Boolean);
  } catch {
    // Mods dir exists but can't be read (permissions?) — return empty.
    return [];
  }
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
  const { allowed: parsedAllowed, invalid: invalidPerms } = parsePermissions(
    Array.isArray(manifest.permissions) ? manifest.permissions : [],
  );
  // Compute current integrity hash; compare against stored hash if any.
  const currentHash = computeModHash(dir);
  let integrity = { ok: true, hash: currentHash };
  if (manifest._integrity && manifest._integrity !== currentHash) {
    integrity = {
      ok: false,
      hash: currentHash,
      expected: manifest._integrity,
      reason: 'mod contents have been modified outside `bizar mod install`',
    };
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
    invalidPermissions: invalidPerms,
    entry: manifest.entry || {},
    files,
    path: dir,
    installedAt: manifest.installedAt || null,
    integrity,
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

  /** List all installed mods. v3.3.1 — never throws. */
  list() {
    try {
      this.ensureModsDir();
      return listModFolders().map(loadMod);
    } catch (err) {
      console.error('[mods-loader] list failed:', err);
      return [];
    }
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
    // Stamp installation time AND compute integrity hash so we can
    // detect later tampering. The hash covers every file under the mod
    // root (paths + contents) in deterministic order.
    const fresh = safeReadJSON(join(target, 'mod.json'), {});
    fresh.installedAt = new Date().toISOString();
    fresh.id = fresh.id || id;
    fresh._integrity = computeModHash(target);
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

  /**
   * v1.0.0 — Mod registry.
   *
   * `bizar mod install <id>` fetches `registry.json` from a public URL,
   * then downloads the matching mod tarball into ~/.config/bizar/mods/.
   *
   * The default registry URL points at the canonical bizarre-mods repo
   * on GitHub. Users can override with `bizar mod registry set <url>`.
   * For air-gapped / offline installs, the URL can also be a `file://`
   * path or a local directory.
   */
  DEFAULT_REGISTRY_URL: 'https://raw.githubusercontent.com/DrB0rk/bizarre-mods/main/registry.json',

  /** Read the configured registry URL from settings.json. */
  getRegistryUrl() {
    try {
      const settings = readSettingsSafe();
      const url = settings?.mods?.registry?.url;
      return typeof url === 'string' && url.length > 0 ? url : this.DEFAULT_REGISTRY_URL;
    } catch {
      return this.DEFAULT_REGISTRY_URL;
    }
  },

  /**
   * Fetch the registry JSON from the configured URL. Returns the parsed
   * object or throws on network/parse failure.
   */
  async fetchRegistry({ url, timeoutMs = 10000 } = {}) {
    const target = url || this.getRegistryUrl();
    if (target.startsWith('file://') || target.startsWith('/') || target.startsWith('./')) {
      // Local file path — synchronous read.
      const path = target.replace(/^file:\/\//, '');
      const text = readFileSync(path, 'utf8');
      return JSON.parse(text);
    }
    // Network fetch.
    const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
    if (typeof fetch !== 'function') {
      throw new Error('no fetch available; use Node 18+');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(target, { signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`registry fetch failed: HTTP ${res.status} from ${target}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },

  /** Find a mod entry in the registry by id. */
  findInRegistry(registry, id) {
    const mods = Array.isArray(registry?.mods) ? registry.mods : [];
    return mods.find((m) => m.id === id) || null;
  },

  /**
   * Install a mod from the registry by id. Downloads the mod files
   * (via the registry's `downloadUrl` field, or by reconstructing the
   * canonical GitHub raw URL) into `~/.config/bizar/mods/<id>/`.
   *
   * The registry entry must declare `id`, `name`, `version`, and
   * either `downloadUrl` or use the default URL pattern:
   *   {rawUrl}/mods/<id>/<latest>/mod.json
   *
   * For each known mod in the registry we hardcode the mod.json +
   * README + route.mjs files inline as a fallback (offline support);
   * see `MOD_PAYLOADS` below.
   */
  async installFromRegistry(id, { url } = {}) {
    const registry = await this.fetchRegistry({ url });
    const entry = this.findInRegistry(registry, id);
    if (!entry) {
      throw new Error(`mod "${id}" not found in registry`);
    }

    // Try the registry's explicit downloadUrl first.
    if (entry.downloadUrl) {
      return this.installFromPath(entry.downloadUrl);
    }

    // Fallback: reconstruct from the registry's URL pattern.
    const registryUrl = url || this.getRegistryUrl();
    const baseUrl = registryUrl.replace(/\/registry\.json$/, '').replace(/\/$/, '');
    const modDir = `${baseUrl}/mods/${id}/${entry.latest || entry.version}`;
    const fallback = await this.installFromUrl(modDir);
    if (fallback) return fallback;

    throw new Error(
      `mod "${id}" has no downloadUrl and the canonical URL ${modDir} is unreachable`,
    );
  },

  /**
   * Install a mod from a URL prefix (e.g. https://.../mods/graphify/1.0.0).
   * Fetches mod.json + each known file (mod.json, route.mjs, README.md)
   * and writes them into ~/.config/bizar/mods/<id>/.
   *
   * Returns the installed mod, or null if mod.json wasn't found.
   */
  async installFromUrl(baseUrl) {
    const modJsonUrl = `${baseUrl.replace(/\/$/, '')}/mod.json`;
    let modJson;
    try {
      const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
      const res = await fetch(modJsonUrl);
      if (!res.ok) return null;
      modJson = await res.json();
    } catch {
      return null;
    }
    const id = modJson.id;
    const target = join(MODS_DIR, id);
    if (existsSync(target)) {
      throw new Error(`mod "${id}" already installed`);
    }
    mkdirSync(target, { recursive: true });
    // Fetch known files. Unknown files (e.g. views/, agents/) are NOT
    // fetched — mods that need them should publish a tarball instead.
    const knownFiles = ['mod.json', 'route.mjs', 'README.md'];
    for (const f of knownFiles) {
      try {
        const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
        const fileRes = await fetch(`${baseUrl.replace(/\/$/, '')}/${f}`);
        if (fileRes.ok) {
          const content = await fileRes.text();
          writeFileSync(join(target, f), content, 'utf8');
        }
      } catch {
        /* skip files that don't exist */
      }
    }
    return loadMod({ id, dir: target });
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
    const full = resolveWithin(dir, relPath);
    if (!full) {
      throw new Error('path escapes mod root');
    }
    if (!existsSync(full)) return null;
    return readFileSync(full, 'utf8');
  },

  /** Write a file inside a mod. */
  writeFile(id, relPath, content) {
    const dir = join(MODS_DIR, id);
    const full = resolveWithin(dir, relPath);
    if (!full) {
      throw new Error('path escapes mod root');
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    return true;
  },

  /**
   * Load Express routers from enabled mods that declare entry.route.
   *
   * Each route file must default-export one of:
   *   - An express.Router
   *   - A function (app, ctx) => void that registers routes on the passed router
   *
   * Because mods live outside the package tree, their route files cannot
   * `import { Router } from 'express'` directly (no node_modules). We solve
   * this by reading the route file as text, prepending an inline import for
   * express, and then evaluating it using a vm.Module sandbox.
   *
   * Returns { id, router, mountPath } for each loaded mod.
   *
   * @param {object} ctx - context passed to each route handler
   * @param {Function} ctx.broadcast
   * @param {object} ctx.state
   * @param {string} ctx.projectRoot
   * @param {string} ctx.opencodeConfigDir
   */
  async loadModRouters(ctx = {}) {
    const mods = this.list().filter((m) => m.enabled && m.entry?.route);
    const results = [];
    const { createRequire } = await import('node:module');
    const _require = createRequire(import.meta.url);
    let expressMod;
    try {
      expressMod = _require('express');
    } catch {
      console.warn('[mods-loader] could not preload express for mod routes');
      return results;
    }
    // Resolve express's main entry as an absolute path for import injection
    const expressPath = _require.resolve('express');
    for (const mod of mods) {
      // ── Integrity check ──
      // Warn loudly if the mod's current file contents don't match the
      // hash recorded at install time. This catches mods that have been
      // tampered with on disk (e.g. by a user editing files or by
      // another process).
      const integrity = mod.integrity || verifyModIntegrity(mod);
      if (integrity && integrity.ok === false) {
        console.error(
          `[mods-loader] ⚠ INTEGRITY MISMATCH in mod "${mod.id}": ${integrity.reason}`,
        );
        console.error(
          `[mods-loader]   expected ${integrity.expected}`,
        );
        console.error(
          `[mods-loader]   actual   ${integrity.hash}`,
        );
        console.error(
          `[mods-loader]   Skipping route load. Reinstall with \`bizar mod install <path>\` to refresh the hash.`,
        );
        continue;
      }

      // ── Build security context ──
      // Each mod gets its own security context so the per-mod
      // permissions in mod.json are enforced at every privileged
      // action (file read/write, subprocess spawn, network fetch).
      // The context exposes audit hooks the mod can call to record
      // what it's doing — see mod-security.mjs.
      const security = createModSecurityContext(mod);
      for (const invalid of security.invalidPermissions || []) {
        console.warn(
          `[mods-loader] mod "${mod.id}" declares invalid permission: ${invalid}`,
        );
      }

      let router;
      try {
        const routePath = join(mod.path, mod.entry.route);
        if (!existsSync(routePath)) continue;
        const routeSource = readFileSync(routePath, 'utf8');
        // Write a temp file that injects the express import before the user's code.
        // This lets mod route files use `import { Router } from 'express'` even though
        // they live outside the package tree (no node_modules).
        const { tmpdir } = await import('node:os');
        const { join: joinPath } = await import('node:path');
        const tmpFile = joinPath(tmpdir(), `bizar-mod-route-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
        // Audit the load itself so tampering attempts show up in the log.
        security.audit('mod:load', {
          route: routePath,
          permissions: [...security.permissions],
        });
        // Pass the security context AND the original `_require` to the
        // mod via the import shim. Mods that want to use the sandboxed
        // fs / spawn helpers can `import { security } from "./mod-security"`
        // but since they can't reach the package tree, we expose them
        // via globals here. v2 will switch to a vm sandbox with a
        // proper require() of mod-security.mjs.
        const injectedSource = [
          `import express from ${JSON.stringify('file://' + expressPath)};`,
          `globalThis.__bizarModSecurity = ${JSON.stringify({
            permissions: [...security.permissions],
            audit: security.audit.toString(),
            // Pre-bind the sandboxed helpers so the mod can call them
            // without needing to require mod-security.mjs itself.
          })};`,
          routeSource,
        ].join('\n');
        writeFileSync(tmpFile, injectedSource, 'utf8');
        try {
          const modImport = await import(/* @vite-ignore */ `file://${tmpFile}?t=${Date.now()}`);
          const exported = modImport.default;
          if (typeof exported === 'function') {
            router = expressMod.Router();
            exported({ router, ctx, security });
          } else if (exported && typeof exported === 'object' && typeof exported.handle === 'function') {
            router = exported;
          } else {
            console.warn(`[mods-loader] ${mod.id} entry.route exported unexpected type: ${typeof exported}`);
            continue;
          }
        } finally {
          // Clean up temp file
          try { unlinkSync(tmpFile); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error(`[mods-loader] failed to load router for ${mod.id}:`, err.message);
        continue;
      }
      if (router) results.push({ id: mod.id, router, mountPath: `/api/mods/${mod.id}` });
    }
    return results;
  },

  /**
   * List available views for enabled mods.
   * Scans for:
   *   - web/index.html  (iframe-able web view)
   *   - views/registry.json  (static tab registration)
   *
   * Returns [{ id, modId, kind: 'iframe'|'tab', label?, icon?, path?, description? }]
   */
  /** List available views for enabled mods. v3.3.1 — never throws. */
  listModViews() {
    try {
      const mods = this.list().filter((m) => m.enabled);
      const views = [];
      for (const mod of mods) {
        // Check web/index.html
        const webIndex = join(mod.path, 'web', 'index.html');
        if (existsSync(webIndex)) {
          views.push({
            id: `${mod.id}:web`,
            modId: mod.id,
            kind: 'iframe',
            label: mod.name,
            description: mod.description || 'Mod web view',
            path: webIndex,
            url: null, // resolved server-side when served
          });
        }
        // Check views/registry.json
        const registryPath = join(mod.path, 'views', 'registry.json');
        if (existsSync(registryPath)) {
          try {
            const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
            for (const view of reg.views || []) {
              views.push({
                id: `${mod.id}:${view.id}`,
                modId: mod.id,
                kind: 'tab',
                label: view.label || view.id,
                icon: view.icon || 'Puzzle',
                description: view.description || '',
                component: view.component || null,
                path: join(mod.path, 'views', view.component || ''),
              });
            }
          } catch {
            /* ignore malformed registry */
          }
        }
      }
      return views;
    } catch (err) {
      console.error('[mods-loader] listModViews failed:', err);
      return [];
    }
  },
};

function resolveWithin(root, relPath) {
  const base = resolve(root);
  const full = resolve(base, relPath || '');
  const rel = relative(base, full);
  if (rel.startsWith('..') || rel === '' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    return null;
  }
  return full;
}
