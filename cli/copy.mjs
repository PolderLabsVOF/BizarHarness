import { mkdir, writeFile, readFile, copyFile, access, constants, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import ora from 'ora';
import chalk from 'chalk';
import { repoPath, opencodeConfigDir, opencodeAgentsDir, detectRtk, detectSemble, detectUv, detectSkillsCli } from './utils.mjs';

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteText(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

export async function installAgents(agentFiles, mode) {
  const spinner = ora({ text: 'Installing agent definitions...', color: 'magenta' }).start();
  const destDir = opencodeAgentsDir();
  await mkdir(destDir, { recursive: true });

  let count = 0;
  for (const file of agentFiles) {
    const src = repoPath('config', 'agents', file);
    const dest = join(destDir, file);
    if (mode === 'merge' && await fileExists(dest)) {
      spinner.text = `  Skipping ${file} (already exists)`;
      continue;
    }
    await copyFile(src, dest);
    count++;
  }

  spinner.succeed(chalk.green(`Installed ${count} agent${count !== 1 ? 's' : ''}`));
  return count;
}

export async function installAgentsMd(mode) {
  const spinner = ora({ text: 'Installing AGENTS.md routing table...', color: 'magenta' }).start();
  const src = repoPath('config', 'AGENTS.md');
  const dest = join(opencodeConfigDir(), 'AGENTS.md');

  if (mode === 'merge' && await fileExists(dest)) {
    spinner.warn(chalk.yellow('AGENTS.md already exists — skipping (use fresh mode to overwrite)'));
    return false;
  }

  await mkdir(opencodeConfigDir(), { recursive: true });
  await copyFile(src, dest);
  spinner.succeed(chalk.green('AGENTS.md installed'));
  return true;
}

export async function installSkill(name) {
  const spinner = ora({ text: `Installing ${name} skill...`, color: 'cyan' }).start();
  const srcDir = repoPath('config', 'skills', name);

  try {
    await access(srcDir, constants.F_OK);
  } catch {
    spinner.warn(chalk.yellow(`Skill ${name} not found — skipping`));
    return false;
  }

  const skillsDir = join(homedir(), '.opencode', 'skills');
  const dstDir = join(skillsDir, name);
  await mkdir(dstDir, { recursive: true });

  const entries = await readdirRecursive(srcDir);
  for (const entry of entries) {
    const src = join(srcDir, entry);
    const dst = join(dstDir, entry);
    const dstParent = dirname(dst);
    await mkdir(dstParent, { recursive: true });
    await copyFile(src, dst);
  }

  spinner.succeed(chalk.green(`${name} skill installed`));
  return true;
}

async function readdirRecursive(dir) {
  const { readdir, stat } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const files = [];
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(relative(dir, full));
      }
    }
  }
  await walk(dir);
  return files;
}

export async function installOpencodeJson(mode) {
  const spinner = ora({ text: 'Configuring opencode.json...', color: 'yellow' }).start();
  const template = repoPath('config', 'opencode.json');
  const dest = join(opencodeConfigDir(), 'opencode.json');
  await mkdir(opencodeConfigDir(), { recursive: true });

  const templateRaw = await readFile(template, 'utf-8');
  let templateObj;
  try { templateObj = JSON.parse(templateRaw); } catch {
    spinner.fail(chalk.red('Invalid opencode.json template'));
    return false;
  }

  if (mode === 'fresh' || !(await fileExists(dest))) {
    await atomicWriteText(dest, JSON.stringify(templateObj, null, 2) + '\n');
    spinner.succeed(chalk.green('opencode.json configured'));
    return true;
  }

  // Merge mode: deep merge with existing
  try {
    const existingRaw = await readFile(dest, 'utf-8');
    const existing = JSON.parse(existingRaw);
    const merged = deepMerge(existing, templateObj);
    await atomicWriteText(dest, JSON.stringify(merged, null, 2) + '\n');
    spinner.succeed(chalk.green('opencode.json merged (existing keys preserved)'));
    return true;
  } catch {
    // If existing is invalid JSON, backup and overwrite
    const backup = dest + '.bak';
    await copyFile(dest, backup);
    await atomicWriteText(dest, JSON.stringify(templateObj, null, 2) + '\n');
    spinner.succeed(chalk.green('opencode.json written (backup at opencode.json.bak)'));
    return true;
  }
}

/**
 * The 7 BizarHarness tool keys that must be enabled in the user's opencode.json.
 * These are merged idempotently — existing tool keys are never overwritten.
 */
