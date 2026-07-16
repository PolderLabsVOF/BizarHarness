/**
 * cli/commands/claude-cmd.mjs
 *
 * v6.3.0 — Pass-through wrappers for Claude Code CLI commands that
 * Bizar wants to expose as `bizar <subcommand>` for consistency.
 *
 * Replaces `cli/commands/cline-cmd.mjs` (Cline-era).
 *
 * These are NOT reimaginings — they're thin pass-throughs that:
 *   1. Set sane defaults from Bizar's installed location
 *      (e.g. CLAUDE_CONFIG_DIR=~/.claude)
 *   2. Spawn the `claude` binary with the same args
 *   3. Stream the output through (with our chalk banner)
 *
 * Wrapped commands (mapped from the v6.2.x Cline originals):
 *   - bizar config      → `claude config`
 *   - bizar history     → reader over ~/.claude/sessions/ (no direct CLI)
 *   - bizar plugin      → `claude plugin <sub>`
 *   - bizar team        → `claude --agent <name> "..."` (out-of-session dispatch)
 *   - bizar subagent    → `claude --agent <agent> "..."`
 *   - bizar run         → `claude -p "<prompt>"` (one-shot) or `--bg` (background)
 *
 * Why: Bizar users already know the `bizar` CLI. Wrapping Claude Code
 * commands means they don't have to remember which binary owns which
 * feature.
 *
 * Migration from Cline (cline-cmd.mjs):
 *   - cline config   → claude config       (direct)
 *   - cline history  → no direct equivalent; we read ~/.claude/sessions/
 *   - cline hub      → claude plugin       (closest functional equivalent)
 *   - cline hook     → handled via settings.json hooks (this is config, not
 *                       a subcommand anymore)
 *   - cline --team-name → no direct equivalent; documented workaround is
 *                         `claude --agent <name> "..."`
 *   - cline subagent → claude --agent <name>
 *   - cline run      → claude -p <prompt>  (foreground) or claude --bg (background)
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

const HOMEDIR = process.env.HOME || process.env.USERPROFILE || '/tmp';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

/**
 * Resolve the Claude Code config directory.
 *
 * Mirrors Claude Code's own resolver. Used so all subcommands
 * delegate to the same `~/.claude/` directory that the rest of the
 * Bizar harness writes to via `cli/provision.mjs`.
 */
export function resolveClaudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()) {
    return process.env.CLAUDE_CONFIG_DIR.trim();
  }
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'Claude')
      : join(HOMEDIR, '.claude');
  }
  return join(HOMEDIR, '.claude');
}

/**
 * Resolve the claude binary. On most installs, `which claude` returns
 * the shim; we use that. Allow override via CLAUDE_BIN env var.
 */
function findClaudeBin() {
  if (CLAUDE_BIN && existsSync(CLAUDE_BIN)) return CLAUDE_BIN;
  // Default to PATH lookup via the spawn shell.
  return 'claude';
}

/**
 * Spawn `claude` with the given args, inheriting stdio.
 * Returns a promise that resolves with the exit code.
 */
