/**
 * src/server/update-store.mjs
 *
 * v3.3.3 — Read installed package versions, check npm for latest,
 * and apply updates for the three core bizarre packages.
 */
import { execSync } from 'node:child_process';
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
};
