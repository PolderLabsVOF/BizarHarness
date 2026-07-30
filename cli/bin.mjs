#!/usr/bin/env node
/**
 * cli/bin.mjs
 *
 * v4.6 — `bizar` runtime CLI entrypoint.
 *
 * Architecture:
 *   - `bizar` is the core runtime plus installer, audit, init, export,
 *     update, guarded team/subagent, cost, and claim commands.
 *   - Subcommand implementations are in `cli/commands/*.mjs`.
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

// ── Build guard ───────────────────────────────────────────────────────────────
// The tarball ships TypeScript source. Build the SDK once on entry.
if (
  !isHelpRequest &&
  !isVersionRequest &&
  !process.env.BIZAR_SKIP_BUILD
) {
  try {
    const { buildSdk } = await import('./provision.mjs');
    const sdkRes = await buildSdk();
    if (sdkRes.ok && !sdkRes.skipped) {
      console.error(chalk.dim(`  → ${sdkRes.message}`));
    }
  } catch (err) {
    // Best-effort: never abort the user command on a build hiccup.
    if (process.env.BIZAR_DEBUG) {
      console.error(chalk.dim(`  [build-guard] ${err.message}`));
    }
  }
}

// ── Banner ─────────────────────────────────────────────────────────────────────

function showBanner() {
  console.log(chalk.bold.cyan('  Bizar — guarded autonomous workflows for Claude Code'));
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
    migrate             Migrate retired ~/.config/cline/ config to ~/.claude/
    audit               Run security audit on agent configuration
    init                Initialize .bizar/ in current project
    export [target]     Export agents/rules to another harness
    test-gate           Detect & run the project's test suite
    update              Update Claude Code, Bizar, and the SDK
    doctor              Check the BizarHarness install for health issues
    repair              Fix common install issues
    heads-up <subcommand>  Manage pre-push / pre-release heads-ups
    browser                Install, update, and verify agent-browser
    backup                 Create / list / verify / delete backups of BizarHarness state
    restore                Restore BizarHarness from a backup
    validate               Validate the Bizar install
    setup-provider         Configure a provider in ~/.claude/settings.json (since v6.2.2 installer doesn't touch providers)
    team                   Run the office-manager orchestration agent
    subagent               Run a named agent in read-only plan mode
    run                    Run Claude Code once (optionally --bg)
    rca                    Analyze a GitHub issue (Claude Code CLI sample)
    cost <subcommand>      Atomic cost gate (SQLite-backed room budget tracker)
    claim <subcommand>     GitHub-style claim protocol over feature_list.json

  Examples:
    bizar install
    bizar audit
    bizar doctor
    bizar update --all --dry-run

  Run \`bizar <command> --help\` for per-command help.

  Install:
    npm install -g @polderlabs/bizar
    npm install -g @anthropic-ai/claude-code
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
    // Pass --help to the command. Commands dispatched through util.mjs
    // (audit, init, export, doctor, backup, restore, etc.) don't have
    // their own cli/commands/<name>.mjs — they all live in util.mjs.
    const UTIL_COMMANDS = new Set([
      'audit', 'init', 'export', 'test-gate',
      'doctor', 'repair', 'heads-up', 'backup', 'restore',
      'browser',
    ]);
    let mod;
    if (UTIL_COMMANDS.has(cmd)) {
      mod = await importCommand('util');
    } else if (cmd === 'install' || cmd === 'update') {
      mod = await importCommand('install');
    } else if (cmd === 'team' || cmd === 'subagent' || cmd === 'run') {
      mod = await importCommand('claude-cmd');
    } else if (cmd === 'migrate') {
      const { runMigrate } = await import('./migrate.mjs');
      await runMigrate(['--help']);
      return;
    } else {
      mod = await importCommand(cmd);
    }
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

    case 'migrate': {
      const { runMigrate } = await import('./migrate.mjs');
      await runMigrate(cmdArgs);
      break;
    }


    case 'validate': {
      const mod = await importCommand('validate');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load validate command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'validate');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (!found) {
        console.error(chalk.red(`  ✗ Unknown command: ${cmd}`));
        showHelp();
        process.exit(EXIT_ERROR);
      }
      break;
    }

    case 'setup-provider': {
      const mod = await importCommand('setup-provider');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load setup-provider command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'setup-provider');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (!found) {
        console.error(chalk.red(`  ✗ Unknown command: ${cmd}`));
        showHelp();
        process.exit(EXIT_ERROR);
      }
      break;
    }

    case 'team':
    case 'subagent':
    case 'run': {
      const mod = await importCommand('claude-cmd');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load claude-cmd module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'claude-cmd');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (!found) {
        console.error(chalk.red(`  ✗ Unknown command: ${cmd}`));
        showHelp();
        process.exit(EXIT_ERROR);
      }
      break;
    }

    case 'rca': {
      // Read-only GitHub Issue RCA through Claude Code plan mode.
      const mod = await importCommand('rca');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load rca command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'rca');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (!found) {
        console.error(chalk.red(`  ✗ Unknown command: ${cmd}`));
        showHelp();
        process.exit(EXIT_ERROR);
      }
      break;
    }

    case 'audit':
    case 'init':
    case 'export':
    case 'test-gate':
    case 'doctor':
    case 'repair':
    case 'heads-up':
    case 'backup':
    case 'restore':
    case 'browser': {
      const mod = await importCommand('util');
      if (!mod) {
        process.exit(EXIT_ERROR);
        return;
      }
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (!found) process.exitCode = EXIT_USAGE;
      break;
    }

    case 'sandbox': {
      // CubeSandbox (E2B-compatible KVM microVM) wrapper.
      const mod = await importCommand('sandbox');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load sandbox command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'sandbox');
      await mod.runSandbox(cmdArgs);
      break;
    }

    case 'cost': {
      // F-035 MetaHarness — atomic SQLite-backed cost gate.
      // Subcommands: register | status | reserve | commit | release | sweep | list
      const mod = await importCommand('cost');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load cost command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'cost');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (found === false) {
        console.error(chalk.red(`  ✗ Usage: bizar cost <subcommand> — run 'bizar cost --help'`));
        process.exit(EXIT_USAGE);
      }
      break;
    }

    case 'claim': {
      // F-035 MetaHarness — GitHub-style claim protocol over feature_list.json.
      // Subcommands: <featureId> | release | handoff | steal | status | list | transition
      const mod = await importCommand('claim');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load claim command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'claim');
      const found = await mod.run(cmd, cmdArgs, isHelpRequest);
      if (found === false) {
        console.error(chalk.red(`  ✗ Usage: bizar claim <subcommand> — run 'bizar claim --help'`));
        process.exit(EXIT_USAGE);
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
// Resolve symlinks: when invoked via a symlink (e.g. /home/user/.local/bin/bizar),
// process.argv[1] is the symlink path, but import.meta.url is the resolved target.
// Compare via realpath so main() runs regardless of how the script is invoked.
const { realpathSync } = await import('node:fs');
const resolvedArgv = (() => {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
})();
const isMainModule = resolvedArgv === thisFile;
if (isMainModule) {
  await main().catch((err) => {
    console.error(chalk.red(`bizar: ${err && err.message ? err.message : String(err)}`));
    process.exit(EXIT_ERROR);
  });
}
