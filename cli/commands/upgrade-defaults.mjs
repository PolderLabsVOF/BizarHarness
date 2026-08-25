#!/usr/bin/env node
/**
 * cli/commands/upgrade-defaults.mjs
 *
 * `bizar upgrade-defaults` — re-apply the user-favored defaults to
 * ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json).
 *
 * What this does:
 *   1. Reads the existing settings.json without overwriting user-set
 *      values that are already in place.
 *   2. Sets the permissive defaults the Bizar user typically wants:
 *        - permissions.defaultMode  → "bypassPermissions"
 *        - worktree.bgIsolation     → "worktree"
 *        - model                    → "claude/minimax/MiniMax-M3"
 *        - alwaysThinkingEnabled    → true
 *        - effortLevel              → "high"
 *        - skipDangerousModePermissionPrompt → true
 *        - showThinkingSummaries    → true
 *        - askUserQuestionTimeout   → "5m"
 *   3. Refuses to downgrade any value the user has explicitly set to
 *      a more restrictive mode (e.g. a user who set
 *      defaultMode="default" gets to keep it).
 *   4. Preserves every unrelated key (mcpServers, hooks, env, etc.).
 *
 * Why this exists: the canonical config/claude/settings.json ships with
 * these defaults and `cli/provision.mjs` (F-163 scope-owned) is the
 * runtime installer. Until F-163 releases the file or its scope is
 * extended, this command lets the user apply the new defaults in one
 * call rather than editing the merged file by hand.
 */

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR?.trim() || join(HOME, '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

const FAVORED = {
  permissions: { defaultMode: 'bypassPermissions' },
  worktree: { bgIsolation: 'worktree' },
  model: 'claude/minimax/MiniMax-M3',
  alwaysThinkingEnabled: true,
  effortLevel: 'high',
  skipDangerousModePermissionPrompt: true,
  showThinkingSummaries: true,
  askUserQuestionTimeout: '5m',
};

function isAtLeastAsPermissive(existing, desired) {
  // Don't downgrade: if the user picked a stricter mode, keep theirs.
  const order = { default: 0, acceptEdits: 1, bypassPermissions: 2 };
  const e = order[existing];
  const d = order[desired];
  if (e === undefined || d === undefined) return existing === desired;
  return e >= d;
}

function deepAssign(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (
      v !== null
      && typeof v === 'object'
      && !Array.isArray(v)
      && target[k] !== null
      && typeof target[k] === 'object'
      && !Array.isArray(target[k])
    ) {
      deepAssign(target[k], v);
    } else if (target[k] === undefined) {
      target[k] = v;
    }
  }
}

function load() {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`failed to parse ${SETTINGS_PATH}: ${err.message}`);
  }
}

function diff(existing) {
  const proposed = JSON.parse(JSON.stringify(existing));
  deepAssign(proposed, FAVORED);
  // Permission-mode guard.
  const existingMode = existing?.permissions?.defaultMode;
  if (existingMode && !isAtLeastAsPermissive(existingMode, FAVORED.permissions.defaultMode)) {
    proposed.permissions.defaultMode = existingMode;
  }
  return proposed;
}

export async function runUpgradeDefaults(cmdArgs) {
  if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) {
    console.log(`
  bizar upgrade-defaults — re-apply the user-favored defaults to ~/.claude/settings.json.

  Usage:
    bizar upgrade-defaults [--dry-run] [--no-backup]

  Flags:
    --dry-run   Print the proposed diff without writing.
    --no-backup Skip the timestamped backup file.
`);
    return;
  }

  const dryRun = cmdArgs.includes('--dry-run');
  const noBackup = cmdArgs.includes('--no-backup');

  if (!existsSync(SETTINGS_PATH)) {
    console.error(chalk.red(`  ✗ ${SETTINGS_PATH} not found — run \`bizar install\` first`));
    process.exit(2);
  }

  const before = load();
  const after = diff(before);

  if (!noBackup && !dryRun) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${SETTINGS_PATH}.bak-${stamp}`;
    copyFileSync(SETTINGS_PATH, backup);
    console.log(chalk.dim(`  backup: ${backup}`));
  }

  if (dryRun) {
    console.log(JSON.stringify({ before, after }, null, 2));
    return;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(after, null, 2) + '\n');
  console.log(chalk.green('  ✓ updated'));
  console.log(chalk.dim(`  ${SETTINGS_PATH}`));
}