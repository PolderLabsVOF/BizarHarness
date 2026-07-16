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
 *   memory, minimax, usage, mod, doctor, repair, dev-link, dev-unlink,
 *   heads-up, bg, agent-browser, agent-browser-up, providers, deploy, plugin,
 *   marketplace, plan, digest, backup, restore, clip, ocr, voice, workspace, eval
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

// ── Build guard (v8.0.2) ─────────────────────────────────────────────────────
// The dashboard imports `packages/sdk/dist/memory/index.js` and the
// plugin loader expects `plugins/bizar/dist/index.js`. On a fresh npm
// install these directories are missing because the tarball ships only
// TS source. Build them once on entry so `bizar dash start` (and any
// other subcommand that touches the dashboard) never crashes with
// `Cannot find module .../packages/sdk/dist/memory/index.js` or
// `Plugin source not found at .../plugins/bizar`. Both builders are
// idempotent and skip when dist/ already exists.
if (
  !isHelpRequest &&
  !isVersionRequest &&
  !process.env.BIZAR_SKIP_BUILD
) {
  try {
    const { buildSdk, buildPlugin } = await import('./provision-claude.mjs');
    const sdkRes = await buildSdk();
    if (sdkRes.ok && !sdkRes.skipped) {
      console.error(chalk.dim(`  → ${sdkRes.message}`));
    }
    const plugRes = await buildPlugin();
    if (plugRes.ok && !plugRes.skipped) {
      console.error(chalk.dim(`  → ${plugRes.message}`));
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
  console.log(chalk.bold.cyan('  ᛭ Bizar — Norse Pantheon Agent System for Claude Code'));
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
    update              Auto-update everything (claude + bizar + dash + sdk)
    service             Manage the background service daemon
    dash <subcommand>   Manage the dashboard (start/stop/status/cleanup/tui)
    memory <subcommand> Manage project memory (Bizar Memory Service)
    lightrag <subcommand> Manage the LightRAG knowledge-graph server (status/start/autostart)
    minimax <subcommand>   Manage MiniMax Token Plan integration
    tailscale <subcommand> Manage Tailscale integration (auth, serve, status)
    mod <subcommand>       Manage mods (install/upgrade/list via the dashboard API)
    usage                 Show compact usage analytics summary (24h rolling)
    doctor              Check the BizarHarness install for health issues
    repair              Fix common install issues
    dev-link            Symlink local SDK source into Claude Code's plugin dir
    dev-unlink          Remove the dev symlink and restore the deployed copy
    heads-up <subcommand>  Manage pre-push / pre-release heads-ups
    bg <subcommand>     Manage background agents (list/view/kill/logs)
    deploy              One-click deploy to Vercel, Cloudflare, Fly.io, or Docker
    plugin <subcommand> Manage marketplace plugins (search/install/config/invoke)
    marketplace <subcommand>  Browse and install plugins from the public marketplace
    agent-browser      Install / update / verify the agent-browser CLI
    agent-browser-up    Start Chromium for agent-browser (start/stop/status)
    providers detect    Auto-detect provider API keys from env + ~/.claude/settings.json
    clip <subcommand>       Manage web clipper saved clips (list/delete/configure)
    ocr <subcommand>        OCR operations on images (list/process/configure)
    digest                 Manage weekly digests (list/view/generate)
    backup                 Create / list / verify / delete backups of BizarHarness state
    restore                Restore BizarHarness from a backup
    voice                  Manage voice notes (via the dashboard's HTTP API)
    workspace              Manage workspaces (via the dashboard's HTTP API)
    eval                   Evaluate AI agent outputs against golden fixtures
    plan                   [v6.0.0+] Reserved for future plan management
    validate               Validate the Bizar install (21 checks)
    setup-provider         Configure a provider in ~/.claude/settings.json (since v6.2.2 installer doesn't touch providers)
    config                 Show current Claude Code configuration (pass-through to claude config)
    history                List session history (pass-through to claude history)
    hub                    Manage the local hub daemon (pass-through to claude hub)
    hook                   Handle a hook payload from stdin (pass-through to claude hook)
    team                   Spawn an agent team from CLI (wraps claude --team-name)
    subagent               Spawn a read-only research subagent from CLI
    rca                    Analyze a GitHub issue (Claude Code CLI sample)
    cost <subcommand>      Atomic cost gate (SQLite-backed room budget tracker)
    claim <subcommand>     GitHub-style claim protocol over feature_list.json

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
      'audit', 'init', 'export', 'test-gate', 'dev-link', 'dev-unlink',
      'doctor', 'repair', 'heads-up', 'bg', 'digest', 'backup', 'restore',
      'agent-browser', 'update', 'providers', 'plan', 'validate',
      'setup-provider', 'config', 'history', 'hub', 'hook',
      'team', 'subagent', 'rca',
    ]);
    const UTIL_ALIASES = new Set(['dashboard', 'agent-browser-up']);
    let mod;
    if (UTIL_COMMANDS.has(cmd)) {
      // util-based commands: audit, init, etc.
      mod = await importCommand('util');
    } else if (UTIL_ALIASES.has(cmd)) {
      // util aliases: dashboard → dash, agent-browser-up → bash script
      if (cmd === 'dashboard') {
        mod = await importCommand('dash');
      } else if (cmd === 'agent-browser-up') {
        // Run via util.mjs's `agent-browser-up` case
        mod = await importCommand('util');
      }
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

    case 'tailscale': {
      const mod = await importCommand('tailscale');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load tailscale command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'tailscale');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'lightrag': {
      // v5.x — LightRAG management CLI (issue #6).
      // Subcommands: status, start, autostart.
      const mod = await importCommand('lightrag');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load lightrag command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'lightrag');
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

    case 'deploy': {
      const mod = await importCommand('deploy');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load deploy command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'deploy');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'plugin': {
      const mod = await importCommand('plugin');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load plugin command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'plugin');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'marketplace': {
      const mod = await importCommand('marketplace');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load marketplace command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'marketplace');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

      case 'clip': {
      const mod = await importCommand('clip');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load clip command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'clip');
      await mod.run(cmd, cmdArgs, isHelpRequest);
      dbg('command returned:', cmd);
      break;
    }

    case 'ocr': {
      const mod = await importCommand('ocr');
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load ocr command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      dbg('loaded command module:', 'ocr');
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
    case 'backup':
    case 'restore':
    case 'agent-browser':
    case 'agent-browser-up':
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

    case 'voice':
    case 'workspace':
    case 'eval': {
      // Each of these has its own module file in cli/commands/.
      const mod = await importCommand(cmd);
      if (!mod) {
        console.error(chalk.red(`  ✗ Could not load ${cmd} command module`));
        process.exit(EXIT_ERROR);
        return;
      }
      if (mod.run) await mod.run(cmd, cmdArgs, isHelpRequest);
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

    case 'config':
    case 'history':
    case 'hub':
    case 'hook':
    case 'team':
    case 'subagent': {
      // v6.3.0 — Pass-through wrappers for Claude Code CLI commands.
      // These live in cli/commands/claude-cmd.mjs.
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
      // v6.2.3 — GitHub Issue RCA sample (adapted from Cline docs).
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

    case 'sandbox': {
      // v6.3.0 — CubeSandbox (E2B-compatible KVM microVM) wrapper.
      // Subcommands: doctor | run | list | kill | install-template | config
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
// Resolve symlinks: when invoked via a symlink (e.g. /home/drb0rk/.local/bin/bizar),
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
