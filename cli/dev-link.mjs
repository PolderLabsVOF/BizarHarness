/**
 * cli/dev-link.mjs
 *
 * v3.12.2 — `bizar dev-link` / `bizar dev-unlink` subcommands.
 *
 * The Bizar opencode plugin lives at:
 *   ~/.config/opencode/plugins/bizar   (the deployed copy, written by installPluginFromGlobal)
 *
 * When developing the plugin source under <repo>/plugins/bizar/, edits
 * don't auto-propagate to opencode because the deployed copy is a real
 * directory. `bizar dev-link` creates a symlink so that source edits
 * are picked up on the next opencode session. `bizar dev-unlink`
 * restores the deployed copy from the npm package.
 *
 * Symlink guard: installPluginFromGlobal refuses to overwrite a
 * symlink (the underlying `cp -r` would dereference it and silently
 * break the dev workflow). Combined with that guard, `bizar update` is
 * safe to run while a dev link is in place — it prints a warning and
 * leaves the link alone (use `--force` or `bizar dev-unlink` first).
 */
import chalk from 'chalk';
import {
  lstatSync,
  rmSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { opencodeConfigDir } from './utils.mjs';

/**
 * Path of the deployed plugin. Reads XDG_CONFIG_HOME / HOME at call
 * time so tests can mock HOME.
 */
function pluginDest() {
  return join(opencodeConfigDir(), 'plugins', 'bizar');
}

/**
 * Create a symlink from ~/.config/opencode/plugins/bizar to the
 * local source dir (default: <cwd>/plugins/bizar).
 *
 * Behavior:
 *   - dest does not exist         → create symlink
 *   - dest is a symlink           → replace it
 *   - dest is a real directory    → refuse unless opts.force
 *
 * Returns true on success, false on refusal.
 */
export function createDevLink(sourceDir = null, opts = {}) {
  const resolvedSource = resolve(process.cwd(), sourceDir ?? 'plugins/bizar');
  const dest = pluginDest();
  const parentDir = join(dest, '..');

  // Make sure ~/.config/opencode/plugins/ exists.
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Probe existing dest state. Use lstat so we see the symlink itself,
  // not its target.
  let existing = null;
  let isSymlink = false;
  try {
    existing = lstatSync(dest);
    isSymlink = existing.isSymbolicLink();
  } catch {
    // doesn't exist — we will create.
  }

  if (existing && !isSymlink) {
    if (!opts.force) {
      console.log(chalk.yellow(`  ⚠ ${dest} exists and is not a symlink.`));
      console.log(chalk.yellow(`    Refusing to overwrite the deployed copy.`));
      console.log(
        chalk.dim(
          `    Use --force to replace it, or remove it manually before running \`bizar dev-link\`.`,
        ),
      );
      return false;
    }
    console.log(chalk.yellow(`  ⚠ Replacing existing deployed copy at ${dest}`));
    rmSync(dest, { recursive: true, force: true });
  }

  if (isSymlink) {
    // Existing symlink (possibly stale) — remove before re-creating.
    rmSync(dest, { force: true });
  }

  symlinkSync(resolvedSource, dest);
  console.log(
    chalk.green(`  ✓ dev link created: ${dest} → ${resolvedSource}`),
  );
  console.log(
    chalk.dim(
      `    Edits to the source dir will now propagate to opencode on next session.`,
    ),
  );
  return true;
}

/**
 * Remove the dev symlink and restore the deployed plugin from npm.
 * Refuses to remove a real directory (would destroy the deployed copy)
 * unless opts.force is set.
 *
 * Returns true on success, false on refusal or error.
 */
export async function removeDevLink(opts = {}) {
  const dest = pluginDest();
  let isSymlink = false;
  let exists = false;
  try {
    const st = lstatSync(dest);
    exists = true;
    isSymlink = st.isSymbolicLink();
  } catch {
    // doesn't exist
  }

  if (!exists) {
    console.log(chalk.red(`  ✗ ${dest} does not exist — nothing to unlink.`));
    return false;
  }

  if (!isSymlink) {
    if (!opts.force) {
      console.log(
        chalk.red(
          `  ✗ ${dest} is not a symlink. Refusing to remove a real directory.`,
        ),
      );
      console.log(chalk.dim(`    Use --force if you really mean it.`));
      return false;
    }
    console.log(chalk.yellow(`  ⚠ Force-removing real directory at ${dest}`));
    rmSync(dest, { recursive: true, force: true });
  } else {
    rmSync(dest, { force: true });
  }

  // Restore from npm. installPluginFromGlobal is silent because we
  // already announced the unlink above; it will print its own brief
  // success message on the next line if a real copy was installed.
  try {
    const { installPluginFromGlobal } = await import('./install.mjs');
    await installPluginFromGlobal({ silent: true });
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ restore from npm failed: ${err.message}`));
  }

  // Read the installed version for the success message.
  let version = 'unknown';
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
    const pkgPath = join(root, '@polderlabs', 'bizar-plugin', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      version = pkg.version ?? 'unknown';
    }
  } catch {
    // informational only
  }

  console.log(
    chalk.green(
      `  ✓ dev link removed; deployed plugin restored from @polderlabs/bizar-plugin@${version}`,
    ),
  );
  return true;
}