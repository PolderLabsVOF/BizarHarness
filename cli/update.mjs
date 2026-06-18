/**
 * update.mjs — `bizar update` subcommand.
 *
 * Updates the opencode CLI, the @polderlabs/bizar package, and/or the
 * @polderlabs/bizar-plugin package. By default, prompts for each
 * component individually. With `--all`, updates everything without
 * prompting. With explicit subcommands (`opencode`, `bizar`, `plugin`),
 * runs only the named update.
 *
 * Each update is a thin wrapper around the underlying installer:
 *   - opencode:    `opencode upgrade` (or `npm install -g opencode-ai@latest` as a fallback)
 *   - bizar:       `npm install -g @polderlabs/bizar@latest`
 *   - plugin:      `npm install -g @polderlabs/bizar-plugin@latest`
 *
 * After the package updates, re-runs the install script so the locally
 * deployed plugin source matches the just-upgraded npm version. Without
 * this, the plugin in `~/.config/opencode/plugins/bizar/` would be one
 * version behind the npm registry, and the BUGS.md "version skew"
 * trap would bite.
 *
 * Exit codes:
 *   0 — all requested updates succeeded (or none were requested)
 *   1 — at least one update failed
 */

import chalk from 'chalk';
import { execSync, spawnSync } from 'node:child_process';

const PKG_MAIN = '@polderlabs/bizar';
const PKG_PLUGIN = '@polderlabs/bizar-plugin';

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Read the currently installed version of an npm package.
 * Returns `null` if not installed globally.
 */