const BIZAR_TOOLS = {
  bizar_plan_action: true,
  bizar_get_plan_comments: true,
  bizar_wait_for_feedback: true,
  bizar_spawn_background: true,
  bizar_status: true,
  bizar_collect: true,
  bizar_kill: true,
};

/**
 * Idempotently merge the 7 BizarHarness tool keys into the user's
 * `~/.config/opencode/opencode.json` (or the platform-equivalent config dir).
 * Does NOT overwrite any other user config.
 * Logs a diff of what was added.
 */
export async function mergeToolsIntoUserConfig() {
  const dest = join(opencodeConfigDir(), 'opencode.json');

  // If user has no config yet, nothing to merge into
  if (!(await fileExists(dest))) {
    return { merged: false, reason: 'no-existing-config' };
  }

  try {
    const existingRaw = await readFile(dest, 'utf-8');
    const existing = JSON.parse(existingRaw);

    const tools = existing.tools || {};
    const added = [];
    for (const [key, value] of Object.entries(BIZAR_TOOLS)) {
      if (!(key in tools)) {
        tools[key] = value;
        added.push(key);
      }
    }

    if (added.length === 0) {
      return { merged: false, reason: 'all-keys-present' };
    }

    const merged = { ...existing, tools };
    await atomicWriteText(dest, JSON.stringify(merged, null, 2) + '\n');

    console.log(chalk.dim(`  [tools] added: ${added.join(', ')}`));
    return { merged: true, added };
  } catch (err) {
    return { merged: false, reason: 'error', error: err.message };
  }
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key] || {}, value);
    } else if (!(key in out)) {
      out[key] = value;
    }
  }
  return out;
}

export async function installBizarFolder() {
  const spinner = ora({ text: 'Setting up .bizar/ folder...', color: 'cyan' }).start();
  const srcDir = repoPath('.bizar');
  try {
    await access(srcDir, constants.F_OK);
  } catch {
    spinner.warn(chalk.yellow('.bizar/ not found in repo — skipping'));
    return false;
  }

  const cwd = process.cwd();
  const destDir = join(cwd, '.bizar');
  await mkdir(destDir, { recursive: true });

  const files = await readdirRecursive(srcDir);
  for (const file of files) {
    const src = join(srcDir, file);
    const dst = join(destDir, file);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }

  spinner.succeed(chalk.green('.bizar/ folder created in current directory'));
  return true;
}

/**
 * Install the Bizar plugin into a project's .opencode/ directory.
 *
 * Per spec §9.2:
 *   - Copies plugins/bizar/ → <project>/.opencode/plugins/bizar/
 *   - Excludes: node_modules/, dist/, *.log, .DS_Store
 *   - Returns { copied: number, errors: string[] }
 *
 * INSTALL PATH CONCLUSION (step 5 of the Heimdall wiring task):
 * The install target is INSIDE the project at <project>/.opencode/plugins/bizar/,
 * NOT in the system config dir (~/.config/opencode/plugins/bizar/).
 * Rationale:
 *   1. Per-project isolation — each project pins its own plugin version
 *      (spec §9.1: "Per-project isolation (each project can pin its own
 *      plugin version)").
 *   2. Follows opencode's project-local config convention — the config file
 *      is at <project>/.opencode/opencode.json and the plugin ref is
 *      `./plugins/bizar/index.ts` relative to that config dir.
 *   3. Mirrors the .bizar/ folder pattern (project-local, not system-wide).
 *   4. Not "polluting" — the .opencode/ directory is the standard location
 *      for project-local opencode config (analogous to .vscode/).
 *   5. In the Docker sandbox (BizarHarness-dev), the host project is mounted
 *      at /project, so /project/.opencode/plugins/bizar/ resolves correctly
 *      relative to /project/.opencode/opencode.json.
 *
 * The source (<repo>/plugins/bizar/) is copied FROM the harness repo INTO
 * the project's .opencode/ directory. After install, the harness repo is no
 * longer the authoritative source — the project has its own copy.
 *
 * See spec §9.1 for the canonical layout diagram.
 *
 * @param {string} [projectRoot] - Project root directory (defaults to cwd)
 * @returns {Promise<{copied: number, errors: string[]}>}
 */
