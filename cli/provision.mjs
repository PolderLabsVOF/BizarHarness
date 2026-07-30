#!/usr/bin/env node
/**
 * cli/provision.mjs
 *
 * Unified installer + updater (Claude Code-native).
 *
 * `bizar install` and `bizar update` are the same code path with
 * different `mode` flags. Both are idempotent and safe to re-run.
 *
 * Public API:
 *   runProvision({ mode, dryRun, force, yes, restart, ... })
 *     Runs the full provision flow for `mode` ('install' | 'update').
 *   detectState()
 *     Probe what's installed without modifying anything.
 *     Returns a structured state object.
 */

import chalk from 'chalk';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();

// Repo root = `<pkg>/cli/provision.mjs` → one level up.
export const REPO_ROOT = resolve(__dirname, '..');
export const PKG_MAIN = '@polderlabs/bizar';
export const BIZAR_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Resolve the Claude Code config directory.
 *   1. `process.env.CLAUDE_CONFIG_DIR`
 *   2. `$HOME/.claude`
 */
export function resolveClaudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()) {
    return process.env.CLAUDE_CONFIG_DIR.trim();
  }
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'Claude')
      : join(HOME, '.claude');
  }
  return join(HOME, '.claude');
}

export const CLAUDE_DIR = resolveClaudeDir();

/** `~/.config/bizar/` — Bizar runtime state (NOT under ~/.claude/). */
export const BIZAR_HOME = process.env.BIZAR_HOME
  || join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'bizar');

// Standard Claude Code subdirectories
export const CLAUDE_AGENTS_DIR   = join(CLAUDE_DIR, 'agents');
export const CLAUDE_SKILLS_DIR   = join(CLAUDE_DIR, 'skills');
export const CLAUDE_COMMANDS_DIR = join(CLAUDE_DIR, 'commands');
export const CLAUDE_HOOKS_DIR    = join(CLAUDE_DIR, 'hooks');
export const CLAUDE_RULES_DIR    = join(CLAUDE_DIR, 'rules');
const INSTALL_MARKER_FILE  = join(BIZAR_HOME, 'installed.json');

// ─── Tiny utilities ──────────────────────────────────────────────────────────

