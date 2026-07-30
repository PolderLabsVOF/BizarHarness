/**
 * cli/bootstrap.mjs
 *
 * v3.2.2 — Self-bootstrap on first bin invocation.
 *
 * Explicit setup status and installation helper.
 *
 * Key design:
 *   - Checks for SETUP_MARKERS (odyssey files that prove setup was done)
 *   - If ALL markers exist → silent no-op
 *   - If ANY marker is missing → the explicit setup action runs the provisioner
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import { claudeAgentsDir, claudeConfigDir } from './utils.mjs';
import { runInstaller } from './install.mjs';

/**
 * Key files that prove setup has been run at least once.
 * If ALL exist → setup is considered complete.
 * If ANY are missing → setup is needed.
 */
const SETUP_MARKERS = [
  join(claudeAgentsDir(), 'office-manager.md'),
  join(claudeConfigDir(), 'settings.json'),
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
  console.log('\n  ⚡ First-time setup — Bizar needs to install Claude Code agents, hooks, skills, and settings...\n');
}

/**
 * Run setup if anything is missing.
 *
 * Options:
 *   autoApprove — if true, skip interactive prompts (BIZAR_SKIP_OPTIONAL_INSTALLS already set by caller)
 *   silent       — if true, suppress the "first-time setup" banner (used when invoked silently on bin entry)
 *
 * Idempotent: the provisioner skips already-installed components.
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

  await runInstaller({ mode: 'install' });
}
