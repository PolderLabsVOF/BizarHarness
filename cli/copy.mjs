import { mkdir, writeFile, readFile, copyFile, access, constants } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import ora from 'ora';
import chalk from 'chalk';
import { repoPath, opencodeConfigDir, opencodeAgentsDir, detectRtk, detectSemble, detectUv } from './utils.mjs';

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
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
    await writeFile(dest, JSON.stringify(templateObj, null, 2));
    spinner.succeed(chalk.green('opencode.json configured'));
    return true;
  }

  // Merge mode: deep merge with existing
  try {
    const existingRaw = await readFile(dest, 'utf-8');
    const existing = JSON.parse(existingRaw);
    const merged = deepMerge(existing, templateObj);
    await writeFile(dest, JSON.stringify(merged, null, 2));
    spinner.succeed(chalk.green('opencode.json merged (existing keys preserved)'));
    return true;
  } catch {
    // If existing is invalid JSON, backup and overwrite
    const backup = dest + '.bak';
    await copyFile(dest, backup);
    await writeFile(dest, JSON.stringify(templateObj, null, 2));
    spinner.succeed(chalk.green('opencode.json written (backup at opencode.json.bak)'));
    return true;
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
    await copyFile(src, dst);
  }

  spinner.succeed(chalk.green('.bizar/ folder created in current directory'));
  return true;
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
