/**
 * cli/commands/install.mjs
 *
 * install + update command families.
 * v4.4.11+ — 'bizar install' and 'bizar update' share the same code path.
 *
 * v10.19.6 — `bizar update` now honors `--dry-run` / `--force` / `--yes`
 * the same way `bizar install` does. The previous implementation called
 * a legacy `runUpdate(args)` that swallowed every flag; this version
 * routes update through `parseFlags` + `runInstaller` + `runRepair` so
 * the documented flags actually do what they claim.
 */
import chalk from 'chalk';
import { runInstaller } from '../install.mjs';
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
    bizar install --yes                 Non-interactive install (CI/script friendly)
    bizar install --non-interactive     Alias for --yes
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

    1. Uses the already-installed @polderlabs/bizar package.
    2. Installs or updates Claude Code with Anthropic's native installer
       (never npm) when the native launcher is absent.
    3. Installs or updates OpenKan from npm as Bizar's default durable
       planning, progression, and PRD-goal runtime.
    4. Uses platform dependencies prepared by ./install.sh when invoked
       through that bootstrap.
    5. Syncs agent files, slash commands, and bundled skills into
       ~/.claude/ (or $CLAUDE_CONFIG_DIR).
    6. Registers the Bizar MCP server in ~/.claude/settings.json.
    7. Wires Claude Code lifecycle hooks (SessionStart / PreToolUse /
       PostToolUse / UserPromptSubmit) under ~/.claude/hooks/.
    8. In a terminal, confirms the install and securely asks for a provider
       URL and key only when they are not already configured. Fresh setups
       can also choose a default model, agent teams, OpenKan home, and whether
       to initialise the current project's .ok/ workspace.
    9. Runs 'bizar doctor' as a post-install health check.

    Provider settings are global (~/.claude/settings.json), so they work from
    every project. Key input is hidden. Use --yes or --non-interactive to skip
    all prompts; missing provider values then produce actionable guidance.
  `);
}

export function showUpdateHelp() {
  console.log(`
  bizar update — Update @polderlabs/bizar (CLI + SDK + agents +
  skills + hooks + commands). Refreshing Claude Code itself is also
  handled when the bundled install.sh runs under --force.

  Usage:
    bizar update                       Refresh every Bizar-managed surface
    bizar update --dry-run             Print what would happen, change nothing
    bizar update --force | --deep      Full clean re-emit: wipe Bizar-managed
                                        dirs, back up settings env vars,
                                        re-sync everything from the repo
    bizar update --yes | -y            Assume yes for any non-destructive prompt
    bizar update --non-interactive     Alias for --yes
    bizar update --help                Show this help

  Behavior (v10.19.6+):
    Single unified provisioner — the same code path as 'bizar install'
    with mode=update. Every step is idempotent; re-running is safe.

    1. Ensures the bundled default OpenKan planning runtime is present and current.
    2. Re-emits skills, commands, rules, hooks, agents, and workflows
       from the repo source into ~/.claude/ (or $CLAUDE_CONFIG_DIR),
       overwriting only the Bizar-managed surface and pruning stale
       entries (F-141).
    3. Writes the install marker so subsequent runs short-circuit when
       nothing has changed.
    4. With --force, re-runs the F-183 clean-install flow: wipes
       ~/.claude/{agents,skills,commands,hooks,rules,workflows,plugins}/
       and ~/.agents/, stashes the prior settings.json env block into
       BIZAR_SAVED_ENV, then re-emits settings.json with the operator's
       ANTHROPIC_* and BIZAR_* keys union-merged back in (so gateway
       URL, auth token, and BIZAR_HOME are preserved across the wipe).
    5. Runs 'bizar doctor' after a successful update so config
       regressions surface before the next Claude Code session.
    6. Repairs stale bin symlinks so the operator picks up the new code
       on the next shell prompt.

  Idempotency note:
    When the SDK on disk matches the published npm version, every step
    above is a no-op — settings.json is rewritten only if its hash
    drifted, sync targets are skipped when the file set is unchanged,
    and the bin symlink repair short-circuits. A clean re-run is fast.

  Examples:
    bizar update                       Refresh the managed surface
    bizar update --dry-run             Preview every step
    bizar update --force               Full clean re-emit, preserved env
    bizar update --force --yes         Same, no prompts (script-friendly)

  Errors:
    Network failures (registry offline / DNS) and npm permission issues
    are surfaced with the raw npm output. The provisioner never silently
    swallows them — look for the ✗ marker in the step output.
  `);
}

// ── Shared post-install teardown ────────────────────────────────────────────────

/**
 * Run `runRepair({})` after install/update and surface any repointed
 * bin symlinks to the operator. Both `install()` and `update()` share
 * this block; the previous `bizar update` skipped it entirely (audit
 * A6), so a freshly-upgraded Bizar left stale bin symlinks pointing at
 * the prior install until the operator manually re-sourced their shell.
 *
 * @param {object} [opts]
 * @param {(opts: object) => Promise<{ ok: boolean, fixed: string[], notes?: string[] }>} [opts.runRepair]
 *   Dependency-injected for tests; defaults to the real `runRepair`.
 */
async function runPostInstallerRepair({ runRepair: runRepairDep = runRepair } = {}) {
  try {
    const r = await runRepairDep({});
    if (r.fixed.length > 0) {
      console.log(chalk.cyan('\n  Repair: repointed stale bin symlinks:'));
      for (const f of r.fixed) console.log(`    ${f}`);
      console.log(chalk.dim('    Re-run your shell or `hash -r` to pick up the new path.'));
    }
  } catch (err) {
    console.log(chalk.dim(`  Repair skipped: ${err.message}`));
  }
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
  await runPostInstallerRepair();
  // v10.19.6 — propagate install failure to the parent shell so
  // `bizar install && bizar doctor` short-circuits on install errors.
  if (!result?.ok) process.exit(1);
}

export async function update(args, isHelpRequest) {
  if (isHelpRequest) {
    showUpdateHelp();
    return;
  }
  // v10.19.6 — route update through the same flag-parsing + installer
  // pipeline as install so `--dry-run`, `--force`, `--yes`, etc. do
  // what they claim. See `runUpdateWithFlags` for the testable
  // dependency-injected core.
  await runUpdateWithFlags({ args });
}

/**
 * Testable core of `update()`. Default arguments bind to the real
 * `runInstaller` / `parseFlags` / `runRepair` from this module; tests
 * inject stubs to assert the wiring without touching disk.
 *
 * Sequence (mirrors install() so the audit's documented "Runs doctor +
 * runs repair" promises become true):
 *   1. `parseFlags(args)` → `{ mode, dryRun, force, yes }`
 *   2. `runInstaller({ mode, dryRun, force, yes })` — runs the
 *      provisioner, then post-install `runDoctor({ silent: true })`.
 *   3. `runRepair({})` — repoint stale bin symlinks.
 *   4. If `runInstaller` returned `{ ok: false }`, exit(1) so scripts
 *      that gate on the exit code (`bizar update && bizar doctor`) see
 *      the failure.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.args]
 * @param {(opts: { mode: string, dryRun: boolean, force: boolean, yes: boolean }) => Promise<{ ok?: boolean }>} [opts.runInstaller]
 * @param {(argv: string[]) => { mode: string, dryRun: boolean, force: boolean, yes: boolean }} [opts.parseFlags]
 * @param {(opts: { dryRun?: boolean }) => Promise<{ ok: boolean, fixed: string[] }>} [opts.runRepair]
 * @returns {Promise<{ ok?: boolean }>}
 */
export async function runUpdateWithFlags({
  args = [],
  runInstaller: runInstallerDep = runInstaller,
  parseFlags: parseFlagsDep = parseFlags,
  runRepair: runRepairDep = runRepair,
} = {}) {
  const { mode, dryRun, force, yes } = parseFlagsDep(args);
  const result = await runInstallerDep({ mode, dryRun, force, yes });
  await runPostInstallerRepair({ runRepair: runRepairDep });
  if (!result?.ok) process.exit(1);
  return result;
}

// ── run() entry point (used by bin.mjs dispatcher) ──────────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name === 'install') {
    await install(args, isHelpRequest);
  } else if (name === 'update') {
    await update(args, isHelpRequest);
  }
}
