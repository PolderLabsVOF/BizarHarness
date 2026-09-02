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
import { runInteractiveSetup, runToolSelection } from './interactive-setup.mjs';

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
 * F-202 — when the caller passes `opts.tools` (e.g. `['claude']` from
 * `--tools=claude` or `['claude','codex']` from `--all-tools`) the
 * guided tool-selection prompt is skipped; the install proceeds with
 * that exact selection. When `opts.tools` is `null` and stdin is a TTY,
 * the operator is asked which coding tools to install. The non-TTY
 * fallback always returns `['claude']` so CI scripts and pipes never
 * hang.
 *
 * @param {object} opts
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.force]   - overwrite existing files AND prune stale entries AND wipe dirs (F-183)
 * @param {boolean} [opts.quiet]   - Only print the location card
 * @param {string}  [opts.mode]    - 'install' | 'update'
 * @param {boolean} [opts.yes]     - assume yes for any non-destructive prompts
 * @param {string[]|null} [opts.tools] - F-202 coding-tool selection override
 */
export async function runInstaller(opts = {}) {
  const { dryRun = false, force = false, quiet = false, mode = 'install', yes = false, tools = null } = opts;

  if (quiet) {
    printInstallLocations({ dryRun, force });
    // F-202 — echo the resolved tool selection so callers (and tests) can
    // confirm the orchestrator saw the override even on the quiet path.
    return { ok: true, tools: Array.isArray(tools) ? tools.slice() : null, toolSelection: null };
  }

  showBanner();
  printInstallLocations({ dryRun, force });

  // F-202 — resolve the coding-tool selection. Pre-selected (from
  // --tools/--all-tools) wins; otherwise we ask interactively in a TTY,
  // or fall back to ['claude'] for non-interactive callers. Update runs
  // skip the prompt: the original install's selection is the source of
  // truth and is re-read from BIZAR_INSTALL_TOOLS by runProvision.
  let selectedTools = Array.isArray(tools) ? tools.slice() : null;
  let toolSelection = null;
  if (mode !== 'update' && !dryRun && !selectedTools) {
    toolSelection = await runToolSelection({ enabled: !yes });
    if (toolSelection?.ok) selectedTools = toolSelection.tools;
  }

  // A normal TTY install is a guided setup. Automation remains prompt-free
  // via --yes / --non-interactive, and update runs never request credentials.
  let interactive = null;
  if (mode !== 'update' && !dryRun) {
    interactive = await runInteractiveSetup({ enabled: !yes });
    if (!interactive.ok) return { ok: false, interactive };
    if (interactive.cancelled) return { ok: true, cancelled: true, interactive };
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
  // into the freshly-empty settings file.
  const provisionResult = await runProvision({ mode, dryRun, force: true, yes, tools: selectedTools });

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

  return { ...provisionResult, clean, interactive, tools: selectedTools, toolSelection };
}
