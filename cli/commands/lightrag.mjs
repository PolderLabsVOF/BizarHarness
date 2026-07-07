/**
 * cli/commands/lightrag.mjs
 *
 * v5.x — LightRAG management CLI (issue #6).
 *
 * Subcommands:
 *   autostart          Trigger the dashboard's lightragStartupHook() against
 *                      the current working directory's project. Used by
 *                      `install.sh` and by operators who want to manually
 *                      start LightRAG without opening the dashboard.
 *   start              Alias for `autostart` (matches `headroom start`).
 *   status             Print whether the LightRAG server is running.
 *
 * The dashboard server already auto-invokes `lightragStartupHook()` on
 * boot, so this CLI is mostly for ops/debugging. The `autostart` form is
 * the one called by `install.sh` and `bizar update` flows.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { process } from 'node:process';

export function showLightragHelp() {
  console.log(`
  bizar lightrag — Manage the LightRAG knowledge graph server

  Usage:
    bizar lightrag status              Show whether LightRAG is running
    bizar lightrag start               Start LightRAG for the current project
    bizar lightrag autostart           Same as \`start\` — runs the startup hook
    bizar lightrag autostart --no-dashboard  Run hook without touching the
                                            running dashboard (skips status check)

  Description:
    LightRAG is the knowledge-graph indexer for the project's memory vault.
    The dashboard server auto-starts LightRAG on boot (when
    .bizar/memory.json#lightrag.enabled is true). Use this command to:
      - manually trigger the startup hook against the current project
      - check whether the LightRAG server is up

  Environment:
    BIZAR_LIGHTRAG_AUTOSTART=0|false|no   Disable auto-start (default: enabled)
    BIZAR_MEMORY_VAULT=/path/to/vault     Override the memory vault location
  `);
}

/**
 * Resolve the project root for the lightrag command. We use `process.cwd()`
 * — the user is expected to run this from inside a Bizar project. If
 * `.bizar/memory.json` is missing, we still pass the cwd through and let
 * the hook's `resolveLightRAGConfig` fall back to defaults.
 */
function resolveProjectRoot() {
  return process.cwd();
}

async function runLightragCommand(lightragArgs) {
  const sub = lightragArgs[0];
  const flags = new Set(lightragArgs.slice(1).filter((a) => a.startsWith('-')));

  if (!sub || sub === '--help' || sub === '-h' || flags.has('--help') || flags.has('-h')) {
    showLightragHelp();
    return;
  }

  if (sub === 'autostart' || sub === 'start') {
    // Lazy import so the help text doesn't pay the cost of pulling in
    // memory-lightrag (and its transitive deps) on every command.
    const { lightragStartupHook, isRunning, resolveLightRAGConfig } = await import('../../bizar-dash/src/server/memory-lightrag.mjs');
    const projectRoot = resolveProjectRoot();
    console.log(chalk.dim(`  lightrag autostart: project=${projectRoot}`));

    // If the dashboard is running, prefer its endpoint (it owns the
    // server's lifecycle). Fall back to a direct hook call otherwise.
    if (!flags.has('--no-dashboard')) {
      try {
        const dashboardResult = await callDashboardAutostart();
        if (dashboardResult && dashboardResult.started) {
          console.log(chalk.green(`  ✓ lightrag auto-started via dashboard (pid=${dashboardResult.pid || '?'})`));
          return;
        }
        if (dashboardResult && dashboardResult.ok && !dashboardResult.started) {
          console.log(chalk.dim(`  · lightrag: ${dashboardResult.reason || 'already running'}`));
          return;
        }
      } catch (err) {
        // Dashboard unreachable — fall through to direct call. Common
        // case: user ran `bizar lightrag autostart` from a fresh shell
        // without the dashboard running.
        console.log(chalk.dim(`  · dashboard not reachable, running hook locally: ${err?.message || err}`));
      }
    }

    const r = await lightragStartupHook(projectRoot);
    if (r.ok && r.started) {
      console.log(chalk.green(`  ✓ lightrag started (pid=${r.pid || '?'})`));
    } else if (r.ok) {
      console.log(chalk.dim(`  · lightrag: ${r.reason || 'not started'}`));
    } else {
      console.log(chalk.yellow(`  ! lightrag autostart: ${r.error || r.reason || 'failed'}`));
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'status') {
    const { isRunning, resolveLightRAGConfig } = await import('../../bizar-dash/src/server/memory-lightrag.mjs');
    const projectRoot = resolveProjectRoot();
    const cfg = resolveLightRAGConfig(projectRoot);
    const running = await isRunning(cfg);
    console.log('');
    console.log(chalk.bold('  LightRAG status'));
    console.log('');
    console.log(`    ${chalk.dim('running:')}     ${running ? chalk.green('yes') : chalk.yellow('no')}`);
    console.log(`    ${chalk.dim('host:')}        ${cfg.host}:${cfg.port}`);
    console.log(`    ${chalk.dim('enabled:')}     ${cfg.enabled ? chalk.green('yes') : chalk.yellow('no')}`);
    console.log(`    ${chalk.dim('workingDir:')}  ${cfg.workingDir}`);
    console.log(`    ${chalk.dim('llmBinding:')}  ${cfg.llmBinding} (${cfg.llmModel})`);
    console.log(`    ${chalk.dim('embedding:')}   ${cfg.embeddingBinding} (${cfg.embeddingModel})`);
    console.log('');
    return;
  }

  console.error(chalk.red(`  ✗ Unknown lightrag subcommand: ${sub}`));
  showLightragHelp();
  process.exit(1);
}

/**
 * Call the dashboard's startup-hook endpoint if the dashboard is up.
 * Returns the JSON body on success, null if the dashboard is unreachable
 * (so the caller can fall back to a direct hook call).
 */
async function callDashboardAutostart() {
  // Read dashboard connection from the same files the other CLI commands use.
  const HOME = process.env.HOME || '/';
  const portFile = join(HOME, '.config', 'bizar', 'dashboard.port');
  const authFile = join(HOME, '.config', 'bizar', 'dash-auth.json');
  let port = 4321;
  let secret = '';
  try {
    if (existsSync(portFile)) {
      const parsed = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    }
  } catch { /* ignore */ }
  try {
    if (existsSync(authFile)) {
      const raw = JSON.parse(readFileSync(authFile, 'utf8'));
      secret = raw?.password || '';
    }
  } catch { /* ignore */ }
  const url = `http://127.0.0.1:${port}/api/lightrag/autostart`;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) {
    return null;
  }
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export async function run(name, args, isHelpRequest) {
  await runLightragCommand(args);
}