export async function installPluginBizar(projectRoot) {
  if (!projectRoot) projectRoot = process.cwd();
  const spinner = ora({ text: 'Installing Bizar plugin...', color: 'cyan' }).start();
  const srcDir = repoPath('plugins', 'bizar');

  try {
    await access(srcDir, constants.F_OK);
  } catch {
    // The Bizar plugin now lives in a separate npm package
    // (@polderlabs/bizar-plugin). The interactive installer copies it from
    // there; the source tree no longer carries plugins/bizar/.
    spinner.info(chalk.dim('  ℹ No local plugins/bizar/ — using @polderlabs/bizar-plugin from npm'));
    return { copied: 0, errors: [] };
  }

  try {
    const destDir = join(projectRoot, '.opencode', 'plugins', 'bizar');
    await mkdir(destDir, { recursive: true });

    // Exclude patterns per spec §9.2
    const isExcluded = (entry) => {
      const parts = entry.split('/');
      return parts.some(part =>
        part === 'node_modules' ||
        part === 'dist' ||
        part === '.DS_Store' ||
        part.endsWith('.log')
      );
    };

    const files = await readdirRecursive(srcDir);
    const errors = [];
    let copied = 0;

    for (const file of files) {
      if (isExcluded(file)) continue;
      const src = join(srcDir, file);
      const dst = join(destDir, file);
      const dstParent = dirname(dst);
      try {
        await mkdir(dstParent, { recursive: true });
        await copyFile(src, dst);
        copied++;
      } catch (err) {
        errors.push(`Failed to copy ${file}: ${err.message}`);
      }
    }

    if (errors.length === 0) {
      spinner.succeed(chalk.green(`Installed Bizar plugin (${copied} files)`));
    } else {
      spinner.warn(chalk.yellow(`Installed Bizar plugin (${copied} files, ${errors.length} errors)`));
    }
    return { copied, errors };
  } catch (err) {
    spinner.fail(chalk.red(`Failed to install Bizar plugin: ${err.message}`));
    return { copied: 0, errors: [err.message] };
  }
}

export async function installRtk() {
  const { execSync } = await import('node:child_process');

  const already = await detectRtk();
  if (already) {
    const spinner = ora({ text: 'Configuring RTK for opencode...', color: 'magenta' }).start();
    try {
      execSync('rtk init -g --opencode', { stdio: 'pipe' });
      spinner.succeed(chalk.green('RTK configured for opencode'));
    } catch {
      spinner.warn(chalk.yellow('Could not auto-configure RTK — run `rtk init -g --opencode` manually'));
    }
    return true;
  }

  const spinner = ora({ text: 'Installing RTK (Rust Token Killer)...', color: 'magenta' }).start();

  if (process.platform === 'win32') {
    spinner.fail(chalk.red('Automatic RTK install not supported on Windows. Install manually from https://github.com/rtk-ai/rtk'));
    return false;
  }

  try {
    execSync(
      'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh',
      { stdio: 'pipe', timeout: 60000 },
    );
    spinner.text = 'Configuring RTK for opencode...';
    execSync('rtk init -g --opencode', { stdio: 'pipe' });
    spinner.succeed(chalk.green('RTK installed and configured for opencode'));
    return true;
  } catch {
    spinner.fail(chalk.red('RTK install failed. Install manually from https://github.com/rtk-ai/rtk'));
    return false;
  }
}

export async function installSemble() {
  const { execSync } = await import('node:child_process');

  const already = await detectSemble();
  if (already) {
    const spinner = ora({ text: 'Checking Semble code search...', color: 'cyan' }).start();
    spinner.succeed(chalk.green('Semble ready'));
    return true;
  }

  const spinner = ora({ text: 'Setting up Semble (code search)...', color: 'cyan' }).start();

  const hasUv = await detectUv();
  if (!hasUv) {
    spinner.text = 'Installing uv (Python package manager)...';
    try {
      if (process.platform === 'win32') {
        spinner.fail(chalk.red('Automatic uv install not supported on Windows. Install from https://docs.astral.sh/uv'));
        return false;
      }
      execSync(
        'curl -LsSf https://astral.sh/uv/install.sh | sh',
        { stdio: 'pipe', timeout: 60000 },
      );
      spinner.text = 'Setting up Semble...';
    } catch {
      spinner.fail(chalk.red('uv install failed. Install manually from https://docs.astral.sh/uv'));
      return false;
    }
  }

  try {
    execSync('uv tool install "semble[mcp]"', { stdio: 'pipe', timeout: 60000 });
    spinner.succeed(chalk.green('Semble installed (code search)'));
    return true;
  } catch {
    spinner.warn(chalk.yellow('Semble install failed. Run `uv tool install "semble[mcp]"` manually'));
    return false;
  }
}

export async function installSkillsCli() {
  const { execSync } = await import('node:child_process');

  const already = await detectSkillsCli();
  if (already) {
    const spinner = ora({ text: 'Checking Skills CLI...', color: 'yellow' }).start();
    spinner.succeed(chalk.green('Skills CLI ready'));
    return true;
  }

  const spinner = ora({ text: 'Installing Skills CLI (skill discovery)...', color: 'yellow' }).start();

  try {
    execSync('npm install -g skills', { stdio: 'pipe', timeout: 30000 });
    spinner.succeed(chalk.green('Skills CLI installed'));
    return true;
  } catch {
    spinner.warn(chalk.yellow('Skills CLI install failed. Run `npm install -g skills` manually'));
    return false;
  }
}

