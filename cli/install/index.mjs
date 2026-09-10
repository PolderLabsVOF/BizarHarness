/**
 * cli/install/index.mjs
 *
 * Clean orchestrator: runInstaller() — rewritten as a thin coordinator
 * that delegates to the provisioner.
 *
 * Wiring (commit 7 of the installer redesign):
 *
 *   1. Detection always runs (`detectInstalledAgents`) — read-only.
 *   2. Three routing modes:
 *        a. `mode === 'update'`            → skip wizard (F6)
 *        b. TTY + !yes + not update        → run the clack wizard
 *        c. non-TTY or --yes               → auto-detect mode
 *   3. `provision({ ..., targets, installClaudeCli })` runs at the end
 *      with the resolved `selectedTargets` and `installClaudeCli` flag.
 *
 * The wizard import is lazy so non-TTY / --yes paths never pull in
 * @clack/prompts (keeps the install.sh --non-interactive code path
 * dependency-free of clack).
 */

import chalk from 'chalk';
import nodeFs from 'node:fs';

import { runProvision, forceCleanInstall, clearSavedEnv } from '../provision.mjs';
import { runDoctor } from '../doctor.mjs';
import { runStatuslineInstall } from '../commands/statusline.mjs';
import { showBanner, sectionHeading } from './banner.mjs';
import { printInstallLocations } from './paths.mjs';
import { detectInstalledAgents } from './detect.mjs';

/**
 * Pick the auto-detected target list. Used by the auto-detect path
 * (non-TTY / --yes / update mode). Order matters: claude-code is
 * listed first so its configDir is the primary install surface.
 */
function pickAutoDetectedTargets(detected) {
  const out = [];
  if (detected && detected.claudeCode && detected.claudeCode.present) out.push('claude-code');
  if (detected && detected.desktop && detected.desktop.present) out.push('claude-desktop');
  return out;
}

/**
 * Validate that every requested target is detected. Used when the
 * operator passes `--targets=<csv>`; an undetected target is a hard
 * error so the user gets actionable feedback instead of a silent skip.
 */
function validateRequestedTargets(targets, detected) {
  const present = {
    'claude-code': !!(detected && detected.claudeCode && detected.claudeCode.present),
    'claude-desktop': !!(detected && detected.desktop && detected.desktop.present),
  };
  for (const t of targets) {
    if (!present[t]) return { ok: false, missing: t };
  }
  return { ok: true };
}

/**
 * Thin orchestrator entry point.
 *
 * Behavior:
 *   - When `force === true`, run `forceCleanInstall` *before*
 *     `runProvision` so the Bizar-managed dirs under `~/.claude/` and
 *     `~/.agents/` are wiped, `~/.claude/settings.json` is removed, and
 *     the prior env vars are stashed into `process.env.BIZAR_SAVED_ENV`
 *     for the factory to re-inject. We always pass `force: true` to
 *     `runProvision` regardless of how the caller phrased the flag.
 *   - After the provisioner completes, run `runDoctor({ silent: true })`
 *     and surface the result so forced installs surface a health summary.
 *   - The wipe report is returned to the caller (e.g. `bizar install`)
 *     so the CLI layer can print a summary of what changed.
 *   - Commit 7: the orchestrator owns three-mode routing (update /
 *     wizard / auto-detect). Wizard is lazy-imported so non-TTY paths
 *     don't pull in @clack/prompts.
 *
 * @param {object} opts
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.force]   - overwrite existing files AND prune stale entries AND wipe dirs (F-183)
 * @param {boolean} [opts.quiet]   - Only print the location card
 * @param {string}  [opts.mode]    - 'install' | 'update'
 * @param {boolean} [opts.yes]     - assume yes for any non-destructive prompts
 * @param {string[]} [opts.targets]  - explicit target list (CLI --targets flag); null = auto-detect
 * @param {boolean}  [opts.installClaudeCli] - explicit opt-in to Claude Code CLI native install
 * @param {string[]} [opts.forceTargets] - per-target managed-source override (CLI --force-targets flag)
 * @param {Function} [opts.statuslineInstall] - injectable statusline installer for tests
 * @param {Function} [opts.provision] - injectable provisioner for tests
 * @param {Function} [opts.wizard]    - injectable wizard for tests (default lazy-imported)
 * @param {Function} [opts.detect]    - injectable detection for tests (default detectInstalledAgents)
 * @param {boolean}  [opts.isTTY]     - override stdin TTY detection (tests default to false)
 * @param {object}   [opts.env]       - env passed to detect / wizard (default process.env)
 * @param {object}   [opts.fs]        - fs passed to detect / wizard (default node:fs)
 * @param {string}   [opts.cwd]       - cwd passed to detect / wizard (default process.cwd())
 */