export function spawnClaude(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const bin = findClaudeBin();
    const child = spawn(bin, args, {
      stdio: opts.stdio || 'inherit',
      env: {
        ...process.env,
        // Always use the standard Claude Code state dir unless
        // overridden. Claude Code uses CLAUDE_CONFIG_DIR for its
        // settings.json + agents/ + skills/ + commands/ + hooks/.
        ...(process.env.CLAUDE_CONFIG_DIR
          ? {}
          : { CLAUDE_CONFIG_DIR: resolveClaudeDir() }),
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

export function showClaudeCmdHelp() {
  console.log(`
  bizar <claude-cmd> — Pass-through wrappers for Claude Code CLI commands

  These commands delegate to the \`claude\` binary on your PATH so you
  don't have to remember which binary owns which feature.

  Available wrappers:
    bizar config      Show current configuration (mirrors \`claude config\`)
    bizar history     Read ~/.claude/sessions/ (no direct claude CLI)
    bizar plugin      Manage Claude Code plugins (mirrors \`claude plugin\`)
    bizar team <name> Spawn a coordinated agent team (wraps \`claude --agent\`)
    bizar subagent    Spawn a read-only research subagent (\`claude --agent\`)
    bizar run [prompt] One-shot Claude Code invocation (\`claude -p <prompt>\`)

  Examples:
    bizar config --json
    bizar plugin list
    bizar team auth-sprint "Plan and implement user auth with tests"
    bizar subagent mimir "Find all places where the auth token is verified"
    bizar run "fix the failing test in src/auth.test.ts"

  Related:
    /team            The matching Claude Code slash command (in session)
    bizar validate   Health check the Bizar install
    bizar doctor     Diagnose Claude Code-side issues
  `);
}

/**
 * `bizar config` — show current Claude Code configuration.
 * Thin wrapper around `claude config [options]`.
 */
export async function runClaudeConfig(args = []) {
  console.log(chalk.dim(`  (delegating to \`claude config\`)\n`));
  const code = await spawnClaude(['config', ...args]);
  process.exit(code);
}

/**
 * `bizar history` — list session history.
 *
 * Claude Code has no direct `history` subcommand (vs. Cline which had
 * `cline history`). We expose this as a best-effort reader over
 * `~/.claude/sessions/` — listing files and showing their mtime + size.
 */
export async function runClaudeHistory(args = []) {
  const sessionsDir = join(resolveClaudeDir(), 'sessions');
  if (!existsSync(sessionsDir)) {
    console.log(chalk.yellow(`  No sessions directory at ${sessionsDir}`));
    console.log(chalk.dim('  (Claude Code writes session files there when you exit a session.)'));
    return;
  }
  // Parse --limit N if provided
  let limit = 20;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0) {
    const n = parseInt(args[limitIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  const entries = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const fp = join(sessionsDir, e.name);
      const st = statSync(fp);
      return { name: e.name, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  console.log(chalk.cyan(`  ${entries.length} session(s) in ${sessionsDir}:\n`));
  for (const e of entries) {
    const t = new Date(e.mtime).toISOString().replace('T', ' ').slice(0, 19);
    console.log(`    ${t}  ${String(e.size).padStart(8)}B  ${e.name}`);
  }
}

/**
 * `bizar plugin <sub>` — manage the Claude Code plugin.
 * Thin wrapper around `claude plugin <subcommand>`.
 *
 * In Claude Code, plugin management is split across:
 *   - `claude plugin install <name>`  install from marketplace
 *   - `claude plugin list`             list installed plugins
 *   - `claude plugin enable <name>`    enable a plugin
 *   - `claude plugin disable <name>`   disable a plugin
 *   - `claude plugin remove <name>`    remove a plugin
 */
export async function runClaudePlugin(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar plugin — Manage Claude Code plugins\n'));
    console.log(chalk.dim('  Subcommands (passed through to `claude plugin`):'));
    console.log('    install <name>   Install a plugin from the marketplace');
    console.log('    list             List installed plugins');
    console.log('    enable <name>    Enable a plugin');
    console.log('    disable <name>   Disable a plugin');
    console.log('    remove <name>    Remove a plugin');
    console.log('');
    console.log(chalk.dim('  Note: For Bizar marketplace plugins, use `claude plugin install .` from the repo root.'));
    console.log('');
    return;
  }
  console.log(chalk.dim(`  (delegating to \`claude plugin ${args.join(' ')}\`)\n`));
  const code = await spawnClaude(['plugin', ...args]);
  process.exit(code);
}

/**
 * `bizar team <name> "mission" [...flags]` — spawn a coordinated agent
 * team from the CLI directly.
 *
 * Cline had `--team-name <name>`. Claude Code has no direct equivalent
 * (teams are coordinated via the Agent tool inside a session), but we
 * can simulate it by spawning `claude --agent <name>` with a team
 * prompt. Workaround for batch / scripting use cases.
 *
 * For full multi-agent orchestration, run `claude` interactively.
 *
 * Example:
 *   bizar team auth-sprint "Plan and implement user auth with tests" \
 *     --provider litellm --model minimaxcustom/MiniMax-M3
 */
export async function runClaudeTeam(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar team — Spawn a coordinated agent team from the CLI\n'));
    console.log(chalk.dim('  Usage:'));
    console.log('    bizar team <name> "mission" [--provider X] [--model Y] [more flags]');
    console.log('');
    console.log(chalk.dim('  Workaround for batch / scripted use cases. Claude Code'));
    console.log(chalk.dim('  coordinates teams via the Agent tool INSIDE a session; the'));
    console.log(chalk.dim('  out-of-session equivalent is `claude --agent <name> "..."`.'));
    console.log(chalk.dim('  Run `claude` interactively for full multi-agent orchestration.'));
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
  // `claude -p "<prompt>" --agent <name>` is the closest out-of-session
  // equivalent. The `--agent` flag picks the named agent (loaded from
  // `~/.claude/agents/<name>.md`).
  const code = await spawnClaude([
    '-p', mission,
    '--agent', name,
    ...rest,
  ]);
  process.exit(code);
}

/**
 * `bizar subagent <agent> "task"` — spawn a quick read-only research
 * subagent via `claude --agent <name> "..."`.
 *
 * Note: Claude Code's in-session subagent dispatch uses the `Agent`
 * tool (when the model decides to delegate). The `claude --agent
 * <name>` out-of-session form launches a fresh Claude Code run with
 * the named agent loaded.
 */
export async function runClaudeSubagent(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar subagent — Spawn a quick read-only research subagent\n'));
    console.log(chalk.dim('  Subagents are research agents. They run in parallel, '));
    console.log(chalk.dim('  keep their own context window, and return a focused report.'));
    console.log(chalk.dim('  Use them for broad codebase exploration without burning context.\n'));
    console.log('');
    console.log(chalk.dim('  Usage:'));
    console.log('    bizar subagent <agent> "task"');
    console.log('');
    console.log(chalk.dim('  Note: for IN-SESSION subagent dispatch, use the Agent tool'));
    console.log(chalk.dim('  Claude Code provides automatically. This wrapper uses'));
    console.log(chalk.dim('  `claude --agent <name> "..."` for OUT-OF-SESSION use.'));
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
  // Claude Code CLI's --agent flag dispatches into a named agent
  // role loaded from ~/.claude/agents/<name>.md.
  const filteredArgs = rest.filter((a) => a !== task);
  const code = await spawnClaude([
    '--agent', agent,
    '-p', task,
    ...filteredArgs,
  ]);
  process.exit(code);
}

/**
 * `bizar run [prompt]` — alias for `claude -p <prompt>` (one-shot run)
 * or `claude --bg -p <prompt>` (background). Useful for piping work
 * into Claude Code from a shell script.
 *
 * Example:
 *   bizar run "fix the failing test in src/auth.test.ts"
 *   bizar run --bg "monitor /var/log/auth.log"
 */
export async function runClaudeRun(args = []) {
  if (args.length === 0) {
    console.log(chalk.cyan('  bizar run — One-shot Claude Code invocation\n'));
    console.log(chalk.dim('  Usage:'));
    console.log('    bizar run "fix the failing test in src/auth.test.ts"');
    console.log('    bizar run --bg "monitor /var/log/auth.log"   # background');
    console.log('');
    console.log(chalk.dim('  Maps to `claude -p "<prompt>"` (foreground) or `claude --bg -p <prompt>` (background).'));
    return;
  }
  const bg = args.includes('--bg');
  const filtered = args.filter((a) => a !== '--bg');
  const prompt = filtered.join(' ');
  const code = await spawnClaude(bg ? ['--bg', '-p', prompt] : ['-p', prompt]);
  process.exit(code);
}

// ── run() entry point (used by bin.mjs dispatcher) ─────────────────────────

export async function run(name, args, isHelpRequest) {
  // Note: bin.mjs dispatcher calls run('team', [], false) etc.
  // So `name` here is the subcommand itself.
  if (name === 'config') { await runClaudeConfig(args); return true; }
  if (name === 'history') { await runClaudeHistory(args); return true; }
  if (name === 'plugin') { await runClaudePlugin(args); return true; }
  if (name === 'team') { await runClaudeTeam(args); return true; }
  if (name === 'subagent') { await runClaudeSubagent(args); return true; }
  if (name === 'run') { await runClaudeRun(args); return true; }
  // Fallback: show help.
  showClaudeCmdHelp();
  return true;
}
