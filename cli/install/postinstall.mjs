/**
 * cli/install/postinstall.mjs
 *
 * runPostInstall() — moved verbatim from cli/install.mjs (original ~95 lines).
 */

import chalk from 'chalk';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { resolveClaudeDir, PATHS } from './paths.mjs';

const AGENT_FILES = [
  'mike.md', 'janet.md', 'susan.md', 'pam.md',
  'greg.md', 'brenda.md', 'steve.md', 'todd.md', 'brad.md',
  'karen.md', 'carl.md', 'linda.md',
  'oscar.md',
];

/**
 * Post-install bootstrap: settings.json template, agents, Semble, Skills CLI.
 * Called by the npm postinstall hook.
 */
export async function runPostInstall() {
  const dest = join(resolveClaudeDir(), 'settings.json');
  const templateSrc = join(PATHS.bizarHome, '..', 'config', 'settings.json');

  // Copy settings.json template if not exists
  if (!existsSync(dest)) {
    if (existsSync(templateSrc)) {
      mkdirSync(resolveClaudeDir(), { recursive: true });
      copyFileSync(templateSrc, dest);
      console.log('  ✓ settings.json bootstrapped from package template');
    }
  }

  // Ensure Claude config dir exists
  const env = { exists: existsSync(resolveClaudeDir()) };
  if (!env.exists) {
    mkdirSync(resolveClaudeDir(), { recursive: true });
    console.log(`BizarHarness: created ${resolveClaudeDir()}/`);
  }

  mkdirSync(PATHS.agentsDir, { recursive: true });

  for (const file of AGENT_FILES) {
    const src = join(PATHS.bizarHome, '..', 'config', 'agents', file);
    const dst = join(PATHS.agentsDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
    }
  }
  console.log('BizarHarness: agents installed.');

  // Install Semble
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

  // Install Skills CLI
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

  // Install core skill pack
  console.log('BizarHarness: installing core skills...');
  try {
    execSync('skills add vercel-labs/skills --all -y', { stdio: 'pipe', timeout: 60000 });
    console.log('BizarHarness: core skills installed.');
  } catch {
    console.log('BizarHarness: core skill install skipped — run `skills add vercel-labs/skills --all -y` manually.');
  }

  // Install Bizar plugin
  const { installPluginFromGlobal } = await import('./plugin.mjs');
  await installPluginFromGlobal();

  console.log('Run `bizar` for interactive setup.');
}
