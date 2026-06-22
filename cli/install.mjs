import chalk from 'chalk';
import boxen from 'boxen';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { showBanner, showPantheon, sectionHeading } from './banner.mjs';
import { promptComponents, promptInstallMode, promptAgents, promptSkillPacks, promptApiKeys, promptConfirmInstall, promptRestartOpenCode } from './prompts.mjs';
import { detectOpenCode, detectRtk, detectSemble, detectSkillsCli, detectUv, buildSummary, opencodeAgentsDir, opencodeConfigDir, repoPath } from './utils.mjs';
import { installAgents, installAgentsMd, installSkill, installOpencodeJson, installBizarFolder, installPluginBizar, installRtk, installSemble, installSkillsCli, installCuratedSkills, installRules, installHooks, installCommands, installCommandsBizar, mergeToolsIntoUserConfig } from './copy.mjs';

const AGENT_FILES = [
  'odin.md', 'vor.md', 'frigg.md', 'quick.md',
  'mimir.md', 'heimdall.md', 'hermod.md', 'thor.md', 'baldr.md',
  'tyr.md', 'vidarr.md', 'forseti.md',
  'semble-search.md',
];

/**
 * Install the Bizar opencode plugin from the separate global npm package
 * `@polderlabs/bizar-plugin`. The main `@polderlabs/bizar` package
 * no longer ships `plugins/bizar/` — the plugin lives in its own scoped package
 * so it can be versioned and published independently.
 *
 * If the plugin package is globally installed, copies its contents into
 * `~/.config/opencode/plugins/bizar/` (or the platform-equivalent path via
 * `opencodeConfigDir()`). Otherwise, prints a hint directing the user to run
 * `npm install -g @polderlabs/bizar-plugin`.
 *
 * Returns `true` if the plugin was installed, `false` otherwise. Never throws.
 */