function haveCmd(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function readTextSafe(file, fallback = '') {
  try {
    if (!existsSync(file)) return fallback;
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function readJsonSafe(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function copyDirContents(src, dest) {
  ensureDir(dest);
  for (const name of readdirSync(src)) {
    const sp = join(src, name);
    const dp = join(dest, name);
    const st = statSync(sp);
    if (st.isDirectory()) copyDirContents(sp, dp);
    else copyFileSync(sp, dp);
  }
}

function rimrafSafe(p) {
  try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Read a PID file and return the live PID, or null if missing/stale. */
export function readLivePid(pidFile) {
  if (!existsSync(pidFile)) return null;
  const raw = readTextSafe(pidFile).trim();
  if (!raw) {
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
}

/** Send SIGTERM, wait, then SIGKILL if needed. Cross-platform. */
export async function killAndWait(pid, { timeoutMs = 5000, label = 'process' } = {}) {
  if (!pid) return true;
  let sigtermOk = false;
  try {
    process.kill(pid);
    sigtermOk = true;
  } catch (err) {
    if (err.code === 'ESRCH') return true;
    console.log(chalk.yellow(`    ! could not signal ${label} (pid ${pid}): ${err.message}`));
    return false;
  }
  const start = Date.now();
  let sawExit = false;
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') { sawExit = true; break; }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (sawExit) return true;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    if (sigtermOk) {
      console.log(chalk.yellow(`    ! ${label} (pid ${pid}) did not exit gracefully; sent forced kill`));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return true;
    console.log(chalk.red(`    ✗ could not force-kill ${label} (pid ${pid}): ${err.message}`));
    return false;
  }
}

// ─── Logging helpers ─────────────────────────────────────────────────────────

function logOk(msg)   { console.log(chalk.green('  ✓') + ' ' + msg); }
function logInfo(msg)  { console.log(chalk.cyan('  →') + ' ' + msg); }
function logWarn(msg)  { console.log(chalk.yellow('  ⚠') + ' ' + msg); }
function logErr(msg)   { console.log(chalk.red('  ✗') + ' ' + msg); }
function section(title) { console.log('\n' + chalk.bold.cyan(`── ${title} ──`)); }

// ─── Install marker ──────────────────────────────────────────────────────────

/** Read the install marker file. Returns null if missing. */
export function readInstallMarker() {
  return readJsonSafe(INSTALL_MARKER_FILE, null);
}

/** Write the install marker file. */
export function writeInstallMarker({ version, repoPath, serviceUnit }) {
  const marker = {
    version: version || currentVersion(PKG_MAIN) || 'unknown',
    installedAt: new Date().toISOString(),
    repoPath: repoPath || REPO_ROOT,
    serviceUnit: serviceUnit || null,
  };
  try {
    mkdirSync(BIZAR_HOME, { recursive: true });
    writeFileSync(INSTALL_MARKER_FILE, JSON.stringify(marker, null, 2) + '\n');
    return { ok: true, marker };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Version helpers ─────────────────────────────────────────────────────────

export function currentVersion(pkg) {
  try {
    const out = execSync(`npm ls -g ${pkg} --depth=0 --json`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).toString();
    const parsed = JSON.parse(out);
    return parsed.dependencies?.[pkg]?.version ?? null;
  } catch {
    return null;
  }
}

export function latestVersion(pkg) {
  try {
    const out = execSync(`npm view ${pkg} version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

// ─── Build helpers ───────────────────────────────────────────────────────────

/**
 * Build the SDK workspace so its compiled JS output lives at
 * `<pkg>/packages/sdk/dist/`.
 * Idempotent: skips when dist already exists. Non-fatal.
 */
export async function buildSdk({ dryRun = false } = {}) {
  const sdkRoot  = join(REPO_ROOT, 'packages', 'sdk');
  const distEntry = join(sdkRoot, 'dist', 'index.js');
  const srcEntry  = join(sdkRoot, 'src', 'index.ts');

  if (!existsSync(srcEntry)) return { ok: true, skipped: true, message: `SDK src not found — skipping build` };
  if (existsSync(distEntry)) return { ok: true, skipped: true, message: `SDK dist already present — skipping build` };
  if (dryRun) return { ok: true, skipped: false, message: `would build SDK at ${sdkRoot}` };

  const bunBin = join(process.env.HOME || '', '.bun', 'bin', 'bun');
  let cmd, args, childEnv;
  if (existsSync(bunBin)) {
    cmd = bunBin; args = ['run', 'build:sdk'];
    const pathDelim = process.platform === 'win32' ? ';' : ':';
    let npmGlobalBin = '';
    try {
      const npmRootG = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      npmGlobalBin = join(dirname(npmRootG), '..', 'bin');
    } catch {
      npmGlobalBin = process.platform === 'win32' ? join(process.env.APPDATA || '', 'npm') : join(process.env.HOME || '', '.local', 'bin');
    }
    childEnv = { ...process.env, PATH: [dirname(bunBin), ...(npmGlobalBin && existsSync(npmGlobalBin) ? [npmGlobalBin] : []), process.env.PATH || ''].join(pathDelim) };
  } else if (haveCmd('bun')) {
    cmd = 'bun'; args = ['run', 'build:sdk']; childEnv = process.env;
  } else {
    cmd = 'npx'; args = ['--yes', 'tsc', '-p', 'packages/sdk/tsconfig.json']; childEnv = process.env;
  }

  try {
    logInfo(`building SDK with \`${cmd} ${args.join(' ')}\``);
    execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe', timeout: 180_000, env: childEnv });
    if (existsSync(distEntry)) return { ok: true, skipped: false, message: 'SDK built (dist/index.js present)' };
    return { ok: false, message: `build completed but ${distEntry} still missing` };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().split('\n').slice(0, 5).join(' | ') : '(no stderr)';
    return { ok: false, message: `SDK build failed: ${stderr}` };
  }
}

// ─── Bizar HOME bootstrap ────────────────────────────────────────────────────

/** Ensure `~/.config/bizar/` exists with loop state. Idempotent. */
export function ensureBizarHome({ dryRun = false } = {}) {
  if (dryRun) return { ok: true, message: `[dry-run] would ensure ${BIZAR_HOME}` };
  mkdirSync(BIZAR_HOME, { recursive: true });
  mkdirSync(join(BIZAR_HOME, 'loops'), { recursive: true });
  return { ok: true, message: `${BIZAR_HOME} ready`, path: BIZAR_HOME };
}

// ─── Toolchain ───────────────────────────────────────────────────────────────

function checkToolchain() {
  section('Toolchain');
  if (haveCmd('node')) logOk(`node ${execSync('node --version').toString().trim()}`);
  else { logErr('node not on PATH — install Node.js 18+'); process.exit(1); }
  if (haveCmd('npm'))  logOk(`npm ${execSync('npm --version').toString().trim()}`);
  else logWarn('npm not on PATH');
  if (haveCmd('git'))  logOk(`git ${execSync('git --version').toString().trim().split(' ')[2]}`);
  else logWarn('git not on PATH');
  if (haveCmd('claude')) logOk(`claude ${execSync('claude --version').toString().trim().split('\n')[0]}`);
  else logWarn('claude not on PATH — will install via npm');
}

/** Install Claude Code CLI globally via npm. Idempotent. */
function installClaudeCli({ force = false, dryRun = false } = {}) {
  if (haveCmd('claude') && !force) return;
  section('Installing Claude Code CLI');
  logInfo('npm install -g @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code');
  if (dryRun) return;
  try {
    execSync('npm install -g @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code', { stdio: 'inherit' });
    logOk('Claude Code CLI installed');
  } catch (err) {
    logErr(`npm install failed: ${err.message}`);
    logWarn('retry manually: npm install -g @anthropic-ai/claude-code');
  }
}

// ─── File sync helpers ──────────────────────────────────────────────────────

function syncDir(srcDir, destDir, opts = {}) {
  if (!existsSync(srcDir)) return { copied: 0, skipped: 0 };
  ensureDir(destDir);
  let copied = 0, skipped = 0;
  for (const name of readdirSync(srcDir)) {
    if (name.startsWith('.')) continue;
    const sp = join(srcDir, name), dp = join(destDir, name);
    const st = statSync(sp);
    if (opts.filter && !opts.filter(name, sp)) { skipped++; continue; }
    if (st.isDirectory()) { const r = syncDir(sp, dp, opts); copied += r.copied; skipped += r.skipped; }
    else { copyFileSync(sp, dp); copied++; }
  }
  return { copied, skipped };
}

// F-107: syncAgentFiles removed. Agent definitions live at
// .claude/agents/ (Claude Code canonical) — they were never sourced
// from config/agents/ in Claude Code era, and the legacy source dir
// was deleted.
//
// F-113: syncAgentFiles reinstated. Premium agents (@paul, @ria) and
// any future agent definition must reach user-level `~/.claude/agents/`
// so Claude Code sessions outside this repo can resolve them via the
// Agent tool. Filtered to `*.md` to avoid leaking workspace files.

export async function syncAgentFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, '.claude', 'agents');
  const dest = CLAUDE_AGENTS_DIR;
  if (!existsSync(src)) return { ok: true, message: `no agents source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: n => n.endsWith('.md') });
  return { ok: true, message: `${copied} agent(s) synced (${skipped} kept)`, copied, skipped };
}

// F-113: syncModelRouter added. The model-router.json file lives in
// the repo at .claude/model-router.json and routes per-agent model
// selection. Copied to user-level so the Bizar SDK can read
// it without a cwd dependency.

export async function syncModelRouter({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, '.claude', 'model-router.json');
  const dest = join(CLAUDE_DIR, 'model-router.json');
  if (!existsSync(src)) return { ok: true, message: `no model-router at ${src}` };
  if (existsSync(dest) && !force) return { ok: true, message: `${dest} already exists — pass --force to overwrite` };
  if (dryRun) return { ok: true, message: `[dry-run] would copy ${src} → ${dest}` };
  ensureDir(CLAUDE_DIR);
  copyFileSync(src, dest);
  return { ok: true, message: `model-router.json → ${dest}`, path: dest };
}

export async function syncSkillFiles({ dryRun = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'skills');
  const dest = CLAUDE_SKILLS_DIR;
  if (!existsSync(src)) return { ok: true, message: `no skills source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  ensureDir(dest); copyDirContents(src, dest);
  const sharedBaseline = join(REPO_ROOT, 'config', 'agents', '_shared', 'AGENT_BASELINE.md');
  if (existsSync(sharedBaseline)) {
    const baselineDir = join(dest, 'agent-baseline');
    ensureDir(baselineDir);
    copyFileSync(sharedBaseline, join(baselineDir, 'SKILL.md'));
  }
  const count = readdirSync(dest).filter(n => { try { return statSync(join(dest, n)).isDirectory(); } catch { return false; } }).length;
  return { ok: true, message: `${count} skill(s) synced`, copied: count, skipped: 0 };
}

export async function syncCommandFiles({ dryRun = false } = {}) {
  const candidates = [join(REPO_ROOT, '.claude', 'commands'), join(REPO_ROOT, 'config', 'commands')];
  let src = null;
  for (const c of candidates) if (existsSync(c)) { src = c; break; }
  if (!src) return { ok: true, message: 'no commands source found', copied: 0, skipped: 0 };
  const dest = CLAUDE_COMMANDS_DIR;
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: n => n.endsWith('.md') });
  return { ok: true, message: `${copied} command(s) synced (${skipped} kept)`, copied, skipped };
}

export async function syncRulesFiles({ dryRun = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'rules');
  const dest = CLAUDE_RULES_DIR;
  if (!existsSync(src)) return { ok: true, message: `no rules source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: n => n.endsWith('.md') || n.endsWith('.txt') });
  return { ok: true, message: `${copied} rule(s) synced (${skipped} kept)`, copied, skipped };
}

export async function syncHookFiles({ dryRun = false } = {}) {
  const src = join(REPO_ROOT, '.claude', 'hooks');
  const dest = CLAUDE_HOOKS_DIR;
  ensureDir(dest);
  if (!existsSync(src)) return { ok: true, message: `no hooks source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  copyDirContents(src, dest);
  for (const name of readdirSync(dest)) {
    const fp = join(dest, name);
    try {
      const st = statSync(fp);
      if (st.isFile() && (name.endsWith('.sh') || name.endsWith('.mjs'))) chmodSync(fp, 0o755);
    } catch { /* ignore */ }
  }
  return { ok: true, message: 'hook scripts installed', copied: readdirSync(dest).length, skipped: 0 };
}

// ─── git hooks ──────────────────────────────────────────────────────────────
//
// Install the repo-local git hooks (.git/hooks/commit-msg, pre-commit, pre-push)
// from scripts/git-hooks/. Runs only when invoked from inside a git repo, so
// the npm-install path (which doesn't have a .git/) is a no-op.
export function installGitHooks({ dryRun = false } = {}) {
  if (!existsSync(REPO_ROOT) || !existsSync(join(REPO_ROOT, '.git'))) {
    return { ok: true, message: 'no git repo — skipping git hook install', installed: [] };
  }
  if (dryRun) return { ok: true, message: '[dry-run] would install git hooks from scripts/git-hooks/', installed: [] };

  const src = join(REPO_ROOT, 'scripts', 'git-hooks');
  const dest = join(REPO_ROOT, '.git', 'hooks');
  if (!existsSync(src)) return { ok: true, message: `no git hooks source at ${src}`, installed: [] };
  ensureDir(dest);
  const installed = [];
  for (const name of readdirSync(src)) {
    const fp = join(src, name);
    const st = statSync(fp);
    if (!st.isFile()) continue;
    const dst = join(dest, name);
    copyFileSync(fp, dst);
    try { chmodSync(dst, 0o755); } catch { /* ignore */ }
    installed.push(name);
  }
  return { ok: true, message: `${installed.length} git hook(s) installed`, installed };
}

// ─── settings.json ──────────────────────────────────────────────────────────

export function writeClaudeSettings({ dryRun = false, force = false } = {}) {
  const fp = join(CLAUDE_DIR, 'settings.json');
  const existing = readJsonSafe(fp, {}) || {};
  const hook = (name, timeout = 15, runtime = 'node') => ({
    type: 'command',
    command: `${runtime} "${join(CLAUDE_HOOKS_DIR, name)}"`,
    timeout,
  });

  const bizarSettings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    mcpServers: {
      bizar: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@polderlabs/bizar-sdk', 'mcp'],
        env: { BIZAR_HOME },
      },
      semble: { type: 'stdio', command: 'semble', args: ['mcp'] },
      'agent-browser': { type: 'stdio', command: 'agent-browser', args: ['mcp'] },
    },
    permissions: {
      defaultMode: 'acceptEdits',
      allow: ['mcp__bizar__*', 'mcp__semble__*', 'mcp__agent-browser__*'],
      ask: [
        'Bash(git commit *)', 'Bash(git push *)',
        'Bash(gh pr create *)', 'Bash(gh pr edit *)', 'Bash(gh pr merge *)',
        'Bash(gh release *)', 'Bash(npm publish *)', 'Bash(bun publish *)',
        'Bash(vercel deploy *)', 'Bash(wrangler deploy *)',
      ],
      deny: [
        'Read(./.env)', 'Read(./.env.*)',
        'Bash(rm -rf /)', 'Bash(sudo *)',
        'Bash(git push --force *)', 'Bash(git push -f *)', 'Bash(git rebase *)',
        'Write(./node_modules/**)',
      ],
    },
    autoMode: {
      environment: [
        '$defaults',
        'Source control: the current repository and its configured remotes.',
        'Development scope: local files, tests, builds, and declared dependencies in the current repository.',
      ],
      allow: [
        '$defaults',
        'Local reversible edits and test/build commands within the current repository.',
        'Installing dependencies already declared by repository manifests without changing those manifests.',
        'Read-only Git, GitHub, documentation, and package-registry operations.',
      ],
      soft_deny: [
        '$defaults',
        'Commits, pushes, pull-request mutations, releases, package publication, or deployments without the configured human approval hook.',
        'Force push, rebase, remote branch deletion, or other history rewriting.',
        'Production or shared-infrastructure writes, credential changes, public exposure, or irreversible local destruction.',
      ],
    },
    attribution: { commit: '', pr: '' },
    worktree: {
      baseRef: 'head',
      cleanupPeriodDays: 7,
    },
    enableWorkflows: true,
    alwaysThinkingEnabled: true,
    autoDreamEnabled: true,
    showThinkingSummaries: true,
    env: {
      BIZAR_HOME,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'http://localhost:20128/v1',
      BIZAR_MODEL_ROUTER_URL: process.env.BIZAR_MODEL_ROUTER_URL || 'http://localhost:20128/v1',
    },
    hooks: {
      PreToolUse: [
        { matcher: 'Write|Edit|MultiEdit', hooks: [hook('pretooluse-editwrite.mjs', 30), hook('path-ownership-guard.mjs', 30), hook('content-style-guard.mjs', 30)] },
        { matcher: 'Bash', hooks: [hook('pretooluse-bash.mjs', 30), hook('git-workflow-guard.mjs', 30), hook('content-style-guard.mjs', 30), hook('simplify-guard.mjs', 30)] },
      ],
      PostToolUse: [
        { matcher: 'Edit|Write|MultiEdit', hooks: [hook('posttooluse-editwrite.mjs', 30)] },
        { matcher: 'Bash', hooks: [hook('auto-instinct.sh', 15, 'bash')] },
        { matcher: 'Skill', hooks: [hook('simplify-guard.mjs', 30)] },
      ],
      UserPromptSubmit: [
        { hooks: [hook('control-inbox.mjs', 10)] },
        { hooks: [hook('worker-suggest.mjs', 10)] },
        { hooks: [hook('thinking-route.mjs', 10)] },
        { hooks: [hook('telemetry.mjs', 10)] },
      ],
      SessionStart: [{ hooks: [hook('control-inbox.mjs', 10), hook('sessionstart-prime.mjs'), hook('telemetry.mjs', 10)] }],
      SessionEnd: [{ hooks: [hook('sessionend-recall.mjs'), hook('learning-extract.mjs')] }],
      PreCompact: [{ matcher: '*', hooks: [hook('precompact-priorities.sh', 15, 'bash')] }],
      SubagentStart: [
        { hooks: [hook('agent-grounding.mjs')] },
        { matcher: '^(linda|karen|carl|qa-reviewer|principal-engineer|debug-specialist)$', hooks: [hook('advisor-context.mjs')] },
        { matcher: '^(brad|carl|pam|brenda|karen|todd|ria)$', hooks: [hook('worktree-bootstrap.mjs', 30)] },
      ],
    },
  };

  const merged = { ...existing };
  if (force) { Object.assign(merged, bizarSettings); }
  else {
    merged.$schema   = merged.$schema || bizarSettings.$schema;
    merged.mcpServers = { ...(existing.mcpServers || {}), ...bizarSettings.mcpServers };
    merged.permissions = {
      defaultMode: existing.permissions?.defaultMode || bizarSettings.permissions.defaultMode,
      allow: [...new Set([...(existing.permissions?.allow || []), ...bizarSettings.permissions.allow])],
      deny:  [...new Set([...(existing.permissions?.deny || []),  ...bizarSettings.permissions.deny])],
      ask:   [...new Set([...(existing.permissions?.ask || []), ...bizarSettings.permissions.ask])],
    };
    merged.env   = { ...(existing.env || {}), ...bizarSettings.env };
    merged.hooks = { ...(existing.hooks || {}), ...bizarSettings.hooks };
    merged.autoMode = existing.autoMode || bizarSettings.autoMode;
    merged.attribution = existing.attribution || bizarSettings.attribution;
    merged.worktree = { ...(bizarSettings.worktree || {}), ...(existing.worktree || {}) };
    for (const key of ['enableWorkflows', 'alwaysThinkingEnabled', 'autoDreamEnabled', 'showThinkingSummaries']) {
      if (merged[key] === undefined) merged[key] = bizarSettings[key];
    }
  }

  if (dryRun) return { ok: true, message: `[dry-run] would write ${fp}` };
  ensureDir(CLAUDE_DIR);
  writeFileSync(fp, JSON.stringify(merged, null, 2) + '\n');
  return { ok: true, message: `wrote ${fp}`, path: fp };
}

// ─── CLAUDE.md mirror ──────────────────────────────────────────────────────

export function writeClaudeMdMirror({ dryRun = false, force = false } = {}) {
  const srcCandidates = [join(REPO_ROOT, 'AGENTS.md'), join(REPO_ROOT, 'CLAUDE.md')];
  const src = srcCandidates.find(p => existsSync(p));
  const dest = join(CLAUDE_DIR, 'CLAUDE.md');
  if (!src) return { ok: false, message: 'no CLAUDE.md / AGENTS.md found in repo root' };
  if (existsSync(dest) && !force) return { ok: true, message: `${dest} already exists — pass --force to overwrite` };
  if (dryRun) return { ok: true, message: `[dry-run] would mirror ${src} → ${dest}` };
  ensureDir(CLAUDE_DIR);
  const body = readFileSync(src, 'utf8');
  const banner = `# CLAUDE.md — Mirror of AGENTS.md for Claude Code compatibility\n\n` +
    `> Auto-generated by \`cli/provision.mjs:writeClaudeMdMirror\`.\n` +
    `> DO NOT EDIT THIS FILE DIRECTLY — edit \`AGENTS.md\` and run \`make mirror-claude-md\`.\n\n` +
    `---\n\n`;
  writeFileSync(dest, banner + body);
  return { ok: true, message: `mirrored ${src} → ${dest}`, path: dest };
}

// ─── MCP server registration ────────────────────────────────────────────────

export function setupMcpServer({ dryRun = false } = {}) {
  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  const existing = readJsonSafe(settingsPath, null);
  if (existing && existing.mcpServers && existing.mcpServers.bizar) {
    return { ok: true, message: `bizar MCP server already registered in ${settingsPath}` };
  }
  if (!haveCmd('claude')) return { ok: false, message: 'claude CLI not on PATH' };
  if (dryRun) return { ok: true, message: '[dry-run] would run: claude mcp add bizar -- npx -y @polderlabs/bizar-sdk mcp' };
  const r = spawnSync('claude', ['mcp', 'add', '-f', '-s', 'user', 'bizar', '--', 'npx', '-y', '@polderlabs/bizar-sdk', 'mcp'], { stdio: 'inherit', timeout: 60_000 });
  if (r.status !== 0) return { ok: false, message: `claude mcp add exited with code ${r.status}` };
  return { ok: true, message: 'bizar MCP server registered' };
}

// ─── Detection ─────────────────────────────────────────────────────────────

/**
 * Probe the current state without modifying anything.
 * Returned shape:
 *   {
 *     claudeDir, claudeCli, agentsDir, skillsDir, commandsDir,
 *     hooksDir, rulesDir, settingsFile, mcpServer,
 *     bizarHome, gitRepo,
 *   }
 */
export function detectState() {
  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  const settings = readJsonSafe(settingsPath, null);
  let claudeVersion = null;
  try {
    claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 })
      .toString().trim().split('\n')[0] || null;
  } catch { /* not installed */ }

  const countMd = (dir) => {
    if (!existsSync(dir)) return 0;
    try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mjs'))).length; }
    catch { return 0; }
  };
  const countSkillDirs = (dir) => {
    if (!existsSync(dir)) return 0;
    try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).length; }
    catch { return 0; }
  };

  const mcpServer = settings?.mcpServers?.bizar
    ? { registered: true, type: settings.mcpServers.bizar.type || 'stdio', command: settings.mcpServers.bizar.command || 'npx' }
    : { registered: false };

  return {
    claudeDir: CLAUDE_DIR,
    claudeCli: { available: !!claudeVersion, version: claudeVersion },
    agentsDir:   { exists: existsSync(CLAUDE_AGENTS_DIR),   count: countMd(CLAUDE_AGENTS_DIR) },
    skillsDir:   { exists: existsSync(CLAUDE_SKILLS_DIR),   count: countSkillDirs(CLAUDE_SKILLS_DIR) },
    commandsDir:  { exists: existsSync(CLAUDE_COMMANDS_DIR), count: countMd(CLAUDE_COMMANDS_DIR) },
    hooksDir:    { exists: existsSync(CLAUDE_HOOKS_DIR),    count: countMd(CLAUDE_HOOKS_DIR) },
    rulesDir:    { exists: existsSync(CLAUDE_RULES_DIR),     count: countMd(CLAUDE_RULES_DIR) },
    settingsFile: { exists: existsSync(settingsPath), parses: settings !== null && typeof settings === 'object', path: settingsPath },
    mcpServer,
    bizarHome: { exists: existsSync(BIZAR_HOME), path: BIZAR_HOME },
    gitRepo: existsSync(join(REPO_ROOT, '.git')),
  };
}

