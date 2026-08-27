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
import { parseFlags } from '../provision.mjs';

// ── Help texts ──────────────────────────────────────────────────────────────────

export function showInstallHelp() {
  console.log(`
  bizar install — Run the unified BizarHarness installer

  Usage:
    bizar install                       Install (or refresh) every component
    bizar install --dry-run             Print what would happen, change nothing
    bizar install --force               Full clean install: wipe Bizar-managed dirs,
                                        back up settings env vars, re-sync everything
                                        from the repo. Preserves ~/.config/bizar/
                                        login state. Combine with --yes to skip prompts.
    bizar install --deep                Alias for --force (clean-install semantics)
    bizar install --yes                 Assume yes for any non-destructive prompt
    bizar install --help                Show this help

  Description:
    v4.4.7+ — unified installer. Same code path as 'bizar update'; the
    difference is just mode=install vs mode=update. Every step is
    idempotent — running this twice is safe.

    F-183 (v10.16.2+) — --force promotes the install from
    overwrite+prune-stale to a fully clean install. It wipes:
      - ~/.claude/{agents,skills,commands,hooks,rules,workflows,plugins}/
      - ~/.agents/ (shared skill-registry + lock)
      - ~/.claude/settings.json (env vars backed up to BIZAR_SAVED_ENV)
    and preserves:
      - ~/.config/bizar/ (login state, telemetry, model picks, worktree-queue)
      - ~/.claude/.credentials.json, statsig/, .playwright-mcp/
      - any user-created subdirs under ~/.claude/ outside the managed set

    The freshly-emitted settings.json inherits the F-181 wildcard
    permissions.allow expansion and the F-176 empty deny/ask lists
    while the prior ANTHROPIC_* and BIZAR_* env vars are merged back
    in from the stash.

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
export async function install(args, isHelpRequest) {
  if (isHelpRequest) {
    showInstallHelp();
    return;
  }
  // parseFlags lives in cli/provision.mjs and is the canonical argv
  // parser for the installer family. Reusing it keeps install and
  // update in lockstep on flag semantics. --deep is parsed as an
  // alias for --force (clean-install semantics, F-183).
  const { mode, dryRun, force, yes } = parseFlags(args);
  const result = await runInstaller({ mode, dryRun, force, yes });
  // F-183 — print a one-line summary of the wipe scope so operators
  // can see at a glance what changed without re-reading the verbose
  // step list.
  if (force && result?.clean) {
    console.log('');
    console.log(chalk.cyan(`  Summary (F-183): wiped ${result.clean.wiped.length} path(s); preserved ${result.clean.preserved.length} path(s).`));
    if (result.doctor) {
      const ok = result.doctor.failed === 0;
      console.log(chalk[ok ? 'green' : 'yellow'](`  Doctor: ${result.doctor.passed} passed, ${result.doctor.failed} failed.`));
    }
  }
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
