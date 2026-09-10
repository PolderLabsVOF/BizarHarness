/**
 * cli/install/detect.mjs
 *
 * Pure detection layer for the installer. Reads only; never writes.
 *
 *   detectInstalledAgents({ env, fs, commandOnPath, cwd })
 *     -> { claudeCode: {...}, desktop: {...}, openkan: {...} }
 *
 * All I/O is parameterized so the wizard, tests, and `--yes` auto-detect
 * mode can exercise the same code paths against an in-memory filesystem
 * or a mocked `command -v` probe. See docs/specs/ralplan/installer-
 * redesign-v2.md §3 for the canonical contract.
 */

import nodeFs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  resolveClaudeConfigDir,
  resolveDesktopConfigLibrary,
} from '../config-paths.mjs';
import { resolveOpenKanHome } from '../openkan.mjs';
import { detectProviderConfiguration } from './interactive-setup.mjs';

/**
 * Probe `command -v <cmd>` to find an executable on PATH. Quiet: stderr
 * is dropped and stdout is trimmed. Returns the resolved path or `null`
 * when the probe failed, the command is missing, or the binary returns
 * non-zero.
 *
 * `command -v` is a POSIX shell builtin, so we invoke it through `sh -c`
 * to keep the same behavior across platforms (macOS `sh` is bash-compatible;
 * Windows shims via Git-Bash or WSL expose `command` likewise). On bare
 * Windows shells without `sh`, this returns null and Claude Code is
 * detected via its `settings.json` presence instead (see `detectInstalledAgents`).
 */
