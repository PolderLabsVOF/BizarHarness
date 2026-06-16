import chalk from 'chalk';
import boxen from 'boxen';

import { showBanner, showPantheon, sectionHeading } from './banner.mjs';
import { promptComponents, promptInstallMode, promptAgents, promptApiKeys, promptConfirmInstall, promptRestartOpenCode } from './prompts.mjs';
import { detectOpenCode, detectRtk, detectSemble, detectSkillsCli, buildSummary, opencodeAgentsDir, repoPath } from './utils.mjs';
import { installAgents, installAgentsMd, installSkill, installOpencodeJson, installBizarFolder, installRtk, installSemble, installSkillsCli } from './copy.mjs';

const AGENT_FILES = [
  'odin.md', 'vor.md', 'mimir.md', 'heimdall.md', 'hermod.md',
  'thor.md', 'baldr.md', 'tyr.md', 'vidarr.md', 'forseti.md',
  'semble-search.md',
];

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

  // ── Step 4: Build summary & confirm ──
  const summary = buildSummary(components, selectedAgents, env.configDir);
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
    await installSkill('bizarharness');
  }

  if (components.includes('skill-improve')) {
    await installSkill('self-improvement');
  }

  if (components.includes('opencode-json')) {
    await installOpencodeJson(mode);
  }

  if (components.includes('bizar')) {
    await installBizarFolder();
  }

  // ── RTK (always installed — token optimization required) ──
  await installRtk();

  // ── Semble (always installed — code search required) ──
  await installSemble();

  // ── Skills CLI (always installed — skill discovery required) ──
  await installSkillsCli();

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
    '\n' +
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

export async function runPostInstall() {
  const { mkdirSync, copyFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execSync } = await import('node:child_process');

  const env = await detectOpenCode();
  if (!env.exists) {
    console.log('BizarHarness: opencode not detected — skipping auto-install.');
    return;
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

  console.log('Run `bizarharness` for interactive setup.');
}
