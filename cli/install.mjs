import chalk from 'chalk';
import boxen from 'boxen';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── ESM `__dirname` polyfill ────────────────────────────────────────────────
// `__dirname` is a CommonJS global. ESM modules don't have it. We define it
// at module scope so all functions in this file can use it without each
// having to recreate the polyfill. (v4.2.3 — previously only `runInstaller`
// had it, which caused the legacy `promptAndInstallOptional` bootstrap
// to crash with `ERR_AMBIGUOUS_MODULE_SYNTAX`. v6.1.0 — that helper
// has been removed; `__dirname` is still used by `runPostInstall` for
// the same reason.)
const __dirname = dirname(fileURLToPath(import.meta.url));

import { showBanner, showPantheon, sectionHeading } from './banner.mjs';
import { promptComponents, promptInstallMode, promptAgents, promptSkillPacks, promptApiKeys, promptConfirmInstall, promptRestartCline } from './prompts.mjs';
import { detectClaude, detectHeadroom, detectSemble, detectSkillsCli, detectUv, buildSummary, claudeAgentsDir, claudeConfigDir, repoPath } from './utils.mjs';
import { installAgents, installAgentsMd, installSkill, installClineJson, installBizarFolder, installPluginBizar, installHeadroom, installSemble, installSkillsCli, installCuratedSkills, installRules, installHooks, installCommands, installCommandsBizar, mergeToolsIntoUserConfig } from './copy.mjs';

const AGENT_FILES = [
  'odin.md', 'vor.md', 'frigg.md', 'quick.md',
  'mimir.md', 'heimdall.md', 'hermod.md', 'thor.md', 'baldr.md',
  'tyr.md', 'vidarr.md', 'forseti.md',
  'semble-search.md',
];

/**
 * Install the Bizar MCP server from this package's own `plugins/bizar/`
 * directory into `~/.claude/plugins/bizar/`.
 *
 * v6.3.0 — Bizar is Claude Code-native. The plugin entry-point still
 * ships at `plugins/bizar/` as a back-compat shim that re-exports the
 * SDK; the actual MCP server lives in `packages/sdk/src/mcp/bin.ts`.
 *
 * v4.0.0 consolidated everything into one npm package, so the plugin
 * source ships with `@polderlabs/bizar` itself — no separate
 * `@polderlabs/bizar-plugin` package, no git clone, no fresh checkout.
 *
 * Symlink guard (v3.12.2): if the dest is a symlink (e.g. created by
 * `bizar dev-link`), do NOT overwrite it. The copy below would otherwise
 * dereference the symlink and silently turn it back into a real directory,
 * breaking the dev workflow. Pass `{ force: true }` to override (after
 * confirming the user really wants the deployed copy back).
 *
 * node_modules copy: the plugin imports `@polderlabs/bizar-sdk`, a
 * workspace-internal package not on the public registry. After copying
 * the plugin files, this function ALSO copies the source's `node_modules/`
 * to the deployed `node_modules/` so Bun can resolve the import when the
 * plugin is loaded from `~/.claude/plugins/bizar/`. Without this, the
 * plugin silently fails to load.
 *
 * Pass `{ silent: true }` to suppress the warning prints; the function
 * still returns `true` if the dest is already in the desired state.
 *
 * Pass `{ sourceDir: '/path/to/fake' }` (test seam) to drive the function
 * against a controlled filesystem without touching the real install.
 *
 * Returns `true` if the plugin was installed (or already in place),
 * `false` otherwise. Never throws.
 */
