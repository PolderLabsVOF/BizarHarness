/**
 * src/server/update-store.mjs
 *
 * v3.5.3 — Read installed package versions, check npm for latest,
 * and apply updates for the three core bizarre packages.
 */
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PACKAGES = [
  { id: 'bizar', name: '@polderlabs/bizar' },
  { id: 'bizar-dash', name: '@polderlabs/bizar-dash' },
  { id: 'bizar-plugin', name: '@polderlabs/bizar-plugin' },
];

export const updateStore = {
  /**
   * Get currently installed versions (read from each package's package.json).
   * Returns null for any package that's not installed locally.
   */
  current() {
    const out = {};
    for (const p of PACKAGES) {
      try {
        out[p.id] = require(`${p.name}/package.json`).version;
      } catch {
        out[p.id] = null;
      }
    }
    return out;
  },

  /**
   * Check npm registry for latest published versions.
   * Uses `npm view <pkg> version` — works without auth.
   * Returns null for any package that errors (e.g., offline).
   */
  async latest() {
    const out = {};
    for (const p of PACKAGES) {
      try {
        const ver = execSync(`npm view ${p.name} version`, {
          encoding: 'utf8',
          timeout: 15000,
        }).trim();
        out[p.id] = ver;
      } catch {
        out[p.id] = null;
      }
    }
    return out;
  },

  /**
   * Determine if updates are available.
   */
  hasUpdates(current, latest) {
    if (!current || !latest) return false;
    return PACKAGES.some((p) => {
      if (!current[p.id] || !latest[p.id]) return false;
      return latest[p.id] !== current[p.id];
    });
  },

  /**
   * Run the update. Installs the specified packages at @latest.
   * Streams progress via the broadcast callback.
   */
  async apply({ packages, broadcast }) {
    const targets = PACKAGES.filter((p) => packages.includes(p.id));
    const results = {};

    for (const p of targets) {
      broadcast?.({ type: 'update:progress', pkg: p.id, status: 'installing' });
      try {
        const output = execSync(
          `npm install -g ${p.name}@latest --ignore-scripts`,
          {
            encoding: 'utf8',
            timeout: 180000,
          },
        );
        results[p.id] = { ok: true, output: output.slice(-500) };
        broadcast?.({ type: 'update:progress', pkg: p.id, status: 'done' });
      } catch (err) {
        results[p.id] = { ok: false, error: err.message };
        broadcast?.({ type: 'update:progress', pkg: p.id, status: 'error', error: err.message });
      }
    }

    return results;
  },

  /**
   * Apply updates for specified packages with live progress via broadcast.
   * Streams events:
   *   { type: 'update:progress', pkg, status: 'starting' }
   *   { type: 'update:progress', pkg, status: 'installing' }
   *   { type: 'update:progress', pkg, status: 'done', newVersion }
   *   { type: 'update:progress', pkg, status: 'error', error }
   *   { type: 'update:complete', results, requiresRestart: true }
   */
  async applyWithProgress({ packages, broadcast }) {
    const results = {};
    let allOk = true;

    for (const pkg of packages) {
      const pkgDef = PACKAGES.find((p) => p.id === pkg);
      if (!pkgDef) continue;

      broadcast?.({ type: 'update:progress', pkg, status: 'starting' });

      try {
        broadcast?.({ type: 'update:progress', pkg, status: 'installing' });

        // Use spawn so we can stream stdout/stderr
        const child = spawn('npm', ['install', '-g', `${pkgDef.name}@latest`, '--ignore-scripts'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Stream stdout/stderr to broadcast for live log display
        child.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line) broadcast?.({ type: 'update:log', pkg, line });
        });
        child.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (line) broadcast?.({ type: 'update:log', pkg, line });
        });

        const exitCode = await new Promise((resolve) => {
          child.on('close', resolve);
        });

        if (exitCode !== 0) {
          allOk = false;
          results[pkg] = { ok: false, error: `npm exited with code ${exitCode}` };
          broadcast?.({ type: 'update:progress', pkg, status: 'error', error: `exit ${exitCode}` });
          continue;
        }

        // Get the new version
        const newVersion = this.getInstalledVersion(pkg);
        results[pkg] = { ok: true, newVersion };
        broadcast?.({ type: 'update:progress', pkg, status: 'done', newVersion });
      } catch (err) {
        allOk = false;
        results[pkg] = { ok: false, error: err.message };
        broadcast?.({ type: 'update:progress', pkg, status: 'error', error: err.message });
      }
    }

    broadcast?.({ type: 'update:complete', results, requiresRestart: true, allOk });
    return { results, requiresRestart: true };
  },

  getInstalledVersion(pkgId) {
    const pkgDef = PACKAGES.find((p) => p.id === pkgId);
    if (!pkgDef) return null;
    try {
      return require(`${pkgDef.name}/package.json`).version;
    } catch {
      return null;
    }
  },
};
