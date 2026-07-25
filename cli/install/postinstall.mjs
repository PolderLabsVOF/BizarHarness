/**
 * cli/install/postinstall.mjs
 *
 * runPostInstall() — bootstrap after npm install. Sets up the Claude Code
 * config dir with the canonical Bizar agents + a starter settings.json, and
 * installs Semble / Skills CLI as sidecars.
 *
 * Source paths resolve via `import.meta.url` so they work both when the
 * package is extracted to `node_modules/@polderlabs/bizar/` (npm install)
 * and when invoked from a local checkout (`node cli/bin.mjs install`).
 *
 * v10.7.2 fix: source paths previously used `PATHS.bizarHome + '/../config/'`
 * which resolved to a nonexistent `~/.config/config/` (one level up from
 * `BIZAR_HOME`, which is a runtime state dir, not the package source). After
 * F-107 deleted the legacy `config/agents/` tree, the install couldn't find
 * any agent files and crashed with ENOENT.
 */

import chalk from 'chalk';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudeDir, PATHS } from './paths.mjs';

/** Package root — `node_modules/@polderlabs/bizar/` or the checkout root. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Source paths, all relative to the package root. */
const SRC_AGENTS_DIR    = join(PACKAGE_ROOT, '.claude', 'agents');
const SRC_SETTINGS_FILE = join(PACKAGE_ROOT, '.claude', 'settings.json');

/**
 * Discover every agent .md shipped in `.claude/agents/`. Replaces the prior
 * hardcoded AGENT_FILES list (which omitted kevin and brad and broke
 * whenever a new agent was added).
 */
function listShippedAgents() {
  if (!existsSync(SRC_AGENTS_DIR)) return [];
  return readdirSync(SRC_AGENTS_DIR).filter(f => f.endsWith('.md'));
}

/**
 * Post-install bootstrap: settings.json template, agents, Semble, Skills CLI.
 * Called by the npm postinstall hook.
 */
export async function runPostInstall() {
  // 1. settings.json — copy template if user has none yet.
  const destSettings = join(resolveClaudeDir(), 'settings.json');
  if (!existsSync(destSettings)) {
    if (existsSync(SRC_SETTINGS_FILE)) {
      mkdirSync(resolveClaudeDir(), { recursive: true });
      copyFileSync(SRC_SETTINGS_FILE, destSettings);
      console.log('  ✓ settings.json bootstrapped from package template');
    } else {
      console.warn('  ⚠ settings.json template not found at', SRC_SETTINGS_FILE);
    }
  }

  // 2. Make sure Claude config dir exists.
  if (!existsSync(resolveClaudeDir())) {
    mkdirSync(resolveClaudeDir(), { recursive: true });
    console.log(`BizarHarness: created ${resolveClaudeDir()}/`);
  }

  // 3. Copy agent files. Skip ones the user already has (don't clobber).
  mkdirSync(PATHS.agentsDir, { recursive: true });
  const agents = listShippedAgents();
  if (agents.length === 0) {
    console.warn(`BizarHarness: no agent files found at ${SRC_AGENTS_DIR} — package is broken.`);
  }
  for (const file of agents) {
    const src = join(SRC_AGENTS_DIR, file);
    const dst = join(PATHS.agentsDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
    }
  }
  console.log(`BizarHarness: ${agents.length} agent(s) installed.`);

  // 4. Install Semble (code search MCP).
  const seemeCmd = (cmd) => {
    try {
      execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch { return false; }
  };
  const semblePresent = seemeCmd('semble');
  if (!semblePresent) {
    console.log('BizarHarness: installing Semble (code search)...');
    try {
      const hasUv = seemeCmd('uv');
      if (!hasUv) {
        if (process.platform === 'win32') {
          execSync('powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: 'pipe', timeout: 60000 });
        } else {
          execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: 'pipe', timeout: 60000 });
        }
      }
      execSync('uv tool install "semble[mcp]"', { stdio: 'pipe', timeout: 60000 });
      console.log('BizarHarness: Semble installed.');
    } catch {
      console.log('BizarHarness: Semble install failed. Run `uv tool install "semble[mcp]"` manually.');
    }
  } else {
    console.log('BizarHarness: Semble ready.');
  }

  // 5. Install Skills CLI.
  const skillsPresent = seemeCmd('skills');
  if (!skillsPresent) {
    console.log('BizarHarness: installing Skills CLI...');
    try {
      execSync('npm install -g skills', { stdio: 'pipe', timeout: 30000 });
      console.log('BizarHarness: Skills CLI installed.');
    } catch {
      console.log('BizarHarness: Skills CLI install failed. Run `npm install -g skills` manually.');
    }
  } else {
    console.log('BizarHarness: Skills CLI ready.');
  }

  // 6. Install core skill pack.
  console.log('BizarHarness: installing core skills...');
  try {
    execSync('skills add vercel-labs/skills --all -y', { stdio: 'pipe', timeout: 60000 });
    console.log('BizarHarness: core skills installed.');
  } catch {
    console.log('BizarHarness: core skill install skipped — run `skills add vercel-labs/skills --all -y` manually.');
  }

  // 7. Install Bizar plugin.
  const { installPluginFromGlobal } = await import('./plugin.mjs');
  await installPluginFromGlobal();

  console.log('Run `bizar` for interactive setup.');
}