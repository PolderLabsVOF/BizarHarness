/**
 * settings-store.mjs
 *
 * Per-user persistence for the bizar cline-plugin's runtime options
 * (maxConcurrentInstances, backgroundToolCallCap, etc.). Reads and writes
 * a JSON file at ~/.config/bizar/plugin-options.json so the settings
 * survive dashboard restarts.
 *
 * The plugin reads this file on init; the dashboard writes it via
 * the /api/settings/plugin-options endpoints. No schema validation
 * here — the plugin handles defaults and clamping.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const SETTINGS_PATH = join(homedir(), '.config', 'bizar', 'plugin-options.json');

/**
 * Read the persisted plugin-options from disk.
 * Returns `null` when the file doesn't exist or can't be parsed.
 *
 * @returns {Record<string, unknown> | null}
 */
export function readPluginOptions() {
  try {
    if (!existsSync(SETTINGS_PATH)) return null;
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write plugin-options to disk, creating the directory if necessary.
 * Returns `{ ok: true, path }` on success.
 *
 * @param {Record<string, unknown>} opts
 * @returns {{ ok: true, path: string }}
 */
export function writePluginOptions(opts) {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(opts, null, 2), 'utf8');
  return { ok: true, path: SETTINGS_PATH };
}
