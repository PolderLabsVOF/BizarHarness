/**
 * cli/commands/cline-cmd.mjs
 *
 * v6.2.3 — Pass-through wrappers for Cline CLI commands that Bizar
 * wants to expose as `bizar <subcommand>` for consistency.
 *
 * These are NOT reimaginings — they're thin pass-throughs that:
 *   1. Set sane defaults from Bizar's installed location
 *      (e.g. CLINE_DIR=~/.cline, CLINE_PROVIDER_SETTINGS_PATH)
 *   2. Spawn the `cline` binary with the same args
 *   3. Stream the output through (with our chalk banner)
 *
 * Wrapped commands:
 *   - bizar config      → `cline config`
 *   - bizar history     → `cline history`
 *   - bizar plugin      → `cline plugin <sub>`
 *   - bizar hub         → `cline hub <sub>`
 *   - bizar hook        → `cline hook`  (handle hook payload from stdin)
 *   - bizar team        → `cline --team-name <name> "mission"`
 *      (spawn an agent team from the CLI directly, without the plugin)
 *
 * Why: Bizar users already know the `bizar` CLI. Wrapping Cline
 * commands means they don't have to remember which binary owns
 * which feature.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

const HOMEDIR = process.env.HOME || process.env.USERPROFILE || '/tmp';
const CLINE_BIN = process.env.CLINE_BIN || 'cline';

/**
 * Resolve the cline binary. On most installs, `which cline` returns
 * the shim; we use that. Allow override via CLINE_BIN env var.
 */
function findClineBin() {
  if (CLINE_BIN && existsSync(CLINE_BIN)) return CLINE_BIN;
  // Default to PATH lookup via the spawn shell.
  return 'cline';
}

/**
 * Spawn `cline` with the given args, inheriting stdio.
 * Returns a promise that resolves with the exit code.
 */
export function spawnCline(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const bin = findClineBin();
    const child = spawn(bin, args, {
      stdio: opts.stdio || 'inherit',
      env: {
        ...process.env,
        // Always use the standard Cline state dir unless overridden.
        ...(process.env.CLINE_DIR ? {} : { CLINE_DIR: join(HOMEDIR, '.cline') }),
        // The plugin already wires up the Cline data dir; pass it
        // through so `bizar config` and `bizar history` see the same
        // session/db the plugin sees.
        ...(process.env.CLINE_PROVIDER_SETTINGS_PATH ? {} : {}),
      },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      // Mirror the exit code so callers can chain commands.
      if (typeof code === 'number') resolve(code);
      else if (signal) resolve(128 + (typeof process.exitCode === 'number' ? process.exitCode : 0));
      else resolve(0);
    });
  });
}

export function showClineCmdHelp() {
  console.log(`
  bizar <cline-cmd> — Pass-through wrappers for Cline CLI commands

  These commands delegate to the \`cline\` binary on your PATH so you
  don't have to remember which binary owns which feature.

  Available wrappers:
    bizar config      Show current configuration (mirrors \`cline config\`)
    bizar history     List session history (mirrors \`cline history\`)
    bizar hub         Manage the local hub daemon (mirrors \`cline hub\`)
    bizar hook        Handle a hook payload from stdin (mirrors \`cline hook\`)
    bizar team <name> Spawn a coordinated agent team (wraps \`cline --team-name\`)
    bizar subagent    Spawn a read-only research subagent

  Note: Cline plugin management uses \`bizar plugin\` (Bizar's plugin
  marketplace) which already overlaps with the Cline plugin manager.
  Run \`cline plugin <sub>\` directly for the Cline one.

  Examples:
    bizar config --json
    bizar history --limit 20 --json
    bizar hub start
    bizar team auth-sprint "Plan and implement user auth with tests"
    bizar subagent mimir "Find all places where the auth token is verified"

  Related:
    /team            The matching Cline slash command (works inside a session)
    bizar validate   Health check the Bizar install
    bizar doctor     Diagnose Cline-side issues
  `);
}

/**
 * `bizar config` — show current Cline configuration.
 * Thin wrapper around `cline config [options]`.
 */
export async function runClineConfig(args = []) {
  console.log(chalk.dim(`  (delegating to \`cline config\`)\n`));
  const code = await spawnCline(['config', ...args]);
  process.exit(code);
}

/**
 * `bizar history` — list session history.
 * Thin wrapper around `cline history [options]`.
 */
export async function runClineHistory(args = []) {
  console.log(chalk.dim(`  (delegating to \`cline history\`)\n`));
  const code = await spawnCline(['history', ...args]);
  process.exit(code);
}

// NOTE: `bizar plugin` is already taken by the Bizar marketplace
// (cli/commands/plugin.mjs). To avoid the name collision, Cline's
// plugin manager is exposed as `cline plugin <sub>` directly via
// the cline CLI on PATH. Users who want Cline plugin management
// can also shell out via `bizar provider install <url>` or just
// run `cline plugin install <url>` themselves.

/**
 * `bizar hub <subcommand> [...args]` — manage the local hub daemon.
 * Thin wrapper around `cline hub <subcommand>`.
 */
export async function runClineHub(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar hub — Manage the local Cline hub daemon\n'));
    console.log(chalk.dim('  Subcommands (passed through to `cline hub`):'));
    console.log('    start             Start the hub daemon');
    console.log('    stop              Stop the hub daemon');
    console.log('    status            Show hub status');
    console.log('    logs              Show hub logs');
    console.log('');
    console.log(chalk.dim('  The hub daemon lets long-running tasks survive logout. '));
    console.log(chalk.dim('  Used by `--zen` mode and by scheduled agents.'));
    console.log('');
    return;
  }
  const code = await spawnCline(['hub', ...args]);
  process.exit(code);
}

/**
 * `bizar hook` — handle a hook payload from stdin.
 * Thin wrapper around `cline hook` (reads JSON from stdin and
 * runs the configured hook handler).
 */
export async function runClineHook(args = []) {
  // No banner — the hook payload is JSON, no room for chalk noise.
  const code = await spawnCline(['hook', ...args], { stdio: 'inherit' });
  process.exit(code);
}

/**
 * `bizar team <name> "mission" [...flags]` — spawn a coordinated agent
 * team from the CLI directly. Wraps `cline --team-name <name>`.
 *
 * This is the OUT-OF-SESSION equivalent of the `/team` slash command.
 * Useful for batch / scripting use cases where you want to fire off a
 * team mission from a shell script (e.g. a CI job, a cron, a webhook).
 *
 * Example:
 *   bizar team auth-sprint "Plan and implement user auth with tests" \
 *     --provider litellm --model minimaxcustom/MiniMax-M3
 */
export async function runClineTeam(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar team — Spawn a coordinated agent team from the CLI\n'));
    console.log(chalk.dim('  Usage:'));
    console.log('    bizar team <name> "mission" [--provider X] [--model Y] [more flags]');
    console.log('');
    console.log(chalk.dim('  This is the OUT-OF-SESSION equivalent of the /team slash command.'));
    console.log(chalk.dim('  Wraps `cline --team-name <name> "<mission>"`. Use it for batch'));
    console.log(chalk.dim('  / scripted / CI use cases where you want to fire a team mission'));
    console.log(chalk.dim('  without entering an interactive Cline session.'));
    console.log('');
    console.log(chalk.dim('  Examples:'));
    console.log('    bizar team auth-sprint "Plan and implement user auth with tests"');
    console.log('    bizar team release-prep "Check CHANGELOG, bump version, run /test"');
    console.log('    bizar team rca "Investigate why the build failed on PR #42"');
    console.log('');
    return;
  }
  // First positional arg = team name, second = mission prompt.
  const [name, mission, ...rest] = args;
  if (!name) {
    console.error(chalk.red('  ✗ Team name required'));
    console.error(chalk.dim('    Usage: bizar team <name> "mission"'));
    process.exit(2);
  }
  if (!mission) {
    console.error(chalk.red('  ✗ Mission prompt required'));
    console.error(chalk.dim('    Usage: bizar team <name> "mission"'));
    process.exit(2);
  }
  console.log(chalk.cyan(`\n  🚀 Spawning team '${name}'\n`));
  console.log(chalk.dim(`     Mission: ${mission}\n`));
  const code = await spawnCline(['--team-name', name, mission, ...rest]);
  process.exit(code);
}

