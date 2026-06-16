import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const isWin = process.platform === 'win32';

export function repoPath(...parts) {
  return join(REPO_ROOT, ...parts);
}

export function opencodeConfigDir() {
  if (isWin) {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'opencode')
      : join(homedir(), '.config', 'opencode');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'opencode')
    : join(homedir(), '.config', 'opencode');
}

export function opencodeAgentsDir() {
  return join(opencodeConfigDir(), 'agents');
}

async function tryReadVersion(filePath) {
  try {
    const pkg = await import(filePath);
    return pkg.version || '';
  } catch {
    return '';
  }
}

export async function detectOpenCode() {
  const configDir = opencodeConfigDir();
  const agentsDir = opencodeAgentsDir();

  let exists = false;
  let version = '';

  try {
    await access(configDir, constants.F_OK);
    exists = true;

    if (isWin) {
      const winPaths = [
        join(process.env.APPDATA || homedir(), 'npm', 'node_modules', 'opencode', 'package.json'),
        join(process.env.APPDATA || homedir(), 'npm-global', 'node_modules', 'opencode', 'package.json'),
        join(homedir(), 'node_modules', 'opencode', 'package.json'),
      ];
      for (const p of winPaths) {
        version = await tryReadVersion(p);
        if (version) break;
      }
    } else {
      const posixPaths = [
        join(homedir(), '.local', 'share', 'opencode', 'package.json'),
        '/usr/local/lib/node_modules/opencode/package.json',
        '/usr/lib/node_modules/opencode/package.json',
        join(homedir(), '.npm-global', 'lib', 'node_modules', 'opencode', 'package.json'),
        join(homedir(), 'node_modules', 'opencode', 'package.json'),
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

export async function detectRtk() {
  const { execSync } = await import('node:child_process');
  try {
    execSync('rtk --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function detectSemble() {
  const { execSync } = await import('node:child_process');
  try {
    execSync('uvx --from "semble[mcp]" semble --help', { stdio: 'pipe', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

export async function detectUv() {
  const { execSync } = await import('node:child_process');
  try {
    execSync('uv --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function detectSkillsCli() {
  const { execSync } = await import('node:child_process');
  try {
    execSync('npx --yes skills --help', { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

export async function detectInstalledAgents() {
  const agentsDir = opencodeAgentsDir();
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
  if (components.includes('skill-bizar')) parts.push('bizarharness skill');
  if (components.includes('skill-improve')) parts.push('self-improvement skill');
  if (components.includes('opencode-json')) parts.push('opencode.json');
  if (components.includes('bizar')) parts.push('.bizar/ folder');
  if (components.includes('rules')) parts.push('rules');
  if (components.includes('hooks')) parts.push('hooks');
  if (components.includes('commands')) parts.push('commands');
  parts.push('RTK');
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