function currentVersion(pkg) {
  try {
    const out = execSync(`npm ls -g ${pkg} --depth=0 --json`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString();
    const parsed = JSON.parse(out);
    const deps = parsed.dependencies ?? {};
    return deps[pkg]?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the latest version of an npm package from the registry.
 * Returns `null` if the registry is unreachable or the package is not published.
 */
function latestVersion(pkg) {
  try {
    const out = execSync(`npm view ${pkg} version`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Update actions
// ---------------------------------------------------------------------------

/**
 * Update opencode. Tries `opencode upgrade` first (the upstream installer's
 * own command); falls back to `npm install -g opencode-ai@latest`.
 * Returns `{ ok: boolean, message: string }`.
 */
function updateOpencode() {
  // Try `opencode upgrade` first — that's the canonical updater.
  const r1 = spawnSync('opencode', ['upgrade'], { stdio: 'inherit' });
  if (r1.status === 0) {
    return { ok: true, message: 'opencode updated via `opencode upgrade`' };
  }
  // Fall back to npm. `opencode-ai` is the npm package name.
  console.log(chalk.dim('  opencode upgrade not available; falling back to npm'));
  const r2 = spawnSync('npm', ['install', '-g', 'opencode-ai@latest'], { stdio: 'inherit' });
  if (r2.status === 0) {
    return { ok: true, message: 'opencode updated via npm' };
  }
  return { ok: false, message: 'opencode update failed — try `opencode upgrade` manually' };
}

/**
 * Update @polderlabs/bizar globally. Returns `{ ok, message }`.
 */
function updateBizar() {
  const r = spawnSync('npm', ['install', '-g', `${PKG_MAIN}@latest`], { stdio: 'inherit' });
  if (r.status !== 0) {
    return { ok: false, message: `${PKG_MAIN} update failed` };
  }
  return { ok: true, message: `${PKG_MAIN} updated` };
}

/**
 * Update @polderlabs/bizar-plugin globally. Returns `{ ok, message }`.
 */
function updateBizarPlugin() {
  const r = spawnSync('npm', ['install', '-g', `${PKG_PLUGIN}@latest`], { stdio: 'inherit' });
  if (r.status !== 0) {
    return { ok: false, message: `${PKG_PLUGIN} update failed` };
  }
  return { ok: true, message: `${PKG_PLUGIN} updated` };
}

// ---------------------------------------------------------------------------
// Re-run the install script so the locally deployed plugin matches npm
// ---------------------------------------------------------------------------

/**
 * After updating the npm packages, re-run the install script so the
 * plugin source on disk matches the just-installed version. This is the
 * fix for the BUGS.md "version skew" trap.
 */
function rerunInstallScript() {
  // Find the package root via `npm root -g` + package name. This works
  // whether the user installed via `npm install -g` or `npx`.
  let globalRoot;
  try {
    globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return { ok: false, message: 'could not locate npm global root; skipping install-script rerun' };
  }
  const pkgRoot = `${globalRoot}/${PKG_MAIN}`;
  const installSh = `${pkgRoot}/install.sh`;
  console.log(chalk.dim(`\n  Re-running install script at ${installSh}...`));
  const r = spawnSync('bash', [installSh], { stdio: 'inherit' });
  if (r.status !== 0) {
    return { ok: false, message: 'install script rerun failed' };
  }
  return { ok: true, message: 'install script re-run' };
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

/**
 * Interactive prompt for which components to update. Uses inquirer.
 * Returns a Set of `opencode`, `bizar`, `plugin` strings.
 */
async function promptForUpdates(forceAll) {
  if (forceAll) {
    return new Set(['opencode', 'bizar', 'plugin']);
  }
  // Dynamic import so the rest of the file can be loaded even if
  // inquirer is unavailable for some reason.
  const inquirer = await import('inquirer');
  const { selections } = await inquirer.default.prompt([
    {
      type: 'checkbox',
      name: 'selections',
      message: 'Which components do you want to update?',
      choices: [
        { name: 'opencode (the opencode CLI itself)', value: 'opencode', checked: true },
        { name: `bizar (${PKG_MAIN})`, value: 'bizar', checked: true },
        { name: `plugin (${PKG_PLUGIN})`, value: 'plugin', checked: true },
      ],
    },
  ]);
  return new Set(selections);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the update subcommand.
 *
 * @param {string[]} subargs - arguments after `bizar update`
 */
export async function runUpdate(subargs = []) {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ BIZAR UPDATE ᚦ\n'));

  // Show what we know before asking.
  const cur = {
    opencode: currentVersion('opencode-ai'),
    bizar: currentVersion(PKG_MAIN),
    plugin: currentVersion(PKG_PLUGIN),
  };
  const latest = {
    opencode: latestVersion('opencode-ai'),
    bizar: latestVersion(PKG_MAIN),
    plugin: latestVersion(PKG_PLUGIN),
  };

  console.log('  Installed vs. latest:');
  for (const k of Object.keys(cur)) {
    const label = k === 'plugin' ? PKG_PLUGIN : k === 'bizar' ? PKG_MAIN : 'opencode-ai';
    const c = cur[k] ?? '(not installed)';
    const l = latest[k] ?? '(unknown)';
    const same = c === l;
    console.log(`    ${label.padEnd(28)} ${c.padEnd(15)} → ${l}${same ? '  ✓ up to date' : '  ⤵ update available'}`);
  }
  console.log('');

  // Decide what to update.
  let selected;
  if (subargs.includes('--all')) {
    selected = new Set(['opencode', 'bizar', 'plugin']);
  } else if (subargs.length === 0) {
    selected = await promptForUpdates(false);
  } else {
    // Explicit subcommands.
    const valid = new Set(['opencode', 'bizar', 'plugin']);
    selected = new Set(subargs.filter((a) => valid.has(a)));
    if (selected.size === 0) {
      console.log(chalk.yellow(`  No valid components selected from: ${subargs.join(' ')}`));
      console.log(chalk.dim('  Valid components: opencode, bizar, plugin'));
      console.log(chalk.dim('  Run `bizar update --help` for usage.'));
      process.exit(1);
    }
  }

  if (selected.size === 0) {
    console.log(chalk.dim('  Nothing to update.'));
    return;
  }

  console.log(chalk.cyan(`  Updating: ${[...selected].join(', ')}\n`));

  const results = [];
  if (selected.has('opencode')) {
    console.log(chalk.bold('  → opencode'));
    results.push(['opencode', updateOpencode()]);
  }
  if (selected.has('bizar')) {
    console.log(chalk.bold(`  → ${PKG_MAIN}`));
    results.push(['bizar', updateBizar()]);
  }
  if (selected.has('plugin')) {
    console.log(chalk.bold(`  → ${PKG_PLUGIN}`));
    results.push(['plugin', updateBizarPlugin()]);
  }

  // Re-run the install script if anything was updated, so the deployed
  // plugin source matches the registry.
  const anySuccess = results.some(([, r]) => r.ok);
  if (anySuccess && (selected.has('bizar') || selected.has('plugin'))) {
    console.log('');
    const rerun = rerunInstallScript();
    if (rerun.ok) {
      console.log(chalk.green(`\n  ✓ ${rerun.message}`));
    } else {
      console.log(chalk.yellow(`\n  ⚠ ${rerun.message}`));
      console.log(chalk.dim('    Run `bash install.sh` from the Bizar repo manually.'));
    }
  }

  console.log('');
  console.log('  Summary:');
  for (const [name, r] of results) {
    const marker = r.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${marker} ${name.padEnd(10)} ${r.message}`);
  }

  const anyFail = results.some(([, r]) => !r.ok);
  if (anyFail) {
    console.log(chalk.yellow('\n  Some updates failed. See messages above.'));
    process.exit(1);
  }
  console.log(chalk.green('\n  ✓ Update complete\n'));
}