export const SKILL_PACKS = {
  core: {
    label: 'Core — find-skills, skill-creator, write-a-skill',
    repos: ['vercel-labs/skills'],
  },
  frontend: {
    label: 'Frontend — React, web-design, composition, a11y, shadcn/ui',
    repos: ['vercel-labs/agent-skills', 'shadcn/ui'],
  },
  backend: {
    label: 'Backend — Supabase, Postgres, API patterns, auth',
    repos: ['supabase/agent-skills'],
  },
  testing: {
    label: 'Testing — TDD, E2E, Playwright, test patterns',
    repos: ['mattpocock/skills', 'microsoft/playwright-cli'],
  },
  design: {
    label: 'Design — frontend-design, UI/UX, taste skills',
    repos: ['anthropics/skills', 'leonxlnx/taste-skill'],
  },
};

export async function installCuratedSkills(packs) {
  const { execSync } = await import('node:child_process');

  const hasCli = await detectSkillsCli();
  if (!hasCli) {
    console.log(chalk.yellow('  ⚠ Skills CLI not available — skipping skill install'));
    return false;
  }

  let total = 0;
  for (const key of packs) {
    const pack = SKILL_PACKS[key];
    if (!pack) continue;

    const spinner = ora({ text: `Installing ${key} skills...`, color: 'yellow' }).start();
    for (const repo of pack.repos) {
      try {
        execSync(`skills add ${repo} --all -y`, { stdio: 'pipe', timeout: 60000 });
        total++;
      } catch {
        spinner.warn(chalk.yellow(`  ${repo} — some skills skipped or already installed`));
      }
    }
    spinner.succeed(chalk.green(`${key}: ${pack.label}`));
  }

  if (total > 0) {
    console.log(chalk.dim(`  Installed from ${total} skill repositories`));
  }
  return true;
}

export async function installRules() {
  const src = repoPath('config', 'rules');
  const dest = join(opencodeConfigDir(), 'rules');
  const { mkdirSync, readdirSync, copyFileSync } = await import('node:fs');
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const file of readdirSync(src).filter(f => f.endsWith('.md'))) {
    copyFileSync(join(src, file), join(dest, file));
    count++;
  }
  return count;
}

export async function installHooks() {
  const src = repoPath('config', 'hooks');
  const dest = join(opencodeConfigDir(), 'hooks');
  const { mkdirSync, readdirSync, copyFileSync } = await import('node:fs');
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const file of readdirSync(src).filter(f => f.endsWith('.md'))) {
    copyFileSync(join(src, file), join(dest, file));
    count++;
  }
  return count;
}

export async function installCommands() {
  const src = repoPath('config', 'commands');
  const dest = join(opencodeConfigDir(), 'commands');
  const { mkdirSync, readdirSync, copyFileSync } = await import('node:fs');
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const file of readdirSync(src).filter(f => f.endsWith('.md'))) {
    copyFileSync(join(src, file), join(dest, file));
    count++;
  }
  return count;
}

/**
 * Install Bizar-specific commands to commands-bizar/ (separate from ECC's
 * commands/ symlink). This directory holds the Bizar plugin's own command
 * templates: audit, explain, init, learn, plan, pr-review, tailscale-serve,
 * visual-plan, and bizar.
 *
 * If dest is a symlink (e.g. the ECC installer symlinked it), skip with a
 * friendly message — we don't want to follow a symlink and write into someone
 * else's directory.
 *
 * @returns {Promise<number>} count of .md files copied
 */
export async function installCommandsBizar() {
  const src = repoPath('config', 'commands');
  const dest = join(opencodeConfigDir(), 'commands-bizar');
  const { mkdirSync, readdirSync, copyFileSync, lstatSync } = await import('node:fs');

  // Guard: skip if dest is a symlink (don't follow other packages' symlinks)
  try {
    const stat = lstatSync(dest);
    if (stat.isSymbolicLink()) {
      console.log('BizarHarness: commands-bizar/ is a symlink — skipping install.');
      return 0;
    }
  } catch {
    // dest does not exist — that's fine, we'll create it
  }

  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const file of readdirSync(src).filter(f => f.endsWith('.md'))) {
    copyFileSync(join(src, file), join(dest, file));
    count++;
  }
  return count;
}
