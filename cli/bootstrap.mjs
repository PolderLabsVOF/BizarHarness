/**
 * cli/bootstrap.mjs
 *
 * v3.2.2 — Self-bootstrap on first bin invocation.
 *
 * Replaces the postinstall hook (which npm v10+ blocks by default).
 * Every `bizar` bin command now checks setup status on entry and runs
 * the postinstall logic automatically if anything is missing.
 *
 * Key design:
 *   - Checks for SETUP_MARKERS (odyssey files that prove setup was done)
 *   - If ALL markers exist → silent no-op
 *   - If ANY marker is missing → runs postinstall logic
 *   - Idempotent: already-installed components are skipped by the postinstall
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import { opencodeAgentsDir, opencodeConfigDir } from './utils.mjs';
import { runPostInstall } from './install.mjs';

/**
 * Key files that prove setup has been run at least once.
 * If ALL exist → setup is considered complete.
 * If ANY are missing → setup is needed.
 */
const SETUP_MARKERS = [
  join(opencodeAgentsDir(), 'odin.md'),           // core agent installed
  join(opencodeConfigDir(), 'plugins', 'bizar'),   // plugin installed
];

/**
 * Check which markers are currently present.
 * Returns { needed: true, missing: [...] } if any marker is absent.
 * Returns { needed: false } if all markers are present.
 */
export function checkSetupStatus() {
  const missing = SETUP_MARKERS.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return { needed: true, missing };
  }
  return { needed: false };
}

/**
 * Print a first-run setup message.
 * Uses chalk — kept minimal to avoid polluting stdout before the TUI loads.
 */
function printSetupBanner() {
  // Use console.log directly to avoid chalk formatting issues in non-TTY
  console.log('\n  ⚡ First-time setup — Bizar needs to install agents, plugin, RTK, Semble, Skills CLI...\n');
}

/**
 * Run setup if anything is missing.
 *
 * Options:
 *   autoApprove — if true, skip interactive prompts (BIZAR_SKIP_OPTIONAL_INSTALLS already set by caller)
 *   silent       — if true, suppress the "first-time setup" banner (used when invoked silently on bin entry)
 *
 * Idempotent: runPostInstall() skips already-installed components.
 */
export async function ensureSetup({ silent = false } = {}) {
  const status = checkSetupStatus();

  if (!status.needed) {
    return; // already done, nothing to do
  }

  // Something is missing — run setup
  if (!silent) {
    printSetupBanner();
  }

  await runPostInstall();
}