export function commandOnPath(cmd, { spawnSync: spawn = spawnSync } = {}) {
  const result = spawn('sh', ['-c', `command -v -- ${JSON.stringify(cmd)}`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  const stdout = typeof result.stdout === 'string'
    ? result.stdout
    : (result.stdout ? result.stdout.toString('utf8') : '');
  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the Claude Code `settings.json` path. Pure — no read, no
 * existence check. Delegates to `cli/config-paths.mjs#resolveClaudeConfigDir`.
 */
export function readClaudeCodeSettingsPath({ env = process.env, cwd = process.cwd() } = {}) {
  return join(resolveClaudeConfigDir({ env, cwd }), 'settings.json');
}

/**
 * Find the active Claude Desktop config (`<appliedId>.json`) inside the
 * platform-correct configLibrary. Returns the absolute path or `null`
 * when:
 *   - the configLibrary directory does not exist
 *   - `_meta.json` is missing or unparseable
 *   - `appliedId` is missing or not present in `entries[]`
 *   - the resolved `<appliedId>.json` file does not exist on disk
 *
 * Never throws — all errors (ENOENT, malformed JSON, shape mismatch)
 * are folded into `null` so callers can branch on presence.
 */
export function findActiveDesktopConfigPath({ env = process.env, fs = nodeFs, cwd = process.cwd() } = {}) {
  const configLibraryPath = resolveDesktopConfigLibrary({ env, cwd });
  const metaPath = join(configLibraryPath, '_meta.json');
  if (!fs.existsSync(metaPath)) return null;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
  if (!meta || typeof meta.appliedId !== 'string' || !Array.isArray(meta.entries)) return null;

  const entry = meta.entries.find((e) => e && e.id === meta.appliedId);
  if (!entry) return null;

  const activePath = join(configLibraryPath, `${meta.appliedId}.json`);
  if (!fs.existsSync(activePath)) return null;
  return activePath;
}

/**
 * Read the active Claude Desktop config JSON. Returns the parsed object
 * or `null` when the file is missing, unparseable, or not an object.
 * Internal helper; exported for the desktop-config module (commit 4)
 * and for tests.
 */
export function readActiveDesktopConfig({ env = process.env, fs = nodeFs, cwd = process.cwd() } = {}) {
  const activePath = findActiveDesktopConfigPath({ env, fs, cwd });
  if (!activePath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(activePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Aggregate presence + gateway-configured status for the three install
 * targets. Pure over `env`, `fs`, and an injectable `commandOnPath`
 * factory (defaults to the real `commandOnPath`). Never writes.
 *
 * Returned shape:
 *   {
 *     claudeCode: {
 *       present: boolean,
 *       binPath: string|null,        // path to `claude` CLI on PATH
 *       configDir: string,           // ~/.claude or $CLAUDE_CONFIG_DIR
 *       gatewayConfigured: boolean,  // true when settings.json/env sets
 *                                   // ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
 *     },
 *     desktop: {
 *       present: boolean,            // configLibrary + active JSON exist
 *       configLibraryPath: string,   // resolved for current platform
 *       activeConfigPath: string|null,
 *       activeConfigId: string|null, // _meta.json#appliedId
 *       gatewayConfigured: boolean,  // true when active JSON declares the
 *                                   // gateway trio (provider, baseUrl, key)
 *     },
 *     openkan: {
 *       present: boolean,            // resolveOpenKanHome() exists on disk
 *       home: string,                // resolved OpenKan install root
 *     },
 *   }
 */
export function detectInstalledAgents({
  env = process.env,
  fs = nodeFs,
  cwd = process.cwd(),
  commandOnPath: commandOnPathFn = commandOnPath,
} = {}) {
  // ── Claude Code CLI ──────────────────────────────────────────────────
  const claudeCode = {
    present: false,
    binPath: null,
    configDir: resolveClaudeConfigDir({ env, cwd }),
    gatewayConfigured: false,
  };

  const cliPath = commandOnPathFn('claude');
  if (cliPath) {
    claudeCode.present = true;
    claudeCode.binPath = cliPath;
  } else if (fs.existsSync(join(claudeCode.configDir, 'settings.json'))) {
    // Portable Claude Code installs without `claude` on PATH still count
    // as present when their settings file already lives in the configDir.
    claudeCode.present = true;
  }

  const settingsPath = join(claudeCode.configDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const detected = detectProviderConfiguration({ env, settings });
      claudeCode.gatewayConfigured = !!(detected.url && detected.key);
    } catch {
      // Malformed settings.json: leave gatewayConfigured=false rather than
      // crashing the wizard — the wizard prompts for fresh values anyway.
    }
  }

  // ── Claude Desktop ───────────────────────────────────────────────────
  const desktop = {
    present: false,
    configLibraryPath: resolveDesktopConfigLibrary({ env, cwd }),
    activeConfigPath: null,
    activeConfigId: null,
    gatewayConfigured: false,
  };

  const activePath = findActiveDesktopConfigPath({ env, fs, cwd });
  if (activePath) {
    desktop.present = true;
    desktop.activeConfigPath = activePath;

    // _meta.json appliedId matches the active filename; the same read
    // already passed in findActiveDesktopConfigPath, so a second parse is
    // intentional but cheap.
    const metaPath = join(desktop.configLibraryPath, '_meta.json');
    let appliedId = null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta && typeof meta.appliedId === 'string') appliedId = meta.appliedId;
    } catch {
      appliedId = null;
    }
    desktop.activeConfigId = appliedId;

    const active = readActiveDesktopConfig({ env, fs, cwd });
    if (active) {
      desktop.gatewayConfigured = active.inferenceProvider === 'gateway'
        && typeof active.inferenceGatewayBaseUrl === 'string'
        && active.inferenceGatewayBaseUrl.trim().length > 0
        && typeof active.inferenceGatewayApiKey === 'string'
        && active.inferenceGatewayApiKey.trim().length > 0;
    }
  }

  // ── OpenKan ──────────────────────────────────────────────────────────
  const openkanHome = resolveOpenKanHome({ env, cwd });
  const openkan = {
    present: fs.existsSync(openkanHome),
    home: openkanHome,
  };

  return { claudeCode, desktop, openkan };
}
