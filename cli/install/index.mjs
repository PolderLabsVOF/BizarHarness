/**
 * cli/install/index.mjs
 *
 * Clean orchestrator: runInstaller() — rewritten as a thin coordinator
 * that delegates to the provisioner.
 */

import { runProvision, forceCleanInstall, clearSavedEnv } from '../provision.mjs';
import { runDoctor } from '../doctor.mjs';
import { showBanner, sectionHeading } from './banner.mjs';
import { printInstallLocations } from './paths.mjs';

/**
 * Thin orchestrator entry point.
 *
 * Behavior (v10.16.2+, F-183):
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
 *
 * @param {object} opts
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.force]   - overwrite existing files AND prune stale entries AND wipe dirs (F-183)
 * @param {boolean} [opts.quiet]   - Only print the location card
 * @param {string}  [opts.mode]    - 'install' | 'update'
 * @param {boolean} [opts.yes]     - assume yes for any non-destructive prompts
 */
export async function runInstaller(opts = {}) {
  const { dryRun = false, force = false, quiet = false, mode = 'install', yes = false } = opts;

  if (quiet) {
    printInstallLocations({ dryRun, force });
    return { ok: true };
  }

  showBanner();
  printInstallLocations({ dryRun, force });

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
  // into the freshly-empty settings file.
  const provisionResult = await runProvision({ mode, dryRun, force: true, yes });

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

  return { ...provisionResult, clean };
}