/**
 * src/server/mods-loader.mjs
 *
 * v3.0.0 — Mods system for Bizar.
 *
 * A mod is a folder with a `mod.json` manifest. The loader scans
 * `~/.config/bizar/mods/<mod-id>/` and exposes a list of valid mods.
 *
 * Mods can contribute:
 *   - agents    (markdown files with frontmatter — installed to cline config)
 *   - commands  (markdown files with frontmatter — installed to cline config)
 *   - INSTRUCTIONS.md (top-level — installed as an cline skill)
 *   - skills/<name>/SKILL.md (installed as cline skills)
 *   - routes    (Node.js modules that export `register({ app, state })`)
 *   - views     (declarative metadata — actual rendering done by host)
 *   - tui       (declarative metadata)
 *   - hooks     (declarative metadata)
 *
 * Mod installation copies agent/command/skill instruction files into the
 * user's cline config (`~/.config/cline/agents/`, `~/.config/cline/commands/`,
 * `~/.cline/skills/`) so they are picked up at session start. Uninstall removes them.
 *
 * For v3 MVP, the loader only:
 *   - Lists installed mods (manifest)
 *   - Enables / disables (writes enabled flag back to mod.json)
 *   - Installs a mod from a local path (copies files into the mods dir)
 *   - Installs mod instructions into cline config
 *   - Uninstalls (removes the mod folder AND the cline-config copies)
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

  /**
   * v4.4.11 — Validate an installed mod without mounting it.
   *
   * Runs after a copy (in `installFromPath` + `installFromRegistry`) and
   * before the install is reported as successful. Returns a structured
   * `{ ok, errors, warnings }` so callers (the API + the CLI + the
   * provisioner) can surface failures consistently.
   *
   * Checks performed:
   *   1. `mod.json` is valid JSON with required fields (id, name, version).
   *   2. `entry.route` (if declared) is a file that exists and is readable.
   *      We pre-parse it with `node --check` to catch syntax errors.
   *   3. Permissions declared in mod.json are validated against the
   *      allowed list (delegates to mod-security.mjs).
   *   4. If `entry.validate` is declared, we dynamic-import that file
   *      and call its `default` or named `validate` export. The hook can
   *      throw to fail the install.
   *
   * Never throws — always returns a structured result.
   */
  async validateModInstallation(id) {
    const errors = [];
    const warnings = [];
    const dir = join(MODS_DIR, id);
    if (!existsSync(dir)) {
      return { ok: false, errors: [`mod directory not found: ${dir}`], warnings };
    }

    // 1. mod.json valid + required fields
    const manifest = safeReadJSON(join(dir, 'mod.json'), null);
    if (!manifest || typeof manifest !== 'object') {
      return {
        ok: false,
        errors: ['mod.json is missing or invalid JSON'],
        warnings,
      };
    }
    for (const field of ['id', 'name', 'version']) {
      if (!manifest[field] || typeof manifest[field] !== 'string') {
        errors.push(`mod.json is missing required field "${field}"`);
      }
    }
    if (manifest.id && manifest.id !== id) {
      errors.push(`mod.json "id" field ("${manifest.id}") does not match the directory name ("${id}")`);
    }

    // 2. entry.route exists + parses
    const entry = manifest.entry || {};
    if (entry.route) {
      const routePath = join(dir, entry.route);
      if (!existsSync(routePath)) {
        errors.push(`entry.route "${entry.route}" does not exist at ${routePath}`);
      } else {
        // Pre-parse the route.mjs with `node --check` to catch syntax
        // errors without executing it. Skipped if node is not available.
        try {
          const { spawnSync } = await import('node:child_process');
          const probe = spawnSync(process.execPath, ['--check', routePath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
          });
          if (probe.status !== 0) {
            // Extract the first error line from the syntax checker
            // output. `node --check` prints something like:
            //   /path/to/route.mjs:5
            //   syntax is wrong here
            //   ^^^
            //   SyntaxError: message
            // We want the last "SyntaxError:" line.
            const stderr = (probe.stderr || '').toString();
            const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
            const errLine = lines.reverse().find((l) => l.toLowerCase().includes('syntaxerror')) || lines[0] || 'unknown';
            errors.push(`entry.route "${entry.route}" has a syntax error: ${errLine}`);
          }
        } catch {
          // node --check unavailable — skip (not fatal)
        }
      }
    }

    // 3. Permissions valid
    if (Array.isArray(manifest.permissions)) {
      const { invalid } = parsePermissions(manifest.permissions);
      for (const p of invalid) {
        warnings.push(`mod declares unknown permission: ${p}`);
      }
    }

    // 4. Optional entry.validate hook
    if (entry.validate) {
      const validatePath = join(dir, entry.validate);
      if (!existsSync(validatePath)) {
        errors.push(`entry.validate "${entry.validate}" does not exist at ${validatePath}`);
      } else {
        try {
          // Dynamic import — the validate hook is opt-in. The mod may
          // export `default` (function) or named export `validate`.
          const mod = await import(/* @vite-ignore */ `file://${validatePath}`);
          const fn = mod.default || mod.validate;
          if (typeof fn !== 'function') {
            warnings.push(
              `entry.validate "${entry.validate}" does not export a function (got ${typeof fn})`,
            );
          } else {
            // Run the validate hook with a 5s timeout. The hook is
            // trusted (it's part of the mod) but we don't want a bad
            // hook to hang the install.
            const result = await Promise.race([
              Promise.resolve()
                .then(() => fn({ mod: manifest, dir }))
                .catch((err) => ({ ok: false, error: err.message })),
              new Promise((resolve) =>
                setTimeout(() => resolve({ ok: false, error: 'validate hook timed out after 5s' }), 5000),
              ),
            ]);
            if (result && result.ok === false) {
              errors.push(`mod validate hook failed: ${result.error || 'unknown'}`);
            }
          }
        } catch (err) {
          errors.push(`failed to load entry.validate "${entry.validate}": ${err.message}`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
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
  async installFromPath(sourcePath) {
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
    // v3.20 — install mod instructions into the user's cline config
    // (agents/, commands/, skills/). This makes the mod's rules binding
    // on every agent at session start.
    installModInstructions(id, target);
    // v4.4.11 — Smoke-test the mod before reporting success. We
    // uninstall on failure so a broken mod doesn't leave a half-
    // copied directory the user has to clean up manually.
    const validation = await this.validateModInstallation(id);
    if (!validation.ok) {
      uninstallModInstructions(id);
      rmSync(target, { recursive: true, force: true });
      const err = new Error(
        `mod "${id}" failed post-install validation: ${validation.errors.join('; ')}`,
      );
      err.validation = validation;
      throw err;
    }
    if (validation.warnings.length > 0) {
      console.warn(
        `[mods-loader] mod "${id}" installed with warnings: ${validation.warnings.join('; ')}`,
      );
    }
    return loadMod({ id, dir: target });
  },

  /** Remove a mod folder. */
  uninstall(id) {
    const dir = join(MODS_DIR, id);
    if (!existsSync(dir)) return false;
    // v3.20 — uninstall mod instructions from cline config FIRST
    // (so we know which files were installed by this mod).
    uninstallModInstructions(id);
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
  DEFAULT_REGISTRY_URL: 'https://raw.githubusercontent.com/DrB0rk/bizar-mods/main/registry.json',

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

    // v3.20.3 — Fix install-from-registry: `downloadUrl` is a URL, not
    // a local path. installFromPath() expects statSync() to succeed
    // on the argument, which fails for URLs. Detect URL schemes and
    // route to installFromUrl() instead.
    if (entry.downloadUrl) {
      if (/^https?:\/\//i.test(entry.downloadUrl) || /^file:\/\//i.test(entry.downloadUrl)) {
        return this.installFromUrl(entry.downloadUrl.replace(/\/mod\.json$/, '').replace(/\/$/, ''));
      }
      return this.installFromPath(entry.downloadUrl);
    }

    // Fallback: reconstruct from the registry's URL pattern. Try the
    // versioned path first, then the flat path (mods/<id>/ without a
    // version subdir) — the latter is what bizarre-mods uses today.
    const registryUrl = url || this.getRegistryUrl();
    const baseUrl = registryUrl.replace(/\/registry\.json$/, '').replace(/\/$/, '');
    const candidates = [
      `${baseUrl}/mods/${id}/${entry.latest || entry.version}`,
      `${baseUrl}/mods/${id}`,
    ];
    for (const modDir of candidates) {
      const result = await this.installFromUrl(modDir);
      if (result) return result;
    }

    throw new Error(
      `mod "${id}" has no downloadUrl and the canonical URLs are unreachable (tried ${candidates.join(', ')})`,
    );
  },

  /**
   * v3.20.5 — Upgrade a mod already on disk to the latest version from
   * the registry. The flow:
   *   1. Read the existing installed mod's version (for the report).
   *   2. Optionally back it up to ~/.config/bizar/mods/.backup/<id>-<ts>/
   *      (off by default — pass { backup: true } to enable).
   *   3. Uninstall the existing mod (removes cline-config copies via
   *      uninstallModInstructions so the new install can re-create them).
   *   4. Install the latest version from the registry.
   *   5. Return { from, to, backupPath?, mod } for the dashboard.
   *
   * If the registry install fails, we attempt to restore from the backup
   * (if any) so the user isn't left without a working mod.
   */
  async upgradeFromRegistry(id, { url, backup = false } = {}) {
    const dir = join(MODS_DIR, id);
    const existing = existsSync(dir) ? this.get(id) : null;
    if (!existing) {
      throw new Error(`mod "${id}" is not installed; nothing to upgrade`);
    }
    const fromVersion = existing.version;

    // 1. Back up the existing folder if requested.
    let backupPath = null;
    if (backup) {
      const backupRoot = join(BIZAR_HOME, 'mods', '.backup');
      mkdirSync(backupRoot, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = join(backupRoot, `${id}-${stamp}`);
      cpSync(dir, backupPath, { recursive: true });
    }

    // 2. Uninstall the existing copy (also removes its cline instructions).
    this.uninstall(id);

    // 3. Install the latest from the registry.
    let installed;
    try {
      installed = await this.installFromRegistry(id, { url });
    } catch (err) {
      // Attempt rollback so the user isn't left without a working mod.
      if (backupPath) {
        try {
          mkdirSync(dir, { recursive: true });
          cpSync(backupPath, dir, { recursive: true });
          installModInstructions(id, dir);
        } catch (rollbackErr) {
          err.rollbackError = rollbackErr;
        }
      }
      throw err;
    }
    if (!installed) {
      throw new Error(`mod "${id}" not found in registry`);
    }
    return {
      from: fromVersion,
      to: installed.version,
      backupPath,
      mod: installed,
    };
  },

  /**
   * Install a mod from a URL prefix (e.g. https://.../mods/graphify/1.0.0).
   * Fetches mod.json + each known file (mod.json, route.mjs, README.md)
   * and writes them into ~/.config/bizar/mods/<id>/.
   *
   * Returns the installed mod, or null if mod.json wasn't found.
   */
  async installFromUrl(baseUrl) {
    const cleanBase = baseUrl.replace(/\/$/, '');
    const modJsonUrl = `${cleanBase}/mod.json`;
    let modJson;
    try {
      const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
      const res = await fetch(modJsonUrl);
      if (!res.ok) return null;
      modJson = await res.json();
    } catch (err) {
      console.warn('swallowed in fetchModMetadata:', err.message);
      return null;
    }
    const id = modJson.id;
    const target = join(MODS_DIR, id);
    if (existsSync(target)) {
      throw new Error(`mod "${id}" already installed`);
    }
    mkdirSync(target, { recursive: true });
    // Fetch known top-level files. Unknown files (e.g. views/, agents/)
    // are NOT fetched — mods that need them should publish a tarball.
    const knownFiles = ['mod.json', 'route.mjs', 'README.md', 'CHANGELOG.md', 'INSTRUCTIONS.md'];
    for (const f of knownFiles) {
      try {
        const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
        const fileRes = await fetch(`${cleanBase}/${f}`);
        if (fileRes.ok) {
          const content = await fileRes.text();
          writeFileSync(join(target, f), content, 'utf8');
        }
      } catch {
        /* skip files that don't exist */
      }
    }
    // v3.20 — Fetch `agents/`, `commands/`, and `skills/` subfolders.
    // We discover the contents by trying common names (the registry
    // doesn't list them explicitly). For each known category, we
    // attempt to fetch a small set of likely filenames.
    await fetchInstructionDir(`${cleanBase}/agents`, join(target, 'agents'));
    await fetchInstructionDir(`${cleanBase}/commands`, join(target, 'commands'));
    await fetchSkillsDir(`${cleanBase}/skills`, join(target, 'skills'));
    // Also try to fetch `web/index.html` if the mod ships a self-contained
    // web view (the dashboard exposes it via `/api/mods/<id>/mod-web/*`).
    try {
      const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
      const webRes = await fetch(`${cleanBase}/web/index.html`);
      if (webRes.ok) {
        const webDir = join(target, 'web');
        mkdirSync(webDir, { recursive: true });
        const content = await webRes.text();
        writeFileSync(join(webDir, 'index.html'), content, 'utf8');
      }
    } catch {
      /* optional — web view is mod-defined */
    }
    // v3.20 — install mod instructions into the user's cline config
    // (agents/, commands/, skills/). Triggered on registry install too.
    installModInstructions(id, target);
    // v4.4.11 — Smoke-test the mod before reporting success. We
    // uninstall on failure so a broken mod doesn't leave a half-
    // copied directory the user has to clean up manually.
    const validation = await this.validateModInstallation(id);
    if (!validation.ok) {
      uninstallModInstructions(id);
      rmSync(target, { recursive: true, force: true });
      const err = new Error(
        `mod "${id}" failed post-install validation: ${validation.errors.join('; ')}`,
      );
      err.validation = validation;
      throw err;
    }
    if (validation.warnings.length > 0) {
      console.warn(
        `[mods-loader] mod "${id}" installed with warnings: ${validation.warnings.join('; ')}`,
      );
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
      } catch (err) {
        console.warn('swallowed in mod walk:', err.message);
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
   * @param {string} ctx.clineConfigDir
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

  /**
   * v3.20 — List the instruction files a mod installed into the user's
   * cline config. Returns paths grouped by category.
   *
   *   { agents: ['<id>__thor.md', ...],
   *     commands: ['<id>__plan.md', ...],
   *     skills: ['<id>-instructions', '<id>-my-skill', ...] }
   */
  listModInstructions(modId) {
    if (!modId) return { agents: [], commands: [], skills: [] };
    const prefix = `${modId}__`;
    const skillPrefix = `${modId}-`;
    const out = { agents: [], commands: [], skills: [] };
    if (existsSync(CLINE_AGENTS_DIR)) {
      try {
        out.agents = readdirSync(CLINE_AGENTS_DIR)
          .filter((f) => f.startsWith(prefix));
      } catch (err) {
        console.warn('swallowed in agents readdir:', err.message);
      }
    }
    if (existsSync(CLINE_COMMANDS_DIR)) {
      try {
        out.commands = readdirSync(CLINE_COMMANDS_DIR)
          .filter((f) => f.startsWith(prefix));
      } catch (err) {
        console.warn('swallowed in commands readdir:', err.message);
      }
    }
    if (existsSync(CLINE_SKILLS_DIR)) {
      try {
        out.skills = readdirSync(CLINE_SKILLS_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name.startsWith(skillPrefix))
          .map((e) => e.name);
      } catch (err) {
        console.warn('swallowed in skills readdir:', err.message);
      }
    }
    return out;
  },

  /**
   * v3.20 — Reinstall instruction files for a mod already on disk
   * (used after the user edits files inside the mod, or after a
   * `bizar mod refresh`).
   */
  reinstallInstructions(modId) {
    const dir = join(MODS_DIR, modId);
    if (!existsSync(dir)) return null;
    return installModInstructions(modId, dir);
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

// ─────────────────────────────────────────────────────────────────────
// v3.20 — fetchInstructionDir / fetchSkillsDir: pull a directory of
// mod instruction files from a registry URL. The registry doesn't list
// the contents of `agents/`, `commands/`, or `skills/`, so we probe for
// a small set of likely filenames. Mods with many files should publish
// a tarball instead.
// ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a directory of `.md` files from `<baseUrl>` and write them into
 * `<destDir>`. Probes a small set of likely names — mod authors who
 * need more than this should publish a tarball and install via path.
 */
async function fetchInstructionDir(baseUrl, destDir) {
  const candidates = [
    'thor.md', 'tyr.md', 'odin.md', 'heimdall.md', 'mimir.md',
    'frigg.md', 'vor.md', 'hermod.md', 'baldr.md', 'forseti.md',
    'vidarr.md', 'quick.md', 'agent-browser.md', 'semble-search.md',
    'plan.md', 'review.md', 'audit.md', 'init.md', 'learn.md',
    'explain.md', 'visual-plan.md', 'tailscale-serve.md',
    'README.md', 'AGENTS.md', 'COMMANDS.md', 'INSTRUCTIONS.md',
  ];
  mkdirSync(destDir, { recursive: true });
  for (const f of candidates) {
    try {
      const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
      const res = await fetch(`${baseUrl}/${f}`);
      if (res.ok) {
        const content = await res.text();
        writeFileSync(join(destDir, f), content, 'utf8');
      }
    } catch {
      /* skip */
    }
  }
}

/**
 * Fetch a `skills/<name>/SKILL.md` directory. Probes a small set of
 * likely skill names. Same limitation as fetchInstructionDir — mod
 * authors with custom names should publish a tarball.
 */
async function fetchSkillsDir(baseUrl, destDir) {
  const candidates = [
    'main', 'core', 'default', 'rules', 'style',
    'review', 'audit', 'init', 'plan',
  ];
  mkdirSync(destDir, { recursive: true });
  for (const name of candidates) {
    try {
      const { fetch } = await import('node:undici').catch(() => ({ fetch: globalThis.fetch }));
      const res = await fetch(`${baseUrl}/${name}/SKILL.md`);
      if (res.ok) {
        const content = await res.text();
        const skillDir = join(destDir, name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8');
      }
    } catch {
      /* skip */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// v3.20 — Mod instructions: install/uninstall a mod's instruction files
// into the user's cline config so they auto-load at session start.
//
// Mapping (mod path → cline config path):
//
//   <mod>/INSTRUCTIONS.md            → ~/.cline/skills/<id>-instructions/SKILL.md
//   <mod>/agents/<agent>.md          → ~/.config/cline/agents/<id>__<agent>.md
//   <mod>/commands/<cmd>.md          → ~/.config/cline/commands/<id>__<cmd>.md
//   <mod>/skills/<name>/SKILL.md     → ~/.cline/skills/<id>-<name>/SKILL.md
//
// All installed files are prefixed with `<mod-id>__` (or `<mod-id>-` for skills)
// so uninstall can find exactly what this mod installed and remove it without
// touching files installed by other mods or by the base Bizar install.
// ─────────────────────────────────────────────────────────────────────

const CLINE_CONFIG_DIR = join(HOME, '.config', 'cline');
const CLINE_AGENTS_DIR = join(CLINE_CONFIG_DIR, 'agents');
const CLINE_COMMANDS_DIR = join(CLINE_CONFIG_DIR, 'commands');
const CLINE_SKILLS_DIR = join(HOME, '.cline', 'skills');

/**
 * Copy a single file, creating the destination directory if needed.
 * Returns the installed path or null on failure.
 */
function copyFileSafe(src, dest) {
  try {
    if (!existsSync(src)) return null;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: false });
    return dest;
  } catch {
    return null;
  }
}

/**
 * Recursively copy a directory.
 */
function copyDirSafe(src, dest) {
  try {
    if (!existsSync(src)) return null;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
    return dest;
  } catch {
    return null;
  }
}

/**
 * Remove a file or directory, ignoring ENOENT.
 */
function removeSafe(path) {
  try {
    if (!existsSync(path)) return false;
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk a directory recursively and return relative file paths.
 */
function walkFiles(dir, prefix = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...walkFiles(join(dir, e.name), rel));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Install all instruction files from a mod folder into the user's
 * cline config. Idempotent — safe to call multiple times for the
 * same mod (overwrites in place).
 *
 * Returns { agents, commands, skills, instructions } counts.
 */
function installModInstructions(modId, modDir) {
  if (!modId || !modDir) return { agents: 0, commands: 0, skills: 0, instructions: 0 };
  const counts = { agents: 0, commands: 0, skills: 0, instructions: 0 };

  // 1. agents/ → ~/.config/cline/agents/<id>__<agent>.md
  const agentsDir = join(modDir, 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (!f.endsWith('.md')) continue;
      const src = join(agentsDir, f);
      const dest = join(CLINE_AGENTS_DIR, `${modId}__${f}`);
      if (copyFileSafe(src, dest)) counts.agents += 1;
    }
  }

  // 2. commands/ → ~/.config/cline/commands/<id>__<cmd>.md
  const commandsDir = join(modDir, 'commands');
  if (existsSync(commandsDir)) {
    for (const f of readdirSync(commandsDir)) {
      if (!f.endsWith('.md')) continue;
      const src = join(commandsDir, f);
      const dest = join(CLINE_COMMANDS_DIR, `${modId}__${f}`);
      if (copyFileSafe(src, dest)) counts.commands += 1;
    }
  }

  // 3. INSTRUCTIONS.md → ~/.cline/skills/<id>-instructions/SKILL.md
  const instructionsSrc = join(modDir, 'INSTRUCTIONS.md');
  if (existsSync(instructionsSrc)) {
    const destDir = join(CLINE_SKILLS_DIR, `${modId}-instructions`);
    const dest = join(destDir, 'SKILL.md');
    if (copyFileSafe(instructionsSrc, dest)) counts.instructions += 1;
  }

  // 4. skills/<name>/SKILL.md → ~/.cline/skills/<id>-<name>/SKILL.md
  const skillsDir = join(modDir, 'skills');
  if (existsSync(skillsDir)) {
    let entries;
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = join(skillsDir, e.name, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      const destDir = join(CLINE_SKILLS_DIR, `${modId}-${e.name}`);
      const dest = join(destDir, 'SKILL.md');
      if (copyFileSafe(skillMd, dest)) counts.skills += 1;
    }
  }

  return counts;
}

/**
 * Remove all instruction files installed by a mod. Safe to call when
 * the mod folder is already gone (uses the same `<id>__` / `<id>-` prefixes
 * install used, so it only removes what this mod installed).
 */
function uninstallModInstructions(modId) {
  if (!modId) return { agents: 0, commands: 0, skills: 0, instructions: 0 };
  const counts = { agents: 0, commands: 0, skills: 0, instructions: 0 };

  // 1. agents/ — remove every <id>__*.md
  if (existsSync(CLINE_AGENTS_DIR)) {
    let entries;
    try {
      entries = readdirSync(CLINE_AGENTS_DIR);
    } catch {
      entries = [];
    }
    for (const f of entries) {
      if (f.startsWith(`${modId}__`) && f.endsWith('.md')) {
        if (removeSafe(join(CLINE_AGENTS_DIR, f))) counts.agents += 1;
      }
    }
  }

  // 2. commands/ — remove every <id>__*.md
  if (existsSync(CLINE_COMMANDS_DIR)) {
    let entries;
    try {
      entries = readdirSync(CLINE_COMMANDS_DIR);
    } catch {
      entries = [];
    }
    for (const f of entries) {
      if (f.startsWith(`${modId}__`) && f.endsWith('.md')) {
        if (removeSafe(join(CLINE_COMMANDS_DIR, f))) counts.commands += 1;
      }
    }
  }

  // 3. INSTRUCTIONS.md — remove <id>-instructions/ skill
  const instructionsDest = join(CLINE_SKILLS_DIR, `${modId}-instructions`);
  if (removeSafe(instructionsDest)) counts.instructions += 1;

  // 4. skills/ — remove every <id>-<name>/ skill dir that this mod installed.
  // We only remove dirs that look like `<id>-*` and aren't the agent-baseline
  // or other base-installed skills.
  if (existsSync(CLINE_SKILLS_DIR)) {
    let entries;
    try {
      entries = readdirSync(CLINE_SKILLS_DIR, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // Match `<id>-<anything>`. Use the first hyphen as the split so mod
      // ids that themselves contain hyphens still work (`<id>-<name>`).
      const prefix = `${modId}-`;
      if (e.name === `${modId}-instructions`) continue; // handled above
      if (e.name.startsWith(prefix)) {
        if (removeSafe(join(CLINE_SKILLS_DIR, e.name))) counts.skills += 1;
      }
    }
  }

  return counts;
}