export async function installPluginFromGlobal(opts = {}) {
  const { mkdir, readdir, copyFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  // ── Symlink guard ───────────────────────────────────────────────────────────
  // If dest is a symlink (created by `bizar dev-link`), don't overwrite it.
  // A plain copy would dereference the symlink and silently break the
  // dev workflow. Print a hint unless silent, or honour an explicit
  // --force from the caller.
  const destDir = join(claudeConfigDir(), 'plugins', 'bizar');
  let destIsSymlink = false;
  try {
    destIsSymlink = lstatSync(destDir).isSymbolicLink();
  } catch {
    // doesn't exist yet — fine
  }

  if (destIsSymlink) {
    if (opts.silent) {
      // Called from dev-unlink, which has already removed the symlink.
      // If we somehow still see one here, treat as "already restored".
      return true;
    }
    console.log(
      chalk.yellow(
        '  ⚠ ~/.claude/plugins/bizar is a dev symlink — skipping copy.',
      ),
    );
    console.log(
      chalk.dim(
        '    Run `bizar dev-unlink` to restore the deployed copy, or pass --force to overwrite.',
      ),
    );
    if (!opts.force) return false;
    rmSync(destDir, { force: true });
  }

  // ── Resolve source path ─────────────────────────────────────────────────────
  // v4.4.5 — the plugin ships inside this package at <pkg>/plugins/bizar/.
  // No separate npm package, no git clone.
  let pluginPath;
  if (opts.sourceDir) {
    pluginPath = opts.sourceDir;
  } else {
    // __dirname is `<pkg>/cli/`, so ../plugins/bizar is the canonical source.
    pluginPath = join(__dirname, '..', 'plugins', 'bizar');
  }
  if (!existsSync(pluginPath)) {
    console.log(chalk.red(`  ✗ Plugin source not found at ${pluginPath}`));
    console.log(chalk.dim('    This package appears to be missing plugins/bizar/. Reinstall:'));
    console.log(chalk.dim('      npm install -g @polderlabs/bizar --force'));
    return false;
  }

  // ── Auto-build: if src exists but dist/ does not, run the tsc build ──
  // v8.0.2 — fresh npm installs ship only `plugins/bizar/index.ts` and no
  // compiled entry. The plugin loader previously bailed here with the
  // misleading "Plugin source not found" message even though the directory
  // was present; the real blocker was the missing compiled output. Try to
  // build once before giving up. Best-effort: build failures keep the old
  // error path (still false return) so the user gets a clear next step.
  const distEntry = join(pluginPath, 'dist', 'index.js');
  if (!existsSync(distEntry)) {
    try {
      const { buildPlugin } = await import('./provision-claude.mjs');
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

  // ── node_modules copy ───────────────────────────────────────────────────────
  // The plugin imports `@polderlabs/bizar-sdk`, a workspace-internal package
  // not on the public registry. The npm source bundles the SDK into its
  // own `node_modules/`, so loading from `$(npm root -g)/...` resolves
  // correctly. The deployed copy at `~/.config/cline/plugins/bizar/`
  // has no `node_modules`, so Bun can't resolve the import — without this
  // copy the plugin silently fails to load. This used to be papered over
  // by a manual `cp -r $(npm root -g)/.../node_modules ~/.config/...` step
  // that got wiped every time `bizar update` re-ran the outer copy. Doing
  // it here makes the fix durable across updates.
  //
  // Semantics: mirror `cp -r` — merge into dest if it exists as a real
  // directory (overwrite same-named files, don't delete extras), error
  // if dest is a symlink (don't dereference through it). Idempotent —
  // running twice never breaks; files whose contents already match are
  // rewritten byte-identically.
  try {
    const srcNmDir = join(pluginPath, 'node_modules');
    if (existsSync(srcNmDir)) {
      const dstNmDir = join(destDir, 'node_modules');
      let dstIsSymlink = false;
      try {
        dstIsSymlink = lstatSync(dstNmDir).isSymbolicLink();
      } catch {
        // doesn't exist — fine, we'll create it below
      }
      if (dstIsSymlink) {
        console.log(
          chalk.yellow(
            `  ⚠ ${dstNmDir} is a symlink — refusing to copy node_modules (remove manually).`,
          ),
        );
      } else {
        // Top-level entry count (matches `npm ls --depth=0`) — gives the
        // user a sense of what was bundled. e.g. "copied node_modules
        // (25 packages) to deployed plugin".
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
        console.log(
          chalk.green(
            `  ✓ copied node_modules (${srcEntries.length} packages) to deployed plugin`,
          ),
        );
      }
    }

    // Wire runtime deps (`zod` plus `@anthropic-ai/claude-agent-sdk`)
    // into the deployed plugin's `node_modules/`.
    // Bun's module resolver walks up from the plugin entry point
    // looking for `node_modules/`, and without entries there the
    // plugin throws `Cannot find module 'zod'` at startup.
    //
    // The resolution logic lives in `cli/plugin-runtime-deps.mjs` and
    // is shared with the modern provisioner (`cli/provision.mjs`). It
    // searches the Bizar npm pkg's own `node_modules/`, then the
    // `cline` npm pkg's `node_modules/`, then the dev source tree.
    // Symlinks are preferred; recursive copy is the fallback.
    //
    // Only needed for the in-source plugin (main = "./index.ts"). The
    // published npm package has main = "./dist/index.js" (bundled, no
    // runtime resolution needed). Skip silently if the plugin uses the
    // bundled entry point.
    let pluginMain = null;
    try {
      const pkgPath = join(destDir, 'package.json');
      const pkg = JSON.parse(
        await import('node:fs/promises').then((fs) => fs.readFile(pkgPath, 'utf8')),
      );
      pluginMain = pkg.main;
    } catch {
      // missing or unreadable — fall through; we'll skip the wiring.
    }
    const needsWiring =
      typeof pluginMain === 'string' && pluginMain.endsWith('.ts');
    if (needsWiring) {
      try {
        const { wirePluginRuntimeDeps } = await import(
          './plugin-runtime-deps.mjs'
        );
        await wirePluginRuntimeDeps(destDir);
      } catch (err) {
        console.log(
          chalk.dim(
            `  ℹ Could not auto-wire runtime deps: ${err.message} ` +
            `(run \`bizar doctor\` to diagnose)`,
          ),
        );
      }
    }
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Failed to copy node_modules: ${err.message}`));
  }

  return true;
}

/**
 * runInstaller — v4.4.7 thin wrapper around the unified provisioner.
 *
 * `bizar install` and `bizar update` are now the SAME code path with
 * different `mode` flags. Everything (deps, plugin copy, cline.json
 * patching, service registration, agent files, skills, doctor) is
 * owned by `cli/provision.mjs:runProvision`. This file just parses the
 * flags and forwards.
 *
 * Backward-compatible — the public exports (`runInstaller`,
 * `runPostInstall`, `installPluginFromGlobal`) still exist so that any
 * external callers (including the postinstall npm hook) keep working.
 * New code should call `runProvision({ mode: 'install' })` directly.
 */
export async function runInstaller(opts = {}) {
  const { runProvision } = await import('./provision.mjs');
  return runProvision({ ...opts, mode: 'install' });
}

// ── Interactive prompts for optional packages ─────────────────────────────────

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

async function promptYesNo(question, defaultYes = true) {
  // If not a TTY (CI, automated install), skip the prompt
  if (!stdin.isTTY || !stdout.isTTY) {
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = (await rl.question(`  ${question} ${hint}: `)).trim().toLowerCase();
    rl.close();

    if (answer === '') return defaultYes;
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) return false;
    return defaultYes;
  } catch {
    rl.close();
    return false;
  }
}

async function isPackageInstalled(name) {
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return existsSync(join(globalRoot, ...name.split('/'), 'package.json'));
  } catch {
    return false;
  }
}

async function promptGraphifyInstall() {
  const { spawnSync, execSync } = await import('node:child_process');

  console.log();
  sectionHeading('Knowledge Graph (graphify)');

  // 1. Detect graphify already installed. Windows users typically have
  // `py` on PATH (the Python launcher) rather than `python3`, so probe
  // the right binary per platform. A failed probe just means we will
  // prompt to install below.
  const pythonBin = process.platform === 'win32' ? 'py' : 'python3';
  const detect = spawnSync(pythonBin, ['-c', 'import graphify; print(graphify.__version__)'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  });
  const graphifyInstalled = detect.status === 0 && (detect.stdout || '').trim().length > 0;

  if (graphifyInstalled) {
    console.log(chalk.green('  graphify already installed — skipping.'));
    return;
  }

  // Install graphify via pip as a fallback when uv is unavailable or the
  // user declined the uv-based install. On Windows, `pip` is often not
  // on PATH, so we invoke it as a `py -m pip` module instead. Returns
  // the spawn result so the caller can log success/failure.
  const installGraphifyWithPip = () => {
    if (process.platform === 'win32') {
      return spawnSync('py', ['-m', 'pip', 'install', 'graphifyy'], {
        stdio: 'inherit',
        timeout: 120000,
      });
    }
    return spawnSync('pip', ['install', 'graphifyy'], {
      stdio: 'inherit',
      timeout: 120000,
    });
  };
  const pipManualHint = process.platform === 'win32'
    ? 'py -m pip install graphifyy'
    : 'pip install graphifyy';

  // 2. Non-interactive: print hint and exit
  if (!stdin.isTTY || !stdout.isTTY) {
    console.log(chalk.dim('  graphify not detected. Install later with:'));
    console.log(chalk.dim('    uv tool install graphifyy   # recommended'));
    console.log(chalk.dim('    pip install graphifyy'));
    console.log(chalk.dim('    pipx install graphifyy'));
    console.log(chalk.dim('  Then run `bizar graph build` to populate .bizar/graph/.'));
    return;
  }

  // 3. Interactive: show options with uv first
  console.log(chalk.dim('  graphify not detected. graphify powers per-project knowledge graphs (bizar graph build).'));
  console.log(chalk.dim('  Install with one of:'));
  console.log(chalk.dim('    uv tool install graphifyy   # recommended'));
  console.log(chalk.dim('    pip install graphifyy'));
  console.log(chalk.dim('    pipx install graphifyy'));

  const hasUv = await detectUv();

  if (hasUv) {
    // 3a. uv is available — ask to install via uv directly
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question('  Install graphify now via uv? [Y/n]: ')).trim().toLowerCase();
      rl.close();

      if (answer === '' || answer.startsWith('y')) {
        console.log('  Installing graphify via uv...');
        try {
          execSync('uv tool install graphifyy', { stdio: 'inherit', timeout: 120000 });
          console.log(chalk.green('  graphify installed. Run `bizar graph build` to populate .bizar/graph/.'));
        } catch (err) {
          console.log(chalk.red(`  uv tool install failed: ${err.message}`));
          console.log(chalk.dim('  Install manually: uv tool install graphifyy'));
        }
      } else {
        console.log(chalk.dim('  Skipped. Install manually with one of the commands above when ready.'));
      }
    } catch {
      rl.close();
      console.log(chalk.dim('  Skipped.'));
    }
  } else {
    // 3b. uv not available — ask if we should install uv first
    console.log();
    console.log(chalk.dim('  uv not detected. uv is recommended on Arch/Fedora/macOS (avoids PEP 668).'));

    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question('  Install uv first, then graphify? [Y/n]: ')).trim().toLowerCase();
      rl.close();

      if (answer === '' || answer.startsWith('y')) {
        if (process.platform === 'win32') {
          console.log(chalk.yellow('  Automatic uv install not supported on Windows.'));
          console.log(chalk.dim('  Install from https://docs.astral.sh/uv then run: uv tool install graphifyy'));
          return;
        }

        console.log('  Installing uv...');
        try {
          if (process.platform === 'win32') {
            // Windows: use the official PowerShell installer
            execSync('powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: 'inherit', timeout: 60000 });
          } else {
            execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: 'inherit', timeout: 60000 });
          }
        } catch (err) {
          console.log(chalk.red(`  uv install failed: ${err.message}`));
          console.log(chalk.dim('  Install manually from https://docs.astral.sh/uv'));
          // Fall back to pip
          const rl2 = createInterface({ input: stdin, output: stdout });
          try {
            const pipAnswer = (await rl2.question('  Install graphify via pip instead? [Y/n]: ')).trim().toLowerCase();
            rl2.close();
            if (pipAnswer === '' || pipAnswer.startsWith('y')) {
              console.log('  Installing graphify via pip...');
              const result = installGraphifyWithPip();
              if (result.status === 0) {
                console.log(chalk.green('  graphify installed. Run `bizar graph build` to populate .bizar/graph/.'));
              } else {
                console.log(chalk.red(`  pip install failed (exit ${result.status}).`));
                console.log(chalk.dim(`  Install manually: ${pipManualHint}`));
              }
            } else {
              console.log(chalk.dim('  Skipped.'));
            }
          } catch {
            rl2.close();
            console.log(chalk.dim('  Skipped.'));
          }
          return;
        }

        console.log('  Installing graphify via uv...');
        try {
          execSync('uv tool install graphifyy', { stdio: 'inherit', timeout: 120000 });
          console.log(chalk.green('  graphify installed. Run `bizar graph build` to populate .bizar/graph/.'));
        } catch (err) {
          console.log(chalk.red(`  uv tool install failed: ${err.message}`));
          console.log(chalk.dim('  Install manually: uv tool install graphifyy'));
        }
      } else {
        // User declined uv — fall back to pip
        const rl2 = createInterface({ input: stdin, output: stdout });
        try {
          const pipAnswer = (await rl2.question('  Install graphify via pip instead? [Y/n]: ')).trim().toLowerCase();
          rl2.close();
          if (pipAnswer === '' || pipAnswer.startsWith('y')) {
            console.log('  Installing graphify via pip...');
            const result = installGraphifyWithPip();
            if (result.status === 0) {
              console.log(chalk.green('  graphify installed. Run `bizar graph build` to populate .bizar/graph/.'));
            } else {
              console.log(chalk.red(`  pip install failed (exit ${result.status}).`));
              console.log(chalk.dim(`  Install manually: ${pipManualHint}`));
            }
          } else {
            console.log(chalk.dim('  Skipped.'));
          }
        } catch {
          rl2.close();
          console.log(chalk.dim('  Skipped.'));
        }
      }
    } catch {
      rl.close();
      console.log(chalk.dim('  Skipped.'));
    }
  }
}

export async function runPostInstall() {
  // v6.3.0 — Bizar is Claude Code-native. `cli/provision-claude.mjs:runProvision`
  // covers the install/update/validate surface and is the primary path
  // used by `bizar install` and `bizar update`. This `runPostInstall`
  // is a thin Claude Code-native bootstrap that:
  //   - copies `config/settings.json` template on first install
  //   - installs agents into `~/.claude/agents/`
  //   - probes for headroom / semble / skills-cli
  //   - installs Headroom via pip or npm
  const { mkdirSync, copyFileSync, existsSync } = await import('node:fs');
  const { execSync } = await import('node:child_process');

  const dest = join(claudeConfigDir(), 'settings.json');
  const templateSrc = repoPath('config', 'settings.json');
  if (!existsSync(dest)) {
    if (existsSync(templateSrc)) {
      mkdirSync(claudeConfigDir(), { recursive: true });
      copyFileSync(templateSrc, dest);
      console.log('  ✓ settings.json bootstrapped from package template');
    }
  }

  const env = await detectClaude();
  if (!env.exists) {
    mkdirSync(claudeConfigDir(), { recursive: true });
    console.log(`BizarHarness: created ${claudeConfigDir()}/`);
  }

  mkdirSync(claudeAgentsDir(), { recursive: true });

  for (const file of AGENT_FILES) {
    const src = repoPath('config', 'agents', file);
    const dest = join(claudeAgentsDir(), file);
    if (!existsSync(dest)) {
      copyFileSync(src, dest);
    }
  }
  console.log('BizarHarness: agents installed.');

  // Install Headroom
  const headroomPresent = await detectHeadroom();
  if (!headroomPresent) {
    console.log('BizarHarness: installing Headroom (context compressor)...');
    try {
      if (process.platform === 'win32') {
        console.log('BizarHarness: Automatic Headroom install not supported on Windows. Install manually: pip install "headroom-ai[all]"');
      } else {
        execSync(
          'pip install --user "headroom-ai[all]"',
          { stdio: 'pipe', timeout: 60000 },
        );
        execSync('headroom wrap claude', { stdio: 'pipe' });
        console.log('BizarHarness: Headroom installed and configured.');
      }
    } catch {
      // Fall back to npm
      try {
        execSync('npm install -g headroom-ai', { stdio: 'pipe', timeout: 60000 });
        execSync('headroom wrap claude', { stdio: 'pipe' });
        console.log('BizarHarness: Headroom installed (npm) and configured.');
      } catch {
        console.log('BizarHarness: Headroom install failed. Install manually: pip install "headroom-ai[all]" or npm install -g headroom-ai');
      }
    }
  } else {
    try {
      execSync('headroom wrap claude', { stdio: 'pipe' });
      console.log('BizarHarness: Headroom configured for claude.');
    } catch {
      console.log('BizarHarness: could not configure Headroom. Run `headroom wrap claude` manually.');
    }
  }

  // Install Semble
  const semblePresent = await detectSemble();
  if (!semblePresent) {
    console.log('BizarHarness: installing Semble (code search)...');
    try {
    const hasUv = await detectUv();
    if (!hasUv) {
      if (process.platform === 'win32') {
        // Windows: use the official PowerShell installer
        execSync(
          'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
          { stdio: 'pipe', timeout: 60000 },
        );
      } else {
        execSync(
          'curl -LsSf https://astral.sh/uv/install.sh | sh',
          { stdio: 'pipe', timeout: 60000 },
        );
      }
    }
      execSync('uv tool install "semble[mcp]"', { stdio: 'pipe', timeout: 60000 });
      console.log('BizarHarness: Semble installed.');
    } catch {
      console.log('BizarHarness: Semble install failed. Run `uv tool install "semble[mcp]"` manually.');
    }
  } else {
    console.log('BizarHarness: Semble ready.');
  }

  // Install Skills CLI
  const skillsPresent = await detectSkillsCli();
  if (!skillsPresent) {
    console.log('BizarHarness: installing Skills CLI...');
    try {
      execSync('npm install -g skills', { stdio: 'pipe', timeout: 30000 });
      console.log('BizarHarness: Skills CLI installed.');
    } catch {
      console.log('BizarHarness: Skills CLI install failed. Run `npm install -g skills` manually.');
    }
  } else {
    console.log('BizarHarness: Skills CLI ready.');
  }

  // Install core skill pack
  console.log('BizarHarness: installing core skills (find-skills, skill-creator)...');
  try {
    execSync('skills add vercel-labs/skills --all -y', { stdio: 'pipe', timeout: 60000 });
    console.log('BizarHarness: core skills installed.');
  } catch {
    console.log('BizarHarness: core skill install skipped — run `skills add vercel-labs/skills --all -y` manually.');
  }

  // Try to install the Bizar plugin from the separate global npm package.
  // Non-fatal: prints a hint if the package isn't installed globally yet.
  await installPluginFromGlobal();

  console.log('Run `bizar` for interactive setup.');
}
