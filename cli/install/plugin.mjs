/**
 * cli/install/plugin.mjs
 *
 * installPluginFromGlobal() — copied from cli/install.mjs (original ~220 lines).
 * Installs the Bizar plugin from the global npm package into ~/.claude/plugins/bizar/.
 */

import chalk from 'chalk';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudeDir } from './paths.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Install the Bizar MCP server from this package's own `plugins/bizar/`
 * directory into `~/.claude/plugins/bizar/`.
 *
 * Symlink guard (v3.12.2): if the dest is a symlink (e.g. created by
 * `bizar dev-link`), do NOT overwrite it. Pass `{ force: true }` to override.
 *
 * node_modules copy: the plugin imports `@polderlabs/bizar-sdk`. After copying
 * the plugin files, this function also copies the source `node_modules/` to the
 * deployed `node_modules/` so Bun can resolve the import.
 *
 * Returns `true` if the plugin was installed (or already in place),
 * `false` otherwise. Never throws.
 */
export async function installPluginFromGlobal(opts = {}) {
  const { mkdir, readdir, copyFile } = await import('node:fs/promises');

  const destDir = join(resolveClaudeDir(), 'plugins', 'bizar');
  let destIsSymlink = false;
  try {
    destIsSymlink = lstatSync(destDir).isSymbolicLink();
  } catch {
    // doesn't exist yet — fine
  }

  if (destIsSymlink) {
    if (opts.silent) return true;
    console.log(chalk.yellow('  ⚠ ~/.claude/plugins/bizar is a dev symlink — skipping copy.'));
    console.log(chalk.dim('    Run `bizar dev-unlink` to restore the deployed copy, or pass --force to overwrite.'));
    if (!opts.force) return false;
    rmSync(destDir, { force: true });
  }

  let pluginPath;
  if (opts.sourceDir) {
    pluginPath = opts.sourceDir;
  } else {
    pluginPath = join(__dirname, '..', '..', 'plugins', 'bizar');
  }
  if (!existsSync(pluginPath)) {
    console.log(chalk.red(`  ✗ Plugin source not found at ${pluginPath}`));
    console.log(chalk.dim('    This package appears to be missing plugins/bizar/. Reinstall:'));
    console.log(chalk.dim('      npm install -g @polderlabs/bizar --force'));
    return false;
  }

  const distEntry = join(pluginPath, 'dist', 'index.js');
  if (!existsSync(distEntry)) {
    try {
      const { buildPlugin } = await import('../provision.mjs');
      const buildRes = await buildPlugin();
      if (buildRes.ok && !buildRes.skipped) {
        console.log(chalk.dim(`    auto-built plugin (${buildRes.message})`));
      } else if (!buildRes.ok) {
        console.log(chalk.yellow(`  ⚠ Plugin auto-build failed: ${buildRes.message}`));
        console.log(chalk.dim('    Run `bizar install` from a checkout, or:'));
        console.log(chalk.dim('      npx tsc -p plugins/bizar/tsconfig.json'));
        return false;
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Plugin auto-build threw: ${err.message}`));
      return false;
    }
  }

  await mkdir(destDir, { recursive: true });

  async function copyRecursive(srcDir, dstDir) {
    const entries = await readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = join(srcDir, entry.name);
      const dst = join(dstDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        await mkdir(dst, { recursive: true });
        await copyRecursive(src, dst);
      } else {
        if (entry.name === '.DS_Store' || entry.name.endsWith('.log')) continue;
        await copyFile(src, dst);
      }
    }
  }

  try {
    await copyRecursive(pluginPath, destDir);
    console.log(chalk.green(`  ✓ Bizar plugin installed from global package`));
    console.log(chalk.dim(`    ${pluginPath} → ${destDir}`));
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Failed to copy Bizar plugin: ${err.message}`));
    return false;
  }

  // node_modules copy — the plugin imports `@polderlabs/bizar-sdk`
  try {
    const srcNmDir = join(pluginPath, 'node_modules');
    if (existsSync(srcNmDir)) {
      const dstNmDir = join(destDir, 'node_modules');
      let dstNmIsSymlink = false;
      try {
        dstNmIsSymlink = lstatSync(dstNmDir).isSymbolicLink();
      } catch { /* doesn't exist — fine */ }
      if (dstNmIsSymlink) {
        console.log(chalk.yellow(`  ⚠ ${dstNmDir} is a symlink — refusing to copy node_modules (remove manually).`));
      } else {
        const srcEntries = await readdir(srcNmDir, { withFileTypes: true });
        await mkdir(dstNmDir, { recursive: true });
        async function copyNodeModules(srcDir, dstDir) {
          const entries = await readdir(srcDir, { withFileTypes: true });
          for (const entry of entries) {
            const src = join(srcDir, entry.name);
            const dst = join(dstDir, entry.name);
            if (entry.isDirectory()) {
              await mkdir(dst, { recursive: true });
              await copyNodeModules(src, dst);
            } else {
              await copyFile(src, dst);
            }
          }
        }
        await copyNodeModules(srcNmDir, dstNmDir);
        console.log(chalk.green(`  ✓ copied node_modules (${srcEntries.length} packages) to deployed plugin`));
      }
    }

    // Wire runtime deps (zod, @anthropic-ai/claude-agent-sdk)
    let pluginMain = null;
    try {
      const pkgPath = join(destDir, 'package.json');
      const pkg = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(pkgPath, 'utf8')));
      pluginMain = pkg.main;
    } catch { /* missing or unreadable */ }
    const needsWiring = typeof pluginMain === 'string' && pluginMain.endsWith('.ts');
    if (needsWiring) {
      try {
        const { wirePluginRuntimeDeps } = await import('../plugin-runtime-deps.mjs');
        await wirePluginRuntimeDeps(destDir);
      } catch (err) {
        console.log(chalk.dim(`  ℹ Could not auto-wire runtime deps: ${err.message} (run \`bizar doctor\` to diagnose)`));
      }
    }
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Failed to copy node_modules: ${err.message}`));
  }

  return true;
}