export function detectStateJson() {
  return JSON.stringify(detectState(), null, 2);
}

// ─── Top-level orchestration ─────────────────────────────────────────────────

/**
 * The unified provision flow. `mode` is 'install' or 'update'.
 * Every step is idempotent.
 */
export async function runProvision(opts = {}) {
  const { mode = 'install', dryRun = false, force = false } = opts;
  const effectiveMode = mode === 'update' ? 'update' : 'install';

  console.log('');
  console.log(chalk.bold.cyan(`  ⚡ BizarHarness Provisioner v${BIZAR_VERSION} (Claude Code)`));
  console.log(chalk.dim(`     Mode: ${effectiveMode}${force ? ' (force)' : ''}${dryRun ? ' (dry-run)' : ''}`));
  console.log('');

  const state = detectState();

  section('Bizar HOME');
  const bizarHomeStep = ensureBizarHome({ dryRun });
  if (bizarHomeStep.ok) logOk(bizarHomeStep.message); else logErr(bizarHomeStep.message);

  checkToolchain();
  installClaudeCli({ force, dryRun });

  const stepResults = [];
  const runStep = async (label, fn) => {
    section(label);
    const r = await fn();
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.message}`);
    stepResults.push({ label, ...r });
    return r;
  };

  await runStep('Syncing skills',    () => syncSkillFiles({ dryRun, force }));
  await runStep('Syncing commands',   () => syncCommandFiles({ dryRun, force }));
  await runStep('Syncing rules',      () => syncRulesFiles({ dryRun, force }));
  await runStep('Syncing hooks',      () => syncHookFiles({ dryRun, force }));
  await runStep('Syncing agents',     () => syncAgentFiles({ dryRun, force }));
  await runStep('Installing git hooks', () => installGitHooks({ dryRun }));
  await runStep('Building SDK',       () => buildSdk({ dryRun }));

  section('Writing settings.json');
  const settingsStep = writeClaudeSettings({ dryRun, force });
  if (settingsStep.ok) logOk(settingsStep.message); else logErr(settingsStep.message);
  stepResults.push({ label: 'settings.json', ...settingsStep });

  section('Syncing model-router.json');
  const routerStep = await syncModelRouter({ dryRun, force });
  if (routerStep.ok) logOk(routerStep.message); else logErr(routerStep.message);
  stepResults.push({ label: 'model-router', ...routerStep });

  section('MCP server (bizar)');
  const mcpStep = setupMcpServer({ dryRun });
  if (mcpStep.ok) logOk(mcpStep.message); else logWarn(mcpStep.message);
  stepResults.push({ label: 'mcp-server', ...mcpStep });

  section('CLAUDE.md mirror');
  const claudeMdStep = writeClaudeMdMirror({ dryRun, force });
  if (claudeMdStep.ok) logOk(claudeMdStep.message); else logWarn(claudeMdStep.message);
  stepResults.push({ label: 'claude-md', ...claudeMdStep });

  section('Provision complete');
  console.log(chalk.dim(JSON.stringify(detectState(), null, 2)));
  console.log('');
  const anyFail = stepResults.some(r => !r.ok);
  if (anyFail) console.log(chalk.yellow('  ⚠ Some steps had issues.'));
  else { console.log(chalk.bold.green('  ✓ Bizar is ready.')); console.log(chalk.dim('     Next: restart your Claude Code session.')); }
  console.log('');
  console.log(chalk.dim('  Premium model: ANTHROPIC_MODEL=cx/gpt-5.6-sol claude'));
  console.log(chalk.dim('  See /use-premium or .claude/commands/use-premium.md for the full launch snippet.'));
  console.log('');
  return { ok: !anyFail, mode: effectiveMode, state: detectState(), stepResults };
}

// ─── Legacy / gap-closure helpers (from old provision.mjs) ───────────────────

/**
 * Register every config/skills/<name>/SKILL.md in the shared
 * `~/.agents/.skill-lock.json` compatibility registry.
 */
export function writeBizarSkillLock({ skillsSrc, agentsDir }) {
  if (!existsSync(skillsSrc)) return { ok: true, count: 0, path: join(agentsDir, '.skill-lock.json') };
  const lockPath = join(agentsDir, '.skill-lock.json');
  let lock = { version: 3, skills: {} };
  try {
    const raw = readFileSync(lockPath, 'utf8');
    lock = JSON.parse(raw);
    if (!lock.skills || typeof lock.skills !== 'object') lock.skills = {};
  } catch { /* first install */ }
  const now = new Date().toISOString();
  let count = 0;
  for (const skillDir of readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!skillDir.isDirectory()) continue;
    const name = skillDir.name;
    const existing = lock.skills[name];
    if (existing && existing.source === 'bizar/builtin') { existing.updatedAt = now; count++; continue; }
    lock.skills[name] = {
      source: 'bizar/builtin', sourceType: 'local',
      sourceUrl: 'https://github.com/DrB0rk/BizarHarness',
      skillPath: 'config/skills/' + name + '/SKILL.md',
      skillFolderHash: 'bizar-managed', pluginName: 'bizar',
      installedAt: existing && existing.installedAt ? existing.installedAt : now,
      updatedAt: now,
    };
    count++;
  }
  try {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    return { ok: true, count, path: lockPath };
  } catch (err) {
    return { ok: false, count: 0, path: lockPath, error: err.message };
  }
}

/**
 * Sync commands + skills + hooks + rules + workflows into CLAUDE_DIR.
 * Combines the old syncAgentFiles / syncConfigExtras into one.
 */
export async function syncConfigExtras({ dryRun = false } = {}) {
  if (dryRun) return { ok: true, message: '[dry-run] would sync commands + skills + hooks + rules + workflows', counts: { skills: 0, commands: 0, hooks: 0, rules: 0, workflows: 0 } };

  const copyDirIfExists = async (srcDir, dstDir) => {
    if (!existsSync(srcDir)) return;
    ensureDir(dstDir);
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const src = join(srcDir, entry.name);
      const dst = join(dstDir, entry.name);
      if (entry.isDirectory()) await copyDirIfExists(src, dst);
      else copyFileSync(src, dst);
    }
  };

  const counts = { skills: 0, commands: 0, hooks: 0, rules: 0, workflows: 0 };

  // Commands
  const commandsSrc = join(REPO_ROOT, 'config', 'commands');
  if (existsSync(commandsSrc)) {
    const commandsDst = join(CLAUDE_DIR, 'commands');
    ensureDir(commandsDst);
    for (const cmd of readdirSync(commandsSrc, { withFileTypes: true })) {
      if (!cmd.isFile() && !cmd.isDirectory()) continue;
      const src = join(commandsSrc, cmd.name);
      const dst = join(commandsDst, cmd.name);
      if (cmd.isDirectory()) await copyDirIfExists(src, dst);
      else copyFileSync(src, dst);
      counts.commands++;
    }
  }

  // Skills
  const skillsSrc = join(REPO_ROOT, 'config', 'skills');
  if (existsSync(skillsSrc)) {
    const skillsDst = join(CLAUDE_DIR, 'skills');
    ensureDir(skillsDst);
    for (const skillDir of readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue;
      await copyDirIfExists(join(skillsSrc, skillDir.name), join(skillsDst, skillDir.name));
      counts.skills++;
    }
  }

  // Hooks
  const hooksSrc = join(REPO_ROOT, '.claude', 'hooks');
  if (existsSync(hooksSrc)) {
    const hooksDst = join(CLAUDE_DIR, 'hooks');
    ensureDir(hooksDst);
    for (const entry of readdirSync(hooksSrc, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      copyFileSync(join(hooksSrc, entry.name), join(hooksDst, entry.name));
      try { chmodSync(join(hooksDst, entry.name), 0o755); } catch { /* ignore */ }
    }
    counts.hooks = readdirSync(hooksSrc, { withFileTypes: true }).filter(e => e.isFile()).length;
  }

  // Rules
  const rulesSrc = join(REPO_ROOT, 'config', 'rules');
  if (existsSync(rulesSrc)) {
    const rulesDst = join(CLAUDE_DIR, 'rules');
    ensureDir(rulesDst);
    let ruleCount = 0;
    for (const entry of readdirSync(rulesSrc, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) continue;
      copyFileSync(join(rulesSrc, entry.name), join(rulesDst, entry.name));
      ruleCount++;
    }
    counts.rules = ruleCount;
  }

  // Workflows
  const workflowsSrc = join(REPO_ROOT, 'config', 'workflows');
  if (existsSync(workflowsSrc)) {
    const workflowsDst = join(CLAUDE_DIR, 'workflows');
    await copyDirIfExists(workflowsSrc, workflowsDst);
    counts.workflows = 1;
  }

  return { ok: true, message: `synced (${counts.commands} commands, ${counts.skills} skills, ${counts.hooks} hooks, ${counts.rules} rules, ${counts.workflows} workflows)`, counts };
}

// ─── CLI entry ──────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const opts = { mode: 'install', dryRun: false, force: false, yes: false, start: true, update: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode=install') opts.mode = 'install';
    else if (a === '--mode=update') opts.mode = 'update';
    else if (a === '--mode=install-only-system') opts.mode = 'install-only-system';
    else if (a === '--mode') {
      const v = argv[++i];
      if (v === 'install' || v === 'update' || v === 'install-only-system') opts.mode = v;
    } else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--non-interactive') opts.yes = true;
    else if (a === '--no-service') opts.start = false;
    else if (a === '--update') opts.mode = 'update';
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node cli/provision.mjs [--mode=install|update|install-only-system]\n       [--dry-run] [--force] [--yes] [--non-interactive] [--no-service]');
      process.exit(0);
    }
  }
  if (opts.mode === 'update') opts.update = true;
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseFlags(process.argv.slice(2));
  runProvision(opts).catch((err) => {
    logErr(`provision failed: ${err?.message || err}`);
    process.exit(1);
  });
}

// Back-compat alias — `bizar update` historically
// called `runUpdate(args)`; we collapsed install + update onto
// `runProvision({ mode: 'update', ... })`. Keep `runUpdate` importable so
// `cli/commands/install.mjs` (which still uses the historical signature)
// works without modification.
export const runUpdate = (subargs, opts = {}) =>
  runProvision({ ...opts, mode: 'update', subargs });
