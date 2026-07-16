/**
 * cli/migrate.mjs — `bizar migrate` subcommand.
 *
 * v10.3.0 — One-time migration path for users with v6.x-era installs.
 *
 * Detects:
 *   - ~/.config/cline/         (Cline-era Claude Code config)
 *   - ~/.config/bizar/        (Bizar runtime state, pre-v10)
 *
 * Moves both to ~/.claude/ (canonical Claude Code path).
 *
 * Idempotent — leaves a .migration-stamp file so it never re-runs.
 * `--check` reports state without modifying anything.
 */

import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @typedef {{ hasLegacyClaude: boolean, hasLegacyBizar: boolean, paths: string[] }} LegacyInfo */

/**
 * Detect legacy install state.
 * @param {string} home - home directory path
 * @returns {LegacyInfo}
 */
export function detectLegacyInstall(home) {
  const legacyClaude = join(home, '.config', 'cline');
  const legacyBizar = join(home, '.config', 'bizar');
  const paths = [];
  const hasLegacyClaude = existsSync(legacyClaude);
  const hasLegacyBizar = existsSync(legacyBizar);
  if (hasLegacyClaude) paths.push(legacyClaude);
  if (hasLegacyBizar) paths.push(legacyBizar);
  return { hasLegacyClaude, hasLegacyBizar, paths };
}

/**
 * Check if migration has already run.
 * @param {string} home - home directory path
 * @returns {boolean}
 */
export function isAlreadyMigrated(home) {
  const stamp = join(home, '.claude', 'bizar', '.migration-stamp');
  return existsSync(stamp);
}

/**
 * Write the migration stamp file.
 * @param {string} home - home directory path
 * @param {string} version - version string
 */
export function markMigrated(home, version) {
  const dir = join(home, '.claude', 'bizar');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = join(dir, '.migration-stamp');
  writeFileSync(stamp, `migrated=${version}\n`);
}

/**
 * Run the migration.
 * @param {{ dryRun?: boolean, force?: boolean, home?: string }} opts
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function migrateLegacy({ dryRun = false, force = false, home = homedir() } = {}) {
  const legacy = detectLegacyInstall(home);

  if (!legacy.hasLegacyClaude && !legacy.hasLegacyBizar) {
    return { ok: true, message: 'No legacy install found — nothing to do.' };
  }

  if (isAlreadyMigrated(home) && !force) {
    return { ok: true, message: 'Already migrated — stamp found. Use --force to re-run.' };
  }

  if (dryRun) {
    const what = [];
    if (legacy.hasLegacyClaude) what.push(`  ~/.config/cline/ → ~/.claude/`);
    if (legacy.hasLegacyBizar) what.push(`  ~/.config/bizar/ → ~/.claude/`);
    return {
      ok: true,
      message: `Dry run — would move:\n${what.join('\n')}`,
    };
  }

  // Ensure ~/.claude/ exists
  const claudeDir = join(home, '.claude');
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  // Move ~/.config/cline/ → ~/.claude/
  if (legacy.hasLegacyClaude) {
    const src = join(home, '.config', 'cline');
    const dst = join(claudeDir);
    await moveAtomic(src, dst);
  }

  // Move ~/.config/bizar/ → ~/.claude/bizar/
  if (legacy.hasLegacyBizar) {
    const src = join(home, '.config', 'bizar');
    const dst = join(claudeDir, 'bizar');
    await moveAtomic(src, dst);
  }

  markMigrated(home, '10.3.0');
  return { ok: true, message: 'Migration complete.' };
}

/**
 * Move src to dst atomically (rename), falling back to copy+delete on cross-device.
 * @param {string} src
 * @param {string} dst
 */
async function moveAtomic(src, dst) {
  try {
    renameSync(src, dst);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Cross-device: copy then delete
    cpSync(src, dst, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}

// ── CLI runner ─────────────────────────────────────────────────────────────────

/**
 * @param {string[]} args
 */
export async function runMigrate(args) {
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const check = args.includes('--check');
  const home = homedir();

  if (check) {
    const legacy = detectLegacyInstall(home);
    const migrated = isAlreadyMigrated(home);
    if (!legacy.hasLegacyClaude && !legacy.hasLegacyBizar) {
      console.log(chalk.green('No legacy install found.'));
    } else {
      console.log(chalk.yellow('Legacy install detected:'));
      if (legacy.hasLegacyClaude) console.log(`  ~/.config/cline/ (Cline-era config)`);
      if (legacy.hasLegacyBizar) console.log(`  ~/.config/bizar/ (Bizar pre-v10 state)`);
    }
    console.log(`Already migrated: ${migrated ? chalk.green('yes') : chalk.red('no')}`);
    return;
  }

  const result = await migrateLegacy({ dryRun, force });
  if (result.ok) {
    console.log(chalk.green(result.message));
  } else {
    console.error(chalk.red(result.message));
    process.exit(1);
  }
}