export async function runInstaller(opts = {}) {
  const {
    dryRun = false,
    force = false,
    quiet = false,
    mode = 'install',
    yes = false,
    targets = null,
    installClaudeCli: installClaudeCliFlag = false,
    forceTargets = [],
    statuslineInstall = runStatuslineInstall,
    provision = runProvision,
    wizard = null,
    detect = detectInstalledAgents,
    isTTY = Boolean(process.stdin && process.stdin.isTTY),
    env = process.env,
    fs = nodeFs,
    cwd = process.cwd(),
  } = opts;

  if (quiet) {
    printInstallLocations({ dryRun, force });
    return { ok: true };
  }

  showBanner();
  printInstallLocations({ dryRun, force });

  // Detection always runs (read-only). The wizard and the auto-detect
  // path both consume the same shape so we don't branch I/O here.
  const detected = await detect({ env, fs, cwd });

  let selectedTargets = null;
  let installClaudeCli = false;
  let wizardState = null;

  if (mode === 'update') {
    // F6 — update runs skip the wizard regardless of TTY. Honour the
    // --targets flag if the operator pinned it; otherwise auto-detect.
    // installClaudeCli is forced false in update mode (F7 default).
    selectedTargets = Array.isArray(targets) && targets.length > 0
      ? targets.slice()
      : pickAutoDetectedTargets(detected);
    installClaudeCli = false;
  } else if (isTTY && !yes) {
    // TTY + !yes + not update → run the clack wizard. Pre-validate
    // --targets so we surface "X not detected" before dragging the
    // user through 9 pages of prompts. dryRun is honored inside the
    // wizard (or by the injected `provision` callback) — it does not
    // skip the wizard itself.
    if (Array.isArray(targets) && targets.length > 0) {
      const v = validateRequestedTargets(targets, detected);
      if (!v.ok) {
        console.log(chalk.yellow(`  ! target "${v.missing}" not detected on this host. Re-run without --targets to pick from detected surfaces.`));
        return {
          ok: false,
          detected,
          error: `target-not-detected:${v.missing}`,
          cancelled: false,
        };
      }
    }

    const wizardFn = wizard || (await import('./wizard.mjs')).runInstallWizard;
    wizardState = await wizardFn({
      detected,
      provision,
      env,
      fs,
      cwd,
      forceTargets,
    });

    if (!wizardState || wizardState.wizardStatus === 'cancelled' || wizardState.wizardStatus === 'failed') {
      const { getExitCode } = await import('./wizard.mjs');
      const code = getExitCode(wizardState);
      // F5 — terminal wizard state ends the process. Real CLI callers
      // expect this; tests never reach this branch because their
      // wizard mock always returns a 'done' state.
      process.exit(code || 1);
    }

    selectedTargets = Array.isArray(wizardState.selectedTargets) ? wizardState.selectedTargets : [];
    // CLI --install-claude-cli flag is the user-facing replacement for
    // the wizard opt-in: when set it overrides the wizard's selection
    // so a non-interactive flag wins over an interactive choice.
    installClaudeCli = installClaudeCliFlag || !!(wizardState.installClaudeCli);
  } else {
    // Auto-detect mode: non-TTY or --yes. Install into every detected
    // target the operator didn't pin away with --targets.
    selectedTargets = Array.isArray(targets) && targets.length > 0
      ? targets.slice()
      : pickAutoDetectedTargets(detected);
    installClaudeCli = installClaudeCliFlag;
    if (!quiet) {
      const summary = selectedTargets.length > 0 ? selectedTargets.join(', ') : '(none)';
      console.log(chalk.dim(`  auto-detect: targets=[${summary}]; installClaudeCli=${installClaudeCli}`));
    }
  }

  // F-183 — pre-provision wipe for forced installs. Force-clean is what
  // makes `--force` actually a clean install: dirs under ~/.claude/ are
  // wiped (BIZAR_HOME and third-party state preserved), settings.json
  // is removed, and the operator's env vars are stashed in
  // `process.env.BIZAR_SAVED_ENV` so the next `writeClaudeSettings` call
  // re-injects them after re-emitting the file from the template.
  let clean = null;
  if (force) {
    clearSavedEnv();
    clean = forceCleanInstall({ dryRun });
    if (!quiet && clean?.wiped?.length) {
      sectionHeading('Pre-install wipe (F-183)');
      console.log(`  wiped: ${clean.wiped.length} path(s)`);
      for (const p of clean.wiped) console.log(`    - ${p}`);
      if (clean.preserved?.length) {
        console.log(`  preserved: ${clean.preserved.length} path(s)`);
        for (const p of clean.preserved) console.log(`    - ${p}`);
      }
      console.log('');
    }
  }

  // Always pass `force: true` downstream so `runProvision` re-emits the
  // template-owned keys (permissions.allow wildcards, mcpServers, hooks)
  // into the freshly-empty settings file. Pass `targets` and
  // `installClaudeCli` so the provisioner can scope and opt-in
  // correctly per F-7 (commit 6) and the v2 plan §3.
  const provisionResult = await provision({
    mode,
    dryRun,
    force: true,
    yes,
    targets: selectedTargets,
    installClaudeCli,
    openkanHome: undefined,
    initializeOpenKanProject: false,
  });

  // Auto-install statusline (v10.29.2+). Skipped on dry-run, non-fatal on failure.
  // Idempotent: re-running is safe — updateStatuslineSettings re-writes the same field.
  if (!dryRun) {
    try {
      const statuslineResult = await statuslineInstall([]);
      if (statuslineResult?.ok) {
        provisionResult.statuslineInstalled = true;
      } else {
        console.log(chalk.yellow(`  ! statusline auto-install failed: ${statuslineResult?.error || 'unknown'}`));
      }
    } catch (err) {
      // Non-fatal: the user can still run `bizar statusline install` manually.
      console.log(chalk.yellow(`  ! statusline auto-install skipped: ${err?.message || err}`));
    }
  }

  // F-183 — post-install health check. Surfaced as a warning rather
  // than a hard failure so a forced install that completes without
  // error still reports its doctor summary; the operator decides
  // whether to investigate.
  if (!dryRun) {
    try {
      const doctorResult = await runDoctor({ silent: true });
      provisionResult.doctor = doctorResult;
      if (!quiet) {
        sectionHeading('Post-install doctor (F-183)');
        const ok = doctorResult.failed === 0;
        console.log(`  ${ok ? '✓' : '✗'} doctor: ${doctorResult.passed} passed, ${doctorResult.failed} failed`);
        if (doctorResult.failed > 0) {
          for (const r of doctorResult.results) {
            if (!r.ok) console.log(`    ✗ ${r.name}: ${r.message}`);
          }
        }
        console.log('');
      }
    } catch (err) {
      if (!quiet) console.log(`  ! doctor skipped: ${err?.message || err}`);
    }
  }

  // Note: wizardState is intentionally not returned — callers that need
  // to inspect it should depend on `selectedTargets` / `installClaudeCli`
  // instead, which are the resolved user-facing values regardless of
  // which routing branch produced them.

  return { ...provisionResult, clean, detected, selectedTargets, installClaudeCli };
}
