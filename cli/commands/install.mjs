/**
 * cli/commands/install.mjs
 *
 * install + update command families.
 * v4.4.11+ — 'bizar install' and 'bizar update' share the same code path.
 */
import chalk from 'chalk';
import { runInstaller } from '../install.mjs';
import { runUpdate } from '../update.mjs';
import { runRepair } from '../repair.mjs';

// ── Help texts ──────────────────────────────────────────────────────────────────

export function showInstallHelp() {
  console.log(`
  bizar install — Run the unified BizarHarness installer

  Usage:
    bizar install                       Install (or refresh) every component
    bizar install --dry-run             Print what would happen, change nothing
    bizar install --force               Overwrite existing files AND prune stale
                                        entries in ~/.claude/{agents,skills,
                                        commands,rules,hooks}
    bizar install --yes                 Assume yes for any non-destructive prompt
    bizar install --help                Show this help

  Description:
    v4.4.7+ — unified installer. Same code path as 'bizar update'; the
    difference is just mode=install vs mode=update. Every step is
    idempotent — running this twice is safe.

    1. Installs @polderlabs/bizar via npm (skipped if already current).
    2. Shells to ./install.sh for platform-specific system dependencies.
    3. Syncs agent files, slash commands, and bundled skills into
       ~/.claude/ (or $CLAUDE_CONFIG_DIR).
    4. Registers the Bizar MCP server in ~/.claude/settings.json.
    5. Wires Claude Code lifecycle hooks (SessionStart / PreToolUse /
       PostToolUse / UserPromptSubmit) under ~/.claude/hooks/.
    6. Runs 'bizar doctor' as a post-install health check.

    No API key collection, no interactive prompts.
  `);
}

export function showUpdateHelp() {
  console.log(`
  bizar update — Update @anthropic-ai/claude-code + @polderlabs/bizar
  (which bundles the CLI, SDK, agents, skills, hooks, and commands). Detects what's
  installed and only touches what's missing or out of date.

  Usage:
    bizar update                       Update all installed Bizar components
    bizar update --check               Only print current vs. latest; do not update
    bizar update --channel=stable|beta Pick the npm dist-tag (default: stable)
    bizar update --dry-run             Print what would happen, change nothing
    bizar update --force               Override .bizar/PRE_PUSH_NOTES.md blockers
    bizar update --yes                 Same as --force, but named for one-line scripts
    bizar update --help                Show this help

  Components updated:
    @anthropic-ai/claude-code   the Claude Code CLI itself
    @polderlabs/bizar            CLI + SDK + agents + skills + hooks

  Behavior (v4.4.7+):
    • Single unified provisioner. 'bizar install' and 'bizar update' are
      the same code path with different mode flags. Every step is
      idempotent — re-running is safe.
    • Re-runs the provisioner so installed Claude Code surfaces match
      the just-upgraded npm version.
    • Runs 'bizar doctor' after a successful update to catch config
      regressions before claude tries to start.
    • With --check: prints the version matrix and release-notes excerpt
      between current and latest, exits non-zero if an update is available.

  Examples:
    bizar update                       Full auto-update (recommended)
    bizar update --check               Show version matrix + notes, do nothing
    bizar update --channel=beta        Upgrade to latest beta build
    bizar update --dry-run             Preview what would change

  Errors:
    Network failures (registry offline / DNS) and npm permission issues
    are surfaced with the raw npm output. The provisioner never silently
    swallows them — look for the ✗ marker in the step output.
  `);
}

// ── Command runners ────────────────────────────────────────────────────────────

function parseInstallFlags(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--mode=update') opts.mode = 'update';
  }
  return opts;
}

export async function install(args, isHelpRequest) {
  if (isHelpRequest) {
    showInstallHelp();
    return;
  }
  await runInstaller(parseInstallFlags(args));
  // v4.4.3 — After install, repair any stale bin symlinks so the
  // user picks up the new code.
  try {
    const r = await runRepair({});
    if (r.fixed.length > 0) {
      console.log(chalk.cyan('\n  Repair: repointed stale bin symlinks:'));
      for (const f of r.fixed) console.log(`    ${f}`);
      console.log(chalk.dim('    Re-run your shell or `hash -r` to pick up the new path.'));
    }
  } catch (err) {
    console.log(chalk.dim(`  Repair skipped: ${err.message}`));
  }
}

export async function update(args, isHelpRequest) {
  if (isHelpRequest) {
    showUpdateHelp();
    return;
  }
  await runUpdate(args);
}

// ── run() entry point (used by bin.mjs dispatcher) ──────────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name === 'install') {
    await install(args, isHelpRequest);
  } else if (name === 'update') {
    await update(args, isHelpRequest);
  }
}
