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
    bizar install --force               Overwrite existing files
    bizar install --with-mods a,b,c     Opt-in: install specific mods as part of the run
    bizar install --help                Show this help

  Description:
    v4.4.7+ — unified installer. Same code path as 'bizar update'; the
    difference is just mode=install vs mode=update. Every step is
    idempotent — running this twice is safe.

    1. Installs @polderlabs/bizar via npm (skipped if already current).
    2. Shells to ./install.sh for platform-specific system deps (uv,
       python3.12, jq, gh on Linux; brew on macOS) + service registration
       (systemd / launchd / Task Scheduler).
    3. Syncs agent files, slash commands, and bundled skills into
       ~/.config/opencode/.
    4. Copies plugins/bizar/ from the npm install into
       ~/.config/opencode/plugins/bizar/ (preserves dev symlinks).
    5. Patches ~/.config/opencode/opencode.json with the Bizar plugin
       entry (skipped if already present).
    6. Runs 'bizar doctor' as a post-install health check.

    No API key collection, no interactive prompts.
  `);
}

export function showUpdateHelp() {
  console.log(`
  bizar update — Update opencode + @polderlabs/bizar (which bundles the
  plugin and dashboard). Detects what's installed and only touches what's
  missing or out of date.

  Usage:
    bizar update                       Update EVERYTHING (default; auto-kills + restarts)
    bizar update --check               Only print current vs. latest; do not update
    bizar update --channel=stable|beta Pick the npm dist-tag (default: stable)
    bizar update --no-restart          Don't auto-restart the dashboard after update
    bizar update --dry-run             Print what would happen, change nothing
    bizar update --force               Override .bizar/PRE_PUSH_NOTES.md blockers
    bizar update --yes                 Same as --force, but named for one-line scripts
    bizar update --with-mods a,b,c     Opt-in: install specific mods as part of the run
    bizar update --help                Show this help

  Components updated:
    opencode-ai   the opencode CLI itself
    @polderlabs/bizar    this CLI + dashboard + plugin (one package)

  Behavior (v4.4.7+):
    • Single unified provisioner. 'bizar install' and 'bizar update' are
      the same code path with different mode flags. Every step is
      idempotent — re-running is safe.
    • Detects running Bizar instances (background service daemon, web
      dashboard) by reading ~/.config/bizar/{service,dashboard}.pid and
      cleans up any stale or empty PID files.
    • Auto-kills running instances with a brief notice.
    • Sends SIGTERM, waits up to 5s, escalates to SIGKILL if needed.
    • Re-runs the install script so the deployed plugin source matches
      the just-upgraded npm version (avoids the version-skew trap).
    • If the dashboard was running and bizar was updated, spawns a
      fresh detached dashboard process with the new code (skipped with
      --no-restart).
    • Runs 'bizar doctor' after a successful update to catch config
      regressions before opencode tries to start.
    • With --check: prints the version matrix and release-notes excerpt
      between current and latest, exits non-zero if an update is available.

  Examples:
    bizar update                       Full auto-update (recommended)
    bizar update --check               Show version matrix + notes, do nothing
    bizar update --channel=beta        Upgrade to latest beta build
    bizar update --dry-run             Preview what would change
    bizar update plugin --no-restart   Plugin-only, leave dashboard alone

  Errors:
    Network failures (registry offline / DNS) and npm permission issues
    are surfaced with the raw npm output. The provisioner never silently
    swallows them — look for the ✗ marker in the step output.
  `);
}

// ── parseWithMods flag ─────────────────────────────────────────────────────────

/**
 * v4.4.11 — Parse `--with-mods <csv>` from the given subargs slice.
 * Returns `null` if the flag isn't present (the provisioner's
 * "don't touch mods" default), or a string[] of mod ids if it is.
 */
export function parseWithModsFlag(subargs) {
  const idx = subargs.indexOf('--with-mods');
  if (idx === -1) return null;
  const raw = subargs[idx + 1];
  if (!raw || raw.startsWith('--')) {
    console.error('bizar: --with-mods requires a value (e.g. --with-mods a,b,c)');
    console.error('Usage: bizar install --with-mods <mod-id,mod-id>');
    process.exit(2);
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Command runners ────────────────────────────────────────────────────────────

export async function install(args, isHelpRequest) {
  if (isHelpRequest) {
    showInstallHelp();
    return;
  }
  // v4.4.11 — Parse --with-mods <csv> to opt into mod installs during the run.
  const withMods = parseWithModsFlag(args);
  await runInstaller({ withMods });
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
  const withMods = parseWithModsFlag(args);
  // Filter --with-mods <csv> out of subargs since the provisioner takes it via opts.
  const subargs = args.filter((a, i, arr) => {
    if (a === '--with-mods') return false;
    if (arr[i - 1] === '--with-mods') return false;
    return true;
  });
  await runUpdate(subargs, { withMods });
}

// ── run() entry point (used by bin.mjs dispatcher) ──────────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name === 'install') {
    await install(args, isHelpRequest);
  } else if (name === 'update') {
    await update(args, isHelpRequest);
  }
}
