/**
 * cli/install/index.mjs
 *
 * Clean orchestrator: runInstaller() — rewritten as a thin coordinator
 * that delegates to the provisioner.
 */

import { runProvision } from '../provision.mjs';
import { showBanner, sectionHeading } from './banner.mjs';
import { printInstallLocations } from './paths.mjs';

/**
 * Thin orchestrator entry point.
 * @param {object} opts
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.force]   - overwrite existing files AND prune stale entries
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

  return runProvision({ mode, dryRun, force, yes });
}
