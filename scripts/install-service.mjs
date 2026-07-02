#!/usr/bin/env node
/**
 * scripts/install-service.mjs
 *
 * v3.22.0 — Post-install hook that registers the Bizar background service
 * via Stream A's `cli/service-controller.mjs`.
 *
 * This script is a thin wrapper that handles the case where Stream A has not
 * yet landed (service-controller.mjs missing) gracefully.
 *
 * Design:
 *   - Imports service-controller.mjs dynamically (runtime dependency).
 *   - Calls `installService({ force })`.
 *   - If already installed with matching content, prints a message and exits 0.
 *   - On Linux without systemd, falls back to running the daemon in a tmux
 *     session and prints a note.
 *   - On failure (or missing service-controller.mjs from sibling stream not
 *     yet landed), prints a friendly error with the manual command and exits 0
 *     (non-error — install is deliberately split across streams).
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function runCmd(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 15_000,
    shell: false,
    windowsHide: true,
    ...opts,
  });
  return {
    status: r.status,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    error: r.error || null,
  };
}

function hasSystemd() {
  try {
    const r = runCmd('systemctl', ['--version']);
    return r.status === 0;
  } catch {
    return false;
  }
}

function findTmux() {
  try {
    const r = runCmd('which', ['tmux']);
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Run the daemon in a tmux session as a fallback for non-systemd Linux.
 */
function installViaTmux(projectRoot) {
  const cliEntry = join(projectRoot, 'cli', 'bin.mjs');
  if (!existsSync(cliEntry)) {
    // Fallback to node path
    return {
      ok: false,
      error: `cli entry not found at ${cliEntry}`,
      note: 'install the BizarHarness repo first, then re-run this script',
    };
  }

  if (!findTmux()) {
    return {
      ok: false,
      error: 'tmux not found — cannot start background daemon',
      note: 'install tmux or run manually: node cli/bin.mjs dash start --bg',
    };
  }

  const sessionName = 'bizar-service';
  // Kill existing session if present (idempotent)
  runCmd('tmux', ['kill-session', '-t', sessionName]);
  const r = runCmd('tmux', [
    'new-session', '-d', '-s', sessionName,
    'node', cliEntry, 'dash', 'start', '--bg',
  ], { shell: false, timeout: 10_000 });

  if (r.error || (r.status !== 0 && r.status !== null)) {
    return {
      ok: false,
      error: `tmux new-session failed: ${r.stderr || r.error?.message || `exit ${r.status}`}`,
      note: `run manually: node "${cliEntry}" dash start --bg`,
    };
  }

  return {
    ok: true,
    unitPath: null,
    note: `service started in tmux session "${sessionName}" (non-systemd fallback)`,
  };
}

async function installService(opts = {}) {
  const force = !!opts.force;
  const projectRoot = resolve(REPO_ROOT);

  // Path to service-controller.mjs (Stream A's file)
  const controllerPath = join(projectRoot, 'cli', 'service-controller.mjs');

  if (!existsSync(controllerPath)) {
    // Stream A hasn't landed yet — this is NOT an error.
    // Print a message and exit 0 so the installation doesn't fail.
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      note: 'service-controller.mjs not found (Stream A not yet landed). Install split across streams — service registration will be completed when cli/service-controller.mjs is available.',
    }));
    return;
  }

  // Dynamic import — we want a runtime error only if the module is present
  // but fails to load.
  let controller;
  try {
    controller = await import(controllerPath);
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      error: `failed to load service-controller.mjs: ${err.message}`,
      note: `run manually: node "${join(projectRoot, 'cli', 'service-controller.mjs')}" install`,
    }));
    return;
  }

  if (typeof controller.installService !== 'function') {
    console.log(JSON.stringify({
      ok: false,
      error: 'service-controller.mjs does not export installService',
    }));
    return;
  }

  // Platform-specific fallback: on Linux without systemd, use tmux.
  if (process.platform === 'linux' && !hasSystemd()) {
    const result = installViaTmux(projectRoot);
    console.log(JSON.stringify(result));
    return;
  }

  try {
    const result = controller.installService({ force, projectRoot });
    console.log(JSON.stringify(result));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      error: `installService threw: ${err.message}`,
    }));
  }
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1] === import.meta.filename ||
  process.argv[1].endsWith('/install-service.mjs')
);

if (isMain) {
  const flags = new Set(process.argv.slice(2));
  const force = flags.has('--force') || flags.has('-f');
  const opts = { force };

  installService(opts).catch(err => {
    console.log(JSON.stringify({
      ok: false,
      error: err.message,
      note: 'unexpected error during service installation',
    }));
    process.exit(0); // still exit 0 so the overall install script doesn't fail
  });
}

export { installService };
