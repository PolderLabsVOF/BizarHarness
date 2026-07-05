#!/usr/bin/env node
/**
 * cli/bin.mjs
 *
 * v4.6 — `bizar` runtime CLI entrypoint.
 *
 * Architecture:
 *   - `bizar` is the core runtime + installer + audit/init/export/update/artifact
 *     + service + dash commands.
 *   - The dashboard lives in `@polderlabs/bizar-dash` as a library.
 *   - Subcommand implementations are in `cli/commands/*.mjs`.
 *
 * Commands:
 *   install, audit, init, export, artifact, update, test-gate, service, dash,
 *   memory, headroom, minimax, usage, mod, doctor, repair, dev-link, dev-unlink,
 *   heads-up, bg, browser-harness-up, providers
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSetup, checkSetupStatus } from './bootstrap.mjs';

// ── Exit codes ─────────────────────────────────────────────────────────────────
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

// ── CLI version ───────────────────────────────────────────────────────────────

function readCliVersion() {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isHelpRequest = args.includes('--help') || args.includes('-h');
const isVersionRequest = args.includes('--version') || args.includes('-v');
const wantJson = args.includes('--json');
const wantDebug = args.includes('--debug');

if (wantDebug) {
  process.env.DEBUG = 'bizar:*';
  process.env.BIZAR_DEBUG = '1';
}

function dbg(...msg) {
  if (wantDebug) console.error('[DEBUG]', ...msg);
}

// When invoked with ONLY a global flag (e.g. `bizar --help` or
// `bizar --version`), strip it so `cmd` is undefined and we fall
// through to showHelp() / readCliVersion(). When invoked as
// `bizar <cmd> --help`, the flag stays for the subcommand to handle.
const onlyGlobalFlag = args.length === 1 && (args[0] === '--help' || args[0] === '-h' || args[0] === '--version' || args[0] === '-v' || args[0] === '--json');
const dispatchArgs = onlyGlobalFlag ? [] : args;

// ── Bootstrap ──────────────────────────────────────────────────────────────────
if (
  !args.includes('--postinstall') &&
  !args.includes('--check') &&
  !isHelpRequest &&
  !isVersionRequest &&
  !process.env.BIZAR_SKIP_INSTALL
) {
  await ensureSetup({ silent: true });
}

// ── Banner ─────────────────────────────────────────────────────────────────────

function showBanner() {
  console.log(chalk.bold.cyan('  ᛭ Bizar — Norse Pantheon Agent System for opencode'));
  console.log();
}

// ── Help ──────────────────────────────────────────────────────────────────────

function showHelp() {
  showBanner();
  console.log(`
  Usage:
    bizar <command> [options]

  Commands:
    install             Run the interactive installer
    audit               Run security audit on agent configuration
    init                Initialize .bizar/ in current project
    export [target]     Export agents/rules to another harness
    artifact <subcommand>  Manage visual artifacts
    test-gate           Detect & run the project's test suite
    update              Auto-update everything (opencode + bizar + dash + plugin)
    service             Manage the background service daemon
    dash <subcommand>   Manage the dashboard (start/stop/status/cleanup/tui)
    memory <subcommand> Manage project memory (Bizar Memory Service)
    headroom <subcommand> Manage Headroom context compression
    minimax <subcommand>   Manage MiniMax Token Plan integration
    mod <subcommand>       Manage mods (install/upgrade/list via the dashboard API)
    usage                 Show compact usage analytics summary (24h rolling)
    doctor              Check the BizarHarness install for health issues
    repair              Fix common install issues
    dev-link            Symlink local plugin source into opencode's plugin dir
    dev-unlink          Remove the dev symlink and restore the deployed copy
    heads-up <subcommand>  Manage pre-push / pre-release heads-ups
    bg <subcommand>     Manage background agents (list/view/kill/logs)
    browser-harness-up  Start Chromium for browser-harness (start/stop/status)
    providers detect    Auto-detect provider API keys from env + opencode.json

  Examples:
    bizar install
    bizar audit
    bizar dash start
    bizar dash start --bg
    bizar dash stop
    bizar doctor
    bizar update --all --dry-run

  Run \`bizar <command> --help\` for per-command help.

  Install:
    npm install -g @polderlabs/bizar
    npm install -g @polderlabs/bizar-dash
    npm install -g @polderlabs/bizar-plugin
  `);
}

// ── Command imports ────────────────────────────────────────────────────────────

async function importCommand(name) {
  try {
    return await import(`./commands/${name}.mjs`);
  } catch (err) {
    console.error(chalk.red(`  ✗ Failed to load command module '${name}': ${err && err.message ? err.message : String(err)}`));
    if (err && err.stack) {
      const lines = err.stack.split('\n').slice(0, 3);
      console.error(chalk.dim(lines.join('\n')));
    }
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (args.includes('--check')) {
    const status = checkSetupStatus();
    if (wantJson) process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    else console.log(JSON.stringify(status, null, 2));
    process.exit(status.needed ? EXIT_ERROR : EXIT_OK);
    return;
  }

  if (args.includes('--setup') || args.includes('--postinstall')) {
    await ensureSetup({ silent: false });
    process.exit(EXIT_OK);
    return;
  }

  if (isVersionRequest) {
    console.log(readCliVersion());
    return;
  }

  const [cmd, ...cmdArgs] = dispatchArgs;

  if (!cmd) {
    if (isVersionRequest) {
      console.log(readCliVersion());
      return;
    }
    showHelp();
    process.exit(EXIT_OK);
    return;
  }

  if (isHelpRequest && !cmd.startsWith('-')) {
    // Pass --help to the command
    const mod = await importCommand(cmd);
    if (mod && typeof mod.run === 'function') {
      await mod.run(cmd, cmdArgs, true);
      return;
    }
  }

  // `bizar help` — explicit help alias
  if (cmd === 'help') {
    showHelp();
    process.exit(EXIT_OK);
    return;
  }

  // Dispatch to command modules
  switch (cmd) {
    case 'install':
    case 'update': {
      const mod = await importCommand('install');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load install command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'install');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'service': {
      const mod = await importCommand('service');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load service command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'service');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'dash':
    case 'dashboard': {
      const mod = await importCommand('dash');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load dash command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'dash');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'minimax': {
      const mod = await importCommand('minimax');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load minimax command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'minimax');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'headroom': {
      const mod = await importCommand('headroom');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load headroom command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'headroom');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'mod': {
      const mod = await importCommand('mod');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load mod command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'mod');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'artifact': {
      const mod = await importCommand('artifact');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load artifact command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'artifact');
      await mod.runArtifact(cmdArgs, { wantJson });
      dbg('command returned:', cmd);
      break;
    }

    case 'memory': {
      const mod = await importCommand('memory');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load memory command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'memory');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'usage': {
      const mod = await importCommand('usage');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load usage command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'usage');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    // All other utility commands
    case 'audit':
    case 'init':
    case 'export':
    case 'test-gate':
    case 'dev-link':
    case 'dev-unlink':
    case 'doctor':
    case 'repair':
    case 'heads-up':
    case 'bg':
    case 'digest':
    case 'browser-harness-up':
    case 'providers':
    case 'plan': {
      const mod = await importCommand('util');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load util command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'util');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      if (!found) {
        console.error(chalk.red(`  ✗ Unknown command: ${cmd}`));
        showHelp();
        process.exit(EXIT_ERROR);
      }
      break;
    }

    default: {
      console.error(chalk.red(`  ✗ Unknown command: ${cmd}`));
      showHelp();
      process.exit(EXIT_ERROR);
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

const thisFile = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === thisFile;
if (isMainModule) {
  await main().catch((err) => {
    console.error(chalk.red(`bizar: ${err && err.message ? err.message : String(err)}`));
    process.exit(EXIT_ERROR);
  });
}