/**
 * `bizar subagent <agent> "task"` — spawn a quick read-only research
 * subagent. This is the OUT-OF-SESSION equivalent of using
 * `use_subagents` inside Cline.
 *
 * Why it's separate from `bizar team`: subagents are fast/cheap and
 * read-only. They don't need team coordination. They're the right
 * tool for "go investigate X and report back".
 *
 * Note: Cline's `use_subagents` is a built-in tool that only works
 * INSIDE a Cline session. The `cline --yolo` / interactive flags
 * don't expose it directly. We shell out via the `--provider` flag
 * to force an immediate one-shot run.
 *
 * For programmatic subagent dispatch (from inside a Cline session),
 * use the `task` tool that Cline provides automatically when
 * `enableSpawnAgent: true` (the Bizar plugin sets this since v6.2.3).
 *
 * This function is a thin convenience: it just spawns a regular
 * Cline run with the agent name prefixed. For real subagent
 * orchestration, run `cline` interactively.
 */
export async function runClineSubagent(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar subagent — Spawn a quick read-only research subagent\n'));
    console.log(chalk.dim('  Subagents are read-only research agents. They run in parallel, '));
    console.log(chalk.dim('  keep their own context window, and return a focused report.'));
    console.log(chalk.dim('  Use them for broad codebase exploration without burning context.\n'));
    console.log('');
    console.log(chalk.dim('  Usage:'));
    console.log('    bizar subagent <agent> "task"');
    console.log('');
    console.log(chalk.dim('  Note: for IN-SESSION subagent dispatch, just ask the model'));
    console.log(chalk.dim('  to "use subagents" — Cline picks them up automatically when'));
    console.log(chalk.dim('  enableSpawnAgent=true (the Bizar default since v6.2.3).'));
    console.log('');
    return;
  }
  const [agent, ...rest] = args;
  const task = rest.find((a) => typeof a === 'string' && !a.startsWith('-'));
  if (!agent || !task) {
    console.error(chalk.red('  ✗ Usage: bizar subagent <agent> "task"'));
    process.exit(2);
  }
  console.log(chalk.cyan(`\n  🔍 Spawning subagent '${agent}'\n`));
  console.log(chalk.dim(`     Task: ${task}\n`));
  // We pass --agent <name> so Cline uses the named agent and
  // --auto-approve true to skip permission prompts for the
  // read-only subagent.
  const filteredArgs = rest.filter((a) => a !== task);
  const code = await spawnCline([
    '--agent', agent,
    '--auto-approve', 'true',
    `--system-prompt:subagent-research`,
    task,
    ...filteredArgs,
  ]);
  process.exit(code);
}

// ── run() entry point (used by bin.mjs dispatcher) ─────────────────────────

export async function run(name, args, isHelpRequest) {
  // Note: bin.mjs dispatcher calls run('team', [], false) etc.
  // So `name` here is the subcommand itself.
  if (name === 'config') { await runClineConfig(args); return true; }
  if (name === 'history') { await runClineHistory(args); return true; }
  if (name === 'hub') { await runClineHub(args); return true; }
  if (name === 'hook') { await runClineHook(args); return true; }
  if (name === 'team') { await runClineTeam(args); return true; }
  if (name === 'subagent') { await runClineSubagent(args); return true; }
  // Fallback: show help.
  showClineCmdHelp();
  return true;
}