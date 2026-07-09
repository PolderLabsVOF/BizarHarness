import { access, constants, readFile } from 'node:fs/promises';
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const isWin = process.platform === 'win32';

export function repoPath(...parts) {
  return join(REPO_ROOT, ...parts);
}

/**
 * Resolve the Cline global config directory.
*
  * Mirrors Cline's `resolveClineDir()` in `@cline/shared/storage`:
  *   1. `process.env.CLINE_DIR` (explicit override)
  *   2. `$HOME/.cline` (the Cline default since v3.0)
  *
  * v6.1.0 — Bizar is Cline-only. The pre-v5.6 `~/.config/cline/` path
  * (the OpenCode-era layout) is no longer supported; the previous
  * `legacyClineConfigDir()` helper has been removed.
  */
export function clineConfigDir() {
  if (process.env.CLINE_DIR && process.env.CLINE_DIR.trim()) {
    return process.env.CLINE_DIR.trim();
  }
  if (isWin) {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'cline')
      : join(homedir(), '.cline');
  }
  return join(homedir(), '.cline');
}

export function clineAgentsDir() {
  return join(clineConfigDir(), 'agents');
}

async function tryReadVersion(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const pkg = JSON.parse(raw);
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
}

function commandExists(command) {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [command], { stdio: 'ignore' })
    : spawnSync('which', [command], { stdio: 'ignore' });
  return probe.status === 0;
}

export async function detectCline() {
  const configDir = clineConfigDir();
  const agentsDir = clineAgentsDir();

  let exists = false;
  let version = '';

  try {
    await access(configDir, constants.F_OK);
    exists = true;

    if (isWin) {
      const winPaths = [
        join(process.env.APPDATA || homedir(), 'npm', 'node_modules', 'cline', 'package.json'),
        join(process.env.APPDATA || homedir(), 'npm', 'node_modules', 'cline', 'package.json'),
        join(process.env.APPDATA || homedir(), 'npm-global', 'node_modules', 'cline', 'package.json'),
        join(process.env.APPDATA || homedir(), 'npm-global', 'node_modules', 'cline', 'package.json'),
        join(homedir(), 'node_modules', 'cline', 'package.json'),
        join(homedir(), 'node_modules', 'cline', 'package.json'),
      ];
      for (const p of winPaths) {
        version = await tryReadVersion(p);
        if (version) break;
      }
    } else {
      const posixPaths = [
        join(homedir(), '.local', 'share', 'cline', 'package.json'),
        join(homedir(), '.local', 'share', 'cline', 'package.json'),
        '/usr/local/lib/node_modules/cline/package.json',
        '/usr/local/lib/node_modules/cline/package.json',
        '/usr/lib/node_modules/cline/package.json',
        '/usr/lib/node_modules/cline/package.json',
        join(homedir(), '.npm-global', 'lib', 'node_modules', 'cline', 'package.json'),
        join(homedir(), '.npm-global', 'lib', 'node_modules', 'cline', 'package.json'),
        join(homedir(), 'node_modules', 'cline', 'package.json'),
        join(homedir(), 'node_modules', 'cline', 'package.json'),
      ];
      for (const p of posixPaths) {
        version = await tryReadVersion(p);
        if (version) break;
      }
    }
  } catch {
    exists = false;
  }

  return { exists, version, configDir, agentsDir };
}

export async function detectHeadroom() {
  return commandExists('headroom');
}

// Alias for backward-compat during migration
export const detectRtk = detectHeadroom;

export async function detectSemble() {
  if (commandExists('semble')) {
    return true;
  }
  if (!commandExists('uv')) return false;
  const probe = spawnSync('uv', ['tool', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (probe.status !== 0) return false;
  return /(^|\s)semble(\s|@|$)/m.test(probe.stdout || '');
}

export async function detectUv() {
  return commandExists('uv');
}

export async function detectSkillsCli() {
  return commandExists('skills');
}

export async function detectInstalledAgents() {
  const agentsDir = clineAgentsDir();
  try {
    await access(agentsDir, constants.F_OK);
    return agentsDir;
  } catch {
    return null;
  }
}

export function buildSummary(components, agents, target, skillPacks = []) {
  const parts = [];
  if (components.includes('agents')) parts.push(`${agents.length} agents`);
  if (components.includes('agents-md')) parts.push('AGENTS.md');
  if (components.includes('skill-bizar')) parts.push('bizar skill');
  if (components.includes('skill-improve')) parts.push('self-improvement skill');
  if (components.includes('cline-json')) parts.push('cline.json');
  if (components.includes('bizar')) parts.push('.bizar/ folder');
  if (components.includes('plugin-bizar')) parts.push('Bizar plugin');
  if (components.includes('rules')) parts.push('rules');
  if (components.includes('hooks')) parts.push('hooks');
  if (components.includes('commands')) parts.push('commands');
  parts.push('Headroom');
  parts.push('Semble');
  parts.push('Skills CLI');
  if (skillPacks.length > 0) parts.push(`skills: ${skillPacks.join(', ')}`);

  return {
    components: parts.join(', '),
    agents: agents.length === 11 ? '(all 11)' : `(${agents.length} selected)`,
    target,
    parts,
  };
}

// ── Path helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the platform-specific Bizar config directory.
 * Windows: %APPDATA%\bizar
 * Unix: $XDG_CONFIG_HOME/bizar (default: ~/.config/bizar)
 */
export function bizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(homedir(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
}

/**
 * Check if a command exists on PATH.
 * Returns true if found, false otherwise.
 */
export function which(cmd) {
  const probe = spawnSync('which', [cmd], { stdio: 'ignore' });
  return probe.status === 0;
}

/**
 * Check if a command exists on PATH (bg.mjs variant that returns the path or null).
 */
export function whichPath(cmd) {
  try {
    const out = execFileSync('which', [cmd], { encoding: 'utf8' });
    return out.trim() || null;
  } catch {
    return null;
  }
}
