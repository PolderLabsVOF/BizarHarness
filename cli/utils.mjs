import { access, constants, readFile } from 'node:fs/promises';
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolveClaudeConfigDir } from './config-paths.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export function repoPath(...parts) {
  return join(REPO_ROOT, ...parts);
}

/**
 * Resolve the Claude Code global config directory.
 *
 *   1. `process.env.CLAUDE_CONFIG_DIR` (explicit override)
 *   2. `$HOME/.claude` (Claude Code default)
 */
export function claudeConfigDir() {
  return resolveClaudeConfigDir();
}

export function claudeAgentsDir() {
  return join(claudeConfigDir(), 'agents');
}

export function claudeSkillsDir() {
  return join(claudeConfigDir(), 'skills');
}

export function claudeCommandsDir() {
  return join(claudeConfigDir(), 'commands');
}

export function claudeHooksDir() {
  return join(claudeConfigDir(), 'hooks');
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

/**
 * Probe for the Claude Code CLI on PATH.
 * Returns `{ exists, version }`. v6.3.0+ replacement for `detectCline()`.
 */
export async function detectClaude() {
  let exists = false;
  let version = '';
  try {
    const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (probe.status === 0) {
      exists = true;
      version = (probe.stdout || probe.stderr || '').trim().split('\n')[0];
    }
  } catch {
    exists = false;
  }
  return { exists, version, configDir: claudeConfigDir(), agentsDir: claudeAgentsDir() };
}

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
  const agentsDir = claudeAgentsDir();
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
  if (components.includes('settings-json')) parts.push('settings.json');
  if (components.includes('bizar')) parts.push('.bizar/ folder');
  if (components.includes('mcp-bizar')) parts.push('Bizar MCP server');
  if (components.includes('rules')) parts.push('rules');
  if (components.includes('hooks')) parts.push('hooks');
  if (components.includes('commands')) parts.push('commands');
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

// Path helpers

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