export async function installPluginFromGlobal() {
  const { execSync } = await import('node:child_process');
  const { mkdir, readdir, copyFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  let globalRoot;
  try {
    globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    console.log(chalk.yellow('  ⚠ Could not determine npm global root — skipping plugin install'));
    return false;
  }

  const pluginPath = join(globalRoot, '@polderlabs', 'bizar-plugin');
  if (!existsSync(pluginPath)) {
    console.log(chalk.dim('  ℹ Bizar plugin not installed globally. To install it:'));
    console.log(chalk.dim('    npm install -g @polderlabs/bizar-plugin'));
    return false;
  }

  const destDir = join(opencodeConfigDir(), 'plugins', 'bizar');
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
    return true;
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Failed to copy Bizar plugin: ${err.message}`));
    return false;
  }
}

export async function runInstaller() {
  showBanner();

  // ── Detect opencode ──
  sectionHeading('Pre-flight');
  const env = await detectOpenCode();

  if (!env.exists) {
    console.log(chalk.yellow('  ⚠ opencode config directory not found.'));
    console.log(chalk.dim('  The installer will create it at:'));
    console.log(chalk.dim(`  ${env.configDir}`));
  } else {
    console.log(chalk.green(`  ✓ opencode detected at ${env.configDir}`));
    if (env.version) console.log(chalk.dim(`    version ${env.version}`));
  }

  const rtkInstalled = await detectRtk();
  if (rtkInstalled) {
    console.log(chalk.green('  ✓ RTK detected (token optimizer)'));
  } else {
    console.log(chalk.yellow('  ○ RTK not detected — will install'));
  }

  const sembleInstalled = await detectSemble();
  if (sembleInstalled) {
    console.log(chalk.green('  ✓ Semble detected (code search)'));
  } else {
    console.log(chalk.yellow('  ○ Semble not detected — will install'));
  }

  const skillsCliInstalled = await detectSkillsCli();
  if (skillsCliInstalled) {
    console.log(chalk.green('  ✓ Skills CLI detected (skill discovery)'));
  } else {
    console.log(chalk.yellow('  ○ Skills CLI not detected — will install'));
  }
  console.log();

  // ── Step 1: Component selection ──
  sectionHeading('Component Selection');
  const components = await promptComponents();

  // ── Step 2: Agent selection (if agents component chosen) ──
  let selectedAgents = [];
  if (components.includes('agents')) {
    sectionHeading('Agent Selection');
    selectedAgents = await promptAgents();
  }

  // ── Step 3: Install mode ──
  sectionHeading('Installation Mode');
  const mode = await promptInstallMode();

  // ── Step 4: Skill packs (via skills.sh) ──
  sectionHeading('Skills from skills.sh');
  const skillPacks = await promptSkillPacks();

  // ── Step 5: Build summary & confirm ──
  const summary = buildSummary(components, selectedAgents, env.configDir, skillPacks);
  showPantheon();
  console.log();
  console.log(chalk.dim('  Summary:'));
  console.log(chalk.dim(`  Components : ${summary.components}`));
  console.log(chalk.dim(`  Agents     : ${summary.agents}`));
  console.log(chalk.dim(`  Target     : ${summary.target}`));
  console.log(chalk.dim(`  Mode       : ${mode}`));
  console.log();

  const confirmed = await promptConfirmInstall(summary);
  if (!confirmed) {
    console.log(chalk.yellow('\n  Installation cancelled.\n'));
    process.exit(0);
  }

  // ── Step 5: Install ──
  console.log();
  sectionHeading('Installing');

  if (components.includes('agents') && selectedAgents.length > 0) {
    await installAgents(selectedAgents, mode);
  }

  if (components.includes('agents-md')) {
    await installAgentsMd(mode);
  }

  if (components.includes('skill-bizar')) {
    await installSkill('bizar');
  }

  if (components.includes('skill-improve')) {
    await installSkill('self-improvement');
  }

  if (components.includes('skill-cpp-std')) {
    await installSkill('cpp-coding-standards');
  }

  if (components.includes('skill-cpp-test')) {
    await installSkill('cpp-testing');
  }

  if (components.includes('skill-esp-idf')) {
    await installSkill('embedded-esp-idf');
  }

  if (components.includes('opencode-json')) {
    await installOpencodeJson(mode);
  }

  // Always attempt to merge the 7 BizarHarness tool keys idempotently.
  // Safe to call even if opencode-json wasn't selected — skips silently.
  {
    const result = await mergeToolsIntoUserConfig();
    if (result.merged) {
      console.log(chalk.green(`  ✓ ${result.added.length} BizarHarness tool key(s) merged into opencode.json`));
    }
  }

  if (components.includes('bizar')) {
    await installBizarFolder();
  }

  if (components.includes('plugin-bizar')) {
    const result = await installPluginBizar();
    if (result.errors.length > 0) {
      console.log(chalk.yellow(`  ⚠ Plugin install: ${result.errors.length} error(s)`));
    }
  }

  // Also try to install the plugin from the separate global npm package
  // `@polderlabs/bizar-plugin` (preferred path going forward).
  if (components.includes('plugin-bizar')) {
    await installPluginFromGlobal();
  }

  // ── Rules, hooks, commands (optional components) ──
  if (components.includes('rules')) {
    const n = await installRules();
    console.log(chalk.green(`  ✓ ${n} rules installed`));
  }
  if (components.includes('hooks')) {
    const n = await installHooks();
    console.log(chalk.green(`  ✓ ${n} hooks installed`));
  }
  if (components.includes('commands')) {
    const n = await installCommands();
    console.log(chalk.green(`  ✓ ${n} commands installed`));
  }

  // ── RTK (always installed — token optimization required) ──
  await installRtk();

  // ── Semble (always installed — code search required) ──
  await installSemble();

  // ── Skills CLI (always installed — skill discovery required) ──
  await installSkillsCli();

  // ── Skill packs (via skills.sh ecosystem) ──
  for (const pack of skillPacks) {
    await installCuratedSkills([pack]);
  }

  // ── Step 6: API keys ──
  sectionHeading('API Keys');
  console.log(chalk.dim('  You can configure API keys now or later via /connect in opencode.'));
  const keys = await promptApiKeys();

  if (keys.opencodeZen || keys.minimax || keys.openai || keys.hindsight) {
    console.log(chalk.dim('\n  Keys noted. Add them to your opencode.json or run /connect in opencode.\n'));
  }

  // ── Summary ──
  console.log();
  console.log(boxen(
    chalk.bold.hex('#6366f1')('  ⚡ BIZARHARNESS INSTALLED ⚡\n') +
    '\n' +
    chalk.dim('  Norse Pantheon active.\n') +
    '\n' +
    chalk.green(`  ✓ ${selectedAgents.length} agents installed`) + '\n' +
    chalk.green(`  ✓ ${summary.parts.length} components configured`) + '\n' +
    '\n' +
    chalk.green('  ✓ RTK ') + chalk.dim(`(${rtkInstalled ? 'already configured' : 'installed & configured'})`) + '\n' +
    chalk.green('  ✓ Semble ') + chalk.dim(`(${sembleInstalled ? 'ready' : 'installed'})`) + '\n' +
    chalk.green('  ✓ Skills CLI ') + chalk.dim(`(${skillsCliInstalled ? 'ready' : 'installed'})`) + '\n' +
    (skillPacks.length > 0 ? chalk.green(`  ✓ Skill packs: ${skillPacks.join(', ')}`) + '\n' : '') + '\n' +
    chalk.hex('#a855f7')('  Next steps:') + '\n' +
    chalk.hex('#a855f7')('  1. Restart opencode') + '\n' +
    chalk.hex('#a855f7')('  2. Run /connect to add API keys') + '\n' +
    chalk.hex('#a855f7')('  3. Run /models to verify agents'),
    {
      padding: 1,
      margin: 0,
      borderStyle: 'round',
      borderColor: '#6366f1',
    },
  ));
  console.log();

  // ── Restart prompt ──
  const shouldRestart = await promptRestartOpenCode();
  if (shouldRestart) {
    console.log(chalk.dim('  Restarting opencode...'));
    try {
      const { execSync } = await import('node:child_process');
      execSync('opencode', { stdio: 'inherit' });
    } catch {
      console.log(chalk.yellow('  Could not restart automatically. Restart opencode manually.'));
    }
  }

  // ── Post-install ──
  console.log(chalk.dim('\n  Odin watches. The Pantheon awaits. ᛟ\n'));
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

async function promptAndInstallOptional() {
  // Plugin
  const pluginInstalled = await isPackageInstalled('@polderlabs/bizar-plugin');
  if (!pluginInstalled) {
    console.log('');
    console.log('  The Bizar opencode plugin is required for the /bizar command and agent integration.');
    const install = await promptYesNo(
      'Install @polderlabs/bizar-plugin?',
      true,
    );
    if (install) {
      try {
        console.log('  Installing @polderlabs/bizar-plugin...');
        execSync('npm install -g @polderlabs/bizar-plugin', { stdio: 'inherit' });
        console.log('  ✓ @polderlabs/bizar-plugin installed');
      } catch (err) {
        console.log(`  ✗ Failed to install @polderlabs/bizar-plugin: ${err.message}`);
        console.log('  You can install it later with: npm install -g @polderlabs/bizar-plugin');
      }
    } else {
      console.log('  Skipped. Install later with: npm install -g @polderlabs/bizar-plugin');
    }
  } else {
    console.log('  ✓ @polderlabs/bizar-plugin already installed');
  }

  // Dashboard
  const dashInstalled = await isPackageInstalled('@polderlabs/bizar-dash');
  if (!dashInstalled) {
    console.log('');
    console.log('  The Bizar dashboard provides the web UI (React + Vite) and TUI (blessed).');
    console.log('  It\'s optional — install it for the full experience, or use the CLI alone.');
    const install = await promptYesNo(
      'Install @polderlabs/bizar-dash?',
      true,
    );
    if (install) {
      try {
        console.log('  Installing @polderlabs/bizar-dash...');
        execSync('npm install -g @polderlabs/bizar-dash', { stdio: 'inherit' });
        console.log('  ✓ @polderlabs/bizar-dash installed');
      } catch (err) {
        console.log(`  ✗ Failed to install @polderlabs/bizar-dash: ${err.message}`);
        console.log('  You can install it later with: npm install -g @polderlabs/bizar-dash');
      }
    } else {
      console.log('  Skipped. Install later with: npm install -g @polderlabs/bizar-dash');
    }
  } else {
    console.log('  ✓ @polderlabs/bizar-dash already installed');
  }
}

export async function runPostInstall() {
  // Skip interactive prompts in CI / non-TTY environments
  if (!process.env.BIZAR_SKIP_OPTIONAL_INSTALLS) {
    await promptAndInstallOptional();
  }
  const { mkdirSync, copyFileSync, existsSync } = await import('node:fs');
  const { execSync } = await import('node:child_process');

  const dest = join(opencodeConfigDir(), 'opencode.json');
  const templateSrc = repoPath('config', 'opencode.json');
  if (!existsSync(dest)) {
    if (existsSync(templateSrc)) {
      mkdirSync(opencodeConfigDir(), { recursive: true });
      copyFileSync(templateSrc, dest);
      console.log('  ✓ opencode.json bootstrapped from package template');
    }
  }

  // Install Bizar commands to commands-bizar/ (separate from ECC's commands symlink)
  await installCommandsBizar();

  const env = await detectOpenCode();
  if (!env.exists) {
    mkdirSync(opencodeConfigDir(), { recursive: true });
    console.log(`BizarHarness: created ${opencodeConfigDir()}/`);
  }

  mkdirSync(opencodeAgentsDir(), { recursive: true });

  for (const file of AGENT_FILES) {
    const src = repoPath('config', 'agents', file);
    const dest = join(opencodeAgentsDir(), file);
    if (!existsSync(dest)) {
      copyFileSync(src, dest);
    }
  }
  console.log('BizarHarness: agents installed.');

  // Install RTK
  const rtkPresent = await detectRtk();
  if (!rtkPresent) {
    console.log('BizarHarness: installing RTK (token optimizer)...');
    try {
      execSync(
        'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh',
        { stdio: 'pipe', timeout: 60000 },
      );
      execSync('rtk init -g --opencode', { stdio: 'pipe' });
      console.log('BizarHarness: RTK installed and configured.');
    } catch {
      console.log('BizarHarness: RTK install failed. Install manually from https://github.com/rtk-ai/rtk');
    }
  } else {
    try {
      execSync('rtk init -g --opencode', { stdio: 'pipe' });
      console.log('BizarHarness: RTK configured for opencode.');
    } catch {
      console.log('BizarHarness: could not configure RTK. Run `rtk init -g --opencode` manually.');
    }
  }

  // Install Semble
  const semblePresent = await detectSemble();
  if (!semblePresent) {
    console.log('BizarHarness: installing Semble (code search)...');
    try {
      const hasUv = await detectUv();
      if (!hasUv) {
        execSync(
          'curl -LsSf https://astral.sh/uv/install.sh | sh',
          { stdio: 'pipe', timeout: 60000 },
        );
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
