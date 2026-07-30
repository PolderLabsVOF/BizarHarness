/**
 * Install, update, and inspect the official `agent-browser` CLI.
 *
 * The browser daemon is managed by agent-browser itself. Bizar does not
 * start, stop, or persist a separate browser process.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';

function findAgentBrowserBin() {
  const override = process.env.AGENT_BROWSER_BIN;
  if (override && existsSync(override)) return override;

  const candidates = [
    '/usr/local/bin/agent-browser',
    '/opt/homebrew/bin/agent-browser',
    join(homedir(), '.local', 'bin', 'agent-browser'),
    join(homedir(), '.npm', 'bin', 'agent-browser'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const bin = execFileSync('which', ['agent-browser'], {
      encoding: 'utf8',
      timeout: 2_000,
    }).trim();
    return bin && existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

export function detectState() {
  const bin = findAgentBrowserBin();
  if (!bin) return { installed: false, version: null, bin: null };

  try {
    const result = spawnSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.status !== 0) {
      return { installed: false, version: null, bin };
    }
    const version = `${result.stdout || result.stderr}`.trim() || 'unknown';
    return { installed: true, version, bin };
  } catch {
    return { installed: false, version: null, bin };
  }
}

function runChecked(command, args, { silent, timeout }) {
  const result = spawnSync(command, args, {
    stdio: silent ? 'ignore' : 'inherit',
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
  }
}

export function install({ silent = false, dryRun = false, channel = 'latest' } = {}) {
  const log = silent ? () => {} : (message) => console.log(chalk.cyan('  → ') + message);
  const before = detectState();
  if (before.installed) {
    log(`agent-browser ${before.version} already installed at ${before.bin}`);
    return before;
  }

  const packageSpec = channel === 'latest' ? 'agent-browser' : `agent-browser@${channel}`;
  if (dryRun) {
    log(`[DRY RUN] would run: npm install -g ${packageSpec}`);
    log('[DRY RUN] would run: agent-browser install');
    return before;
  }

  log(`Installing ${packageSpec}...`);
  runChecked('npm', ['install', '-g', packageSpec], { silent, timeout: 180_000 });
  const afterInstall = detectState();
  if (!afterInstall.installed) {
    throw new Error('agent-browser is not on PATH after npm installation');
  }
  runChecked(afterInstall.bin, ['install'], { silent, timeout: 300_000 });
  return detectState();
}

export function update({ silent = false, dryRun = false } = {}) {
  const log = silent ? () => {} : (message) => console.log(chalk.cyan('  → ') + message);
  const before = detectState();
  if (!before.installed) return install({ silent, dryRun });

  if (dryRun) {
    log('[DRY RUN] would run: agent-browser upgrade');
    return before;
  }

  log(`Upgrading agent-browser ${before.version}...`);
  runChecked(before.bin, ['upgrade'], { silent, timeout: 180_000 });
  return detectState();
}

export function doctor({ silent = false } = {}) {
  const state = detectState();
  if (!state.installed) {
    return { ok: false, state, message: 'agent-browser is not installed' };
  }
  const result = spawnSync(state.bin, ['doctor'], {
    encoding: silent ? 'utf8' : undefined,
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 120_000,
  });
  return {
    ok: result.status === 0,
    state,
    message: result.status === 0 ? 'agent-browser doctor passed' : 'agent-browser doctor failed',
  };
}

export function printStatus() {
  const state = detectState();
  if (!state.installed) {
    console.log(chalk.yellow('  agent-browser: NOT INSTALLED'));
    console.log(chalk.dim('    Install with: npm install -g agent-browser && agent-browser install'));
  } else {
    console.log(`  agent-browser ${chalk.cyan(state.version)} · ${state.bin}`);
  }
  return state;
}
