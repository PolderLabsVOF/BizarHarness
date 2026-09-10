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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveBizarHome,
  resolveClaudeConfigDir,
} from './config-paths.mjs';
import { validateNativeWorkflowDirectory } from '../config/workflows/lib/native-contract.mjs';
import {
  ensureOpenKanProject,
  installOpenKanAgent,
  installOpenKanCommandShims,
  installOpenKanPromise,
  resolveOpenKanHome,
  resolveOpenKanOk,
  verifyOpenKanRuntime,
} from './openkan.mjs';
import { mergeSettings } from './install/merge-settings.mjs';

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
  return resolveClaudeConfigDir();
}

export const CLAUDE_DIR = resolveClaudeDir();

/** `~/.config/bizar/` — Bizar runtime state (NOT under ~/.claude/). Resolved
 * lazily so callers can override `BIZAR_HOME` per-invocation via the
 * process environment, e.g. `BIZAR_HOME=/tmp/bizar node cli/bin.mjs install`. */
function computeBizarHome() {
  return resolveBizarHome();
}
/** Back-compat: `BIZAR_HOME` is re-evaluated on every read. Use this everywhere
 * instead of capturing the value at module load. */
export function BIZAR_HOME() {
  return computeBizarHome();
}

// Standard Claude Code subdirectories
export const CLAUDE_AGENTS_DIR   = join(CLAUDE_DIR, 'agents');
export const CLAUDE_SKILLS_DIR   = join(CLAUDE_DIR, 'skills');
export const CLAUDE_COMMANDS_DIR = join(CLAUDE_DIR, 'commands');
export const CLAUDE_HOOKS_DIR    = join(CLAUDE_DIR, 'hooks');
export const CLAUDE_RULES_DIR    = join(CLAUDE_DIR, 'rules');

// `mergeSettings` is the canonical settings-merge function; the helpers
// `mergeBizarHooks` and `normalizePermissionLists` are re-exported for
// back-compat with `cli/provision.test.mjs`, which imports them directly
// from this module. All three live in `cli/install/merge-settings.mjs`;
// this module only owns the disk read/write boundary in
// `writeClaudeSettings`.
export { mergeBizarHooks, normalizePermissionLists, mergeSettings } from './install/merge-settings.mjs';

// ─── Tiny utilities ──────────────────────────────────────────────────────────

export function haveCmd(cmd) {
  try {
    if (process.platform === 'win32') {
      execFileSync('where.exe', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    } else {
      execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] });
    }
    return true;
  } catch {
    return false;
  }
}

export const CLAUDE_NATIVE_INSTALL_URL = 'https://claude.ai/install.sh';
export const CLAUDE_NATIVE_INSTALL_COMMAND = `curl -fsSL ${CLAUDE_NATIVE_INSTALL_URL} | bash`;

export function claudeNativeInstallCommand(platform = process.platform) {
  return platform === 'win32'
    ? 'irm https://claude.ai/install.ps1 | iex'
    : CLAUDE_NATIVE_INSTALL_COMMAND;
}

function nativeClaudeBin() {
  const root = process.platform === 'win32'
    ? (process.env.USERPROFILE || process.env.HOME || homedir())
    : (process.env.HOME || homedir());
  return join(root, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
}

function preferNativeClaudeOnPath() {
  const bin = nativeClaudeBin();
  if (!existsSync(bin)) return false;
  const dir = dirname(bin);
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const pathParts = (process.env.PATH || '').split(delimiter).filter(Boolean);
  if (!pathParts.includes(dir)) process.env.PATH = [dir, ...pathParts].join(delimiter);
  return true;
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
  return readJsonSafe(join(BIZAR_HOME(), 'installed.json'), null);
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
    mkdirSync(BIZAR_HOME(), { recursive: true });
    writeFileSync(join(BIZAR_HOME(), 'installed.json'), JSON.stringify(marker, null, 2) + '\n');
    return { ok: true, marker, message: `install marker → ${join(BIZAR_HOME(), 'installed.json')}` };
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

import { ensureSecureDir } from './commands/secure-dir.mjs';

/** Ensure `~/.config/bizar/` exists with loop state. Idempotent. */
export function ensureBizarHome({ dryRun = false } = {}) {
  if (dryRun) return { ok: true, message: `[dry-run] would ensure ${BIZAR_HOME()}` };
  mkdirSync(BIZAR_HOME(), { recursive: true });
  mkdirSync(join(BIZAR_HOME(), 'loops'), { recursive: true });
  // F-194: typed EvidenceBundle ledger + structural-fingerprint learning ledger.
  // Both at mode 0o700 — operator-only reads. Shared via secure-dir helper.
  ensureSecureDir({ env: process.env, envSubdir: 'BIZAR_HOME', subdir: 'evidence' });
  ensureSecureDir({ env: process.env, envSubdir: 'BIZAR_HOME', subdir: 'learning' });
  return { ok: true, message: `${BIZAR_HOME()} ready`, path: BIZAR_HOME() };
}

// ─── Toolchain ───────────────────────────────────────────────────────────────

function checkToolchain() {
  section('Toolchain');
  if (haveCmd('node')) logOk(`node ${execSync('node --version').toString().trim()}`);
  else { logErr('node not on PATH — install Node.js 22+ (required by OpenKan)'); process.exit(1); }
  if (haveCmd('npm'))  logOk(`npm ${execSync('npm --version').toString().trim()}`);
  else logWarn('npm not on PATH');
  if (haveCmd('git'))  logOk(`git ${execSync('git --version').toString().trim().split(' ')[2]}`);
  else logWarn('git not on PATH');
  if (haveCmd('claude')) {
    logOk(`claude ${execSync('claude --version').toString().trim().split('\n')[0]}`);
    if (!existsSync(nativeClaudeBin())) logInfo('existing Claude Code installation will be migrated to the native installer');
  } else logWarn('claude not on PATH — will install with Anthropic\'s native installer');
}

/** Install Claude Code CLI with Anthropic's native installer. Idempotent. */
export function installClaudeCli({ force = false, dryRun = false } = {}) {
  // Do not treat an npm-global `claude` as satisfying this check: a normal
  // Bizar install should migrate that setup to Anthropic's native launcher.
  if (!force && preferNativeClaudeOnPath()) return { ok: true, installed: false, method: 'native' };
  section('Installing Claude Code CLI');
  const installCommand = claudeNativeInstallCommand();
  logInfo(installCommand);
  if (dryRun) return { ok: true, installed: false, dryRun: true };
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        installCommand,
      ], { stdio: 'inherit' });
    } else {
      execFileSync('bash', ['-lc', `set -o pipefail; ${installCommand}`], { stdio: 'inherit' });
    }
    preferNativeClaudeOnPath();
    if (!haveCmd('claude')) throw new Error(`native installer completed but ${nativeClaudeBin()} is not available`);
    logOk('Claude Code CLI installed with the native installer');
    return { ok: true, installed: true, method: 'native' };
  } catch (err) {
    logErr(`native Claude Code install failed: ${err.message}`);
    logWarn(`retry manually: ${installCommand}`);
    return { ok: false, installed: false, error: err };
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

/**
 * Remove entries in destDir that are not present in srcDir.
 * Honors the same recursive shape and filter as syncDir().
 * Used by --force installs to clear stale files left over from
 * previous versions (e.g. agents renamed by F-112).
 *
 * Policy: `bizar install --force` treats the global state under
 * `~/.claude/{agents,skills,commands,rules,hooks}` as fully Bizar-
 * managed. Anything in dest that does not appear in src is removed.
 * This is intentionally aggressive; users who keep hand-edited
 * entries under those paths should run without `--force` to leave
 * them alone. See .ok/ task tsk-T1Aobcjj for the migration context.
 *
 * Returns { removed, kept } counts.
 */
export function pruneStale(srcDir, destDir, opts = {}) {
  if (!existsSync(destDir)) return { removed: 0, kept: 0 };
  if (!existsSync(srcDir)) return { removed: 0, kept: 0 };
  let removed = 0, kept = 0;
  for (const name of readdirSync(destDir)) {
    if (name.startsWith('.')) continue;
    const dp = join(destDir, name);
    const sp = join(srcDir, name);
    let dstStat;
    try { dstStat = statSync(dp); } catch { continue; }
    const srcExists = existsSync(sp);
    if (dstStat.isDirectory()) {
      if (!srcExists) {
        rmSync(dp, { recursive: true, force: true });
        removed++;
        continue;
      }
      const r = pruneStale(sp, dp, opts);
      removed += r.removed;
      kept += r.kept;
      // Drop now-empty directories.
      try {
        if (readdirSync(dp).length === 0) rmSync(dp, { recursive: true, force: true });
      } catch { /* ignore */ }
      continue;
    }
    if (!srcExists) {
      if (opts.filter && !opts.filter(name, dp)) { kept++; continue; }
      rmSync(dp, { force: true });
      removed++;
    } else {
      kept++;
    }
  }
  return { removed, kept };
}

/**
 * Run the prune pass under the same conditions used by every sync*
 * helper and return a `{ pruned, tail }` pair the caller appends
 * to its result message. No-op when `force` is false.
 */
function pruneReport(srcDir, destDir, filter, force) {
  if (!force) return { pruned: 0, tail: '' };
  const pruned = pruneStale(srcDir, destDir, { filter }).removed;
  return { pruned, tail: pruned ? `, pruned ${pruned} stale` : '' };
}

// Agent definitions are sourced from the repository's canonical
// config/claude/agents/ tree and installed into user-level
// `$CLAUDE_CONFIG_DIR/agents/`. Filter to `*.md` to avoid copying workspace
// files; the source tree is never inferred from a project .claude directory.

export async function syncAgentFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'claude', 'agents');
  const dest = CLAUDE_AGENTS_DIR;
  if (!existsSync(src)) return { ok: true, message: `no agents source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}${force ? ' (prune stale)' : ''}` };
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: n => n.endsWith('.md') });
  // v10.20.0: ship `_shared/*.md` (AGENT_BASELINE + CLAUDE_TOOLS + SKILLS)
  // alongside agents so the Git / External-APIs / tool-shape pointers
  // actually land on the user's machine instead of being dead text in repo.
  // syncDir's `*.md` filter rejects `_shared` at the parent level (the dir
  // name itself doesn't end in `.md`), so we copy the shared tree explicitly.
  const sharedSrc = join(src, '_shared');
  const sharedDst = join(dest, '_shared');
  let sharedCopied = 0;
  if (existsSync(sharedSrc)) {
    ensureDir(sharedDst);
    for (const f of readdirSync(sharedSrc)) {
      if (f.endsWith('.md')) { copyFileSync(join(sharedSrc, f), join(sharedDst, f)); sharedCopied++; }
    }
  }
  const { pruned, tail } = pruneReport(src, dest, n => n.endsWith('.md'), force);
  return { ok: true, message: `${copied} agent(s) synced (${skipped} kept)${sharedCopied ? `, ${sharedCopied} _shared/*.md` : ''}${tail}`, copied, skipped, pruned };
}

// The dynamic model router is operator-owned state. It is created only under
// Bizar's global config root; a repository can never supply a runtime model.

export async function syncSkillFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'skills');
  const dest = CLAUDE_SKILLS_DIR;
  if (!existsSync(src)) return { ok: true, message: `no skills source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}${force ? ' (prune stale)' : ''}` };
  ensureDir(dest); copyDirContents(src, dest);
  const sharedBaseline = join(REPO_ROOT, 'config', 'agents', '_shared', 'AGENT_BASELINE.md');
  if (existsSync(sharedBaseline)) {
    const baselineDir = join(dest, 'agent-baseline');
    ensureDir(baselineDir);
    copyFileSync(sharedBaseline, join(baselineDir, 'SKILL.md'));
  }
  // Skill packs are directories containing SKILL.md; a stray non-SKILL.md
  // file in dest is almost certainly user-owned. Restrict the prune pass
  // to .md files only.
  const { pruned, tail } = pruneReport(src, dest, n => n.endsWith('.md'), force);
  const count = readdirSync(dest).filter(n => { try { return statSync(join(dest, n)).isDirectory(); } catch { return false; } }).length;
  return { ok: true, message: `${count} skill(s) synced${tail}`, copied: count, skipped: 0, pruned };
}

export async function syncCommandFiles({ dryRun = false, force = false } = {}) {
  const candidates = [join(REPO_ROOT, 'config', 'claude', 'commands'), join(REPO_ROOT, 'config', 'commands')];
  let src = null;
  for (const c of candidates) if (existsSync(c)) { src = c; break; }
  if (!src) return { ok: true, message: 'no commands source found', copied: 0, skipped: 0 };
  const dest = CLAUDE_COMMANDS_DIR;
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}${force ? ' (prune stale)' : ''}` };
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: n => n.endsWith('.md') });
  const { pruned, tail } = pruneReport(src, dest, n => n.endsWith('.md'), force);
  return { ok: true, message: `${copied} command(s) synced (${skipped} kept)${tail}`, copied, skipped, pruned };
}

export async function syncRulesFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'rules');
  const dest = CLAUDE_RULES_DIR;
  if (!existsSync(src)) return { ok: true, message: `no rules source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}${force ? ' (prune stale)' : ''}` };
  ensureDir(dest);
  const ruleFilter = n => n.endsWith('.md') || n.endsWith('.txt');
  const { copied, skipped } = syncDir(src, dest, { filter: ruleFilter });
  const { pruned, tail } = pruneReport(src, dest, ruleFilter, force);
  return { ok: true, message: `${copied} rule(s) synced (${skipped} kept)${tail}`, copied, skipped, pruned };
}

export async function syncHookFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'claude', 'hooks');
  const dest = CLAUDE_HOOKS_DIR;
  ensureDir(dest);
  if (!existsSync(src)) return { ok: true, message: `no hooks source at ${src}`, copied: 0, skipped: 0 };
  if (dryRun) return { ok: true, message: `[dry-run] would sync ${src} → ${dest}${force ? ' (prune stale)' : ''}` };
  copyDirContents(src, dest);
  // Hooks are .mjs / .sh scripts. Restrict prune to those extensions so
  // any user-owned file (READMEs, fixtures, etc.) is not removed.
  const hookFilter = n => n.endsWith('.mjs') || n.endsWith('.sh');
  const { pruned, tail } = pruneReport(src, dest, hookFilter, force);
  for (const name of readdirSync(dest)) {
    const fp = join(dest, name);
    try {
      const st = statSync(fp);
      if (st.isFile() && (name.endsWith('.sh') || name.endsWith('.mjs'))) chmodSync(fp, 0o755);
    } catch { /* ignore */ }
  }
  return { ok: true, message: `hook scripts installed${tail}`, copied: readdirSync(dest).length, skipped: 0, pruned };
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

// The settings-merge logic lives in `cli/install/merge-settings.mjs`.
// `provision.mjs` keeps `writeClaudeSettings` as the entry point (the
// disk read/write boundary) and re-exports `mergeSettings`,
// `mergeBizarHooks`, and `normalizePermissionLists` from the new module
// so the existing import paths continue to resolve identically for
// downstream callers and the regression contract in
// `cli/install/__tests__/merge-settings.test.mjs` stays green.

// Local `git commit` is intentionally allowed silently (see AGENTS.md
// "Autonomy and parallelism"); only `git push`, `gh pr`/`release`,
// publishes, and deploys remain hard HITL mutations.
const HARD_MUTATION_PERMISSION = /^(?:Bash\()?\s*(?:git\s+push|gh\s+(?:pr\s+(?:create|edit|merge|close|reopen|ready|review|comment)|release\s+(?:create|edit|delete|upload))|(?:npm|bun|pnpm)\s+publish|(?:vercel|wrangler|flyctl)\s+(?:deploy|publish))\b/i;

// F-180 — documentation-as-code surface for the "hard approval list" from
// AGENTS.md. These are the categories of mutations that the Bizar policy
// treats as human-only gates; the `permission-request.mjs` hook enforces
// the destructive subset (force-push, rebase, root deletion,
// system-destructive commands) and the `git-workflow-guard.mjs`
// advisory hook surfaces the rest. Operators may NOT move any of these
// patterns into `permissions.allow` without explicitly opting out of the
// Bizar guard. The list mirrors the AGENTS.md "authoritative hard
// approval list" verbatim so a drift in one place fails the regression
// test in `cli/provision.test.mjs`.
export const HARD_MUTATION_ALLOW = Object.freeze([
  'Bash(git push *)',
  'Bash(git -C * push *)',
  'Bash(git --git-dir=* push *)',
  'Bash(git push --force *)',
  'Bash(git push -f *)',
  'Bash(git -C * push --force *)',
  'Bash(git -C * push -f *)',
  'Bash(git --git-dir=* push --force *)',
  'Bash(git --git-dir=* push -f *)',
  'Bash(git rebase *)',
  'Bash(git -C * rebase *)',
  'Bash(git --git-dir=* rebase *)',
  'Bash(gh pr create *)',
  'Bash(gh pr edit *)',
  'Bash(gh pr merge *)',
  'Bash(gh pr close *)',
  'Bash(gh pr reopen *)',
  'Bash(gh pr ready *)',
  'Bash(gh pr review *)',
  'Bash(gh pr comment *)',
  'Bash(gh release *)',
  'Bash(npm publish *)',
  'Bash(bun publish *)',
  'Bash(pnpm publish *)',
  'Bash(vercel deploy *)',
  'Bash(wrangler deploy *)',
  'Bash(flyctl deploy *)',
  'Bash(rm -rf /)',
  'Bash(sudo *)',
  'Bash(mkfs*)',
  'Bash(shutdown *)',
  'Bash(halt *)',
  'Bash(poweroff *)',
  'Bash(reboot *)',
  'Read(./.env)',
  'Read(./.env.*)',
]);

/**
 * Resolve a hook command for `sub` (e.g. `'user-prompt-submit'`).
 *
 * If `${claudeDir}/hooks/bizar-hook-wrapper.sh` exists AND is executable,
 * returns the absolute-path wrapper invocation. Otherwise falls back to
 * the POSIX-portable `sh -c` PATH probe shipped by
 * `config/claude/settings.json` so the hook still resolves `bizar` on
 * stripped-PATH systems. The fallback never hard-codes `/usr/bin/bizar`
 * or any single install location; it probes `$HOME/.npm-global/bin`,
 * `$HOME/.local/bin`, `/usr/local/bin`, `/usr/bin`, then `command -v`,
 * then `npx -y @polderlabs/bizar-sdk` as a last resort.
 *
 * Exported for testing; `writeClaudeSettings` calls it via the local
 * `hook()` thin wrapper.
 */
export function resolveHookCommand(sub, timeoutMs = 15) {
  const wrapperPath = join(CLAUDE_HOOKS_DIR, 'bizar-hook-wrapper.sh');
  // Prefer the absolute wrapper path when the shim is installed and
  // executable. Claude Code's stripped PATH drops `bizar hook <sub>`
  // calls silently; the wrapper script lives in the hooks directory
  // and is copied + chmod'd by `syncConfigExtras` at install time.
  try {
    if (existsSync(wrapperPath)) {
      const st = statSync(wrapperPath);
      if (st.isFile() && (st.mode & 0o111) !== 0) {
        return { type: 'command', command: `${wrapperPath} ${sub}`, timeout: timeoutMs };
      }
    }
  } catch {
    /* fall through to sh -c fallback */
  }
  // Fallback: POSIX-portable PATH probe so the hook still works without
  // the wrapper script. Mirrors the inline command baked into
  // `config/claude/settings.json` so the two stay byte-equivalent.
  const shCmd = `sh -c 'BIZAR=""; for d in "$HOME/.npm-global/bin" "$HOME/.local/bin" "/usr/local/bin" "/usr/bin"; do [ -x "$d/bizar" ] && BIZAR="$d/bizar" && break; done; if [ -z "$BIZAR" ] && command -v bizar >/dev/null 2>&1; then BIZAR="$(command -v bizar)"; fi; if [ -z "$BIZAR" ]; then BIZAR="npx -y @polderlabs/bizar-sdk"; fi; exec $BIZAR hook ${sub}'`;
  return { type: 'command', command: shCmd, timeout: timeoutMs };
}

export function writeClaudeSettings({ dryRun = false, force = false } = {}) {
  const fp = join(CLAUDE_DIR, 'settings.json');
  const existing = readJsonSafe(fp, {}) || {};
  const existingEnv = existing.env || {};
  const shipped = readJsonSafe(join(REPO_ROOT, 'config', 'claude', 'settings.json'), {}) || {};
  // Bizar is provider-agnostic. We do NOT auto-inject a default gateway URL
  // or auth token into the user's `~/.claude/settings.json` — operators MUST
  // configure `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` via their
  // shell environment if they want a non-default gateway. If those env vars
  // are absent we omit the keys entirely and let Claude Code's session model
  // handle dispatch.

  // F-183 — when `forceCleanInstall` has wiped `~/.claude/settings.json`,
  // it stashes the prior env block into `process.env.BIZAR_SAVED_ENV`.
  // The stash is the **only** source of operator credentials that
  // survives a wipe — everything else on disk has been removed by the
  // time this function runs. We honor it preferentially for the env
  // keys in FORCE_CLEAN_PRESERVE_ENV_KEYS so `bizar install --force`
  // preserves gateway URLs / auth tokens without forcing operators to
  // re-export them in the shell.
  //
  // Precedence (preserved-env keys):
  //   savedEnv.X  >  process.env.X  >  existingEnv.X  >  default
  //
  // The stash is only consulted when it was actually set by
  // `forceCleanInstall` (non-empty JSON). For direct `force: true`
  // calls that bypass the wipe, we keep the legacy precedence so the
  // existing merge-settings contract is unchanged.
  let savedEnv = {};
  if (typeof process.env.BIZAR_SAVED_ENV === 'string') {
    try { savedEnv = JSON.parse(process.env.BIZAR_SAVED_ENV) || {}; } catch { /* corrupt stash */ }
  }
  const hasSavedEnv = Object.keys(savedEnv).length > 0;

  const pickEnv = (key) => {
    if (hasSavedEnv && typeof savedEnv[key] === 'string') return savedEnv[key];
    if (process.env[key]) return process.env[key];
    if (!force && typeof existingEnv[key] === 'string') return existingEnv[key];
    return undefined;
  };

  const savedBaseUrl = pickEnv('ANTHROPIC_BASE_URL');
  const existingBaseUrl = !force ? existingEnv.ANTHROPIC_BASE_URL : undefined;
  const operatorGatewayUrl = savedBaseUrl
    || process.env.ANTHROPIC_BASE_URL
    || existingBaseUrl;
  // Resolve hook commands via `resolveHookCommand`, which emits the
  // absolute-path wrapper invocation when the shim is executable and
  // falls back to the POSIX-portable `sh -c` PATH probe shipped by
  // `config/claude/settings.json` otherwise. See `resolveHookCommand`
  // for the full rationale.
  const hook = (name, timeout = 15) => resolveHookCommand(name, timeout);

  // The shipped settings template (`config/claude/settings.json`) is the
  // sole source of truth for the alias binding (`model`,
  // `modelOverrides`, `ANTHROPIC_DEFAULT_*_MODEL`). The provisioner
  // does NOT synthesize `ANTHROPIC_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`,
  // or any model-router-derived projection: the four aliases
  // (sonnet/haiku/opus/fable -> default/common/hard/fable) are the
  // operator contract.
  const bizarSettings = {
    ...shipped,
    $schema: shipped.$schema || 'https://json.schemastore.org/claude-code-settings.json',
    // Bizar must own the primary thread globally. A routing hook can add
    // context, but only the agent setting applies Mike's system prompt and
    // tool surface (including Workflow) to ordinary `claude` launches.
    agent: 'mike',
    mcpServers: {
      bizar: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@polderlabs/bizar-sdk', 'mcp'],
        env: { BIZAR_HOME: BIZAR_HOME() },
      },
      semble: { type: 'stdio', command: 'semble', args: ['mcp'] },
      'agent-browser': { type: 'stdio', command: 'agent-browser', args: ['mcp'] },
    },
  // The shipped template `config/claude/settings.json` always defines
    // `permissions` (it is part of the invariant surface required by the
    // F-176 "full permissions + advisory hooks" policy). We assign
    // directly so an accidental deletion in the template fails fast at
    // install time rather than silently re-introducing the pre-F-176
    // gated permission shape. If a future operator wants to relax the
    // ship-time default, they should edit the template itself rather
    // than reintroduce a fallback here.
    permissions: shipped.permissions,
    autoMode: shipped.autoMode || {
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
    attribution: shipped.attribution || { commit: '', pr: '' },
    worktree: shipped.worktree || {
      baseRef: 'head',
      cleanupPeriodDays: 7,
    },
    enableWorkflows: shipped.enableWorkflows !== undefined ? shipped.enableWorkflows : true,
    disableWorkflows: false,
    workflowSizeGuideline: shipped.workflowSizeGuideline || 'small',
    alwaysThinkingEnabled: shipped.alwaysThinkingEnabled !== undefined ? shipped.alwaysThinkingEnabled : true,
    autoDreamEnabled: shipped.autoDreamEnabled !== undefined ? shipped.autoDreamEnabled : true,
    showThinkingSummaries: shipped.showThinkingSummaries !== undefined ? shipped.showThinkingSummaries : true,
    env: {
      BIZAR_HOME: BIZAR_HOME(),
      ...(operatorGatewayUrl
        ? { ANTHROPIC_BASE_URL: operatorGatewayUrl }
        : {}),
      ...(pickEnv('ANTHROPIC_AUTH_TOKEN')
        ? { ANTHROPIC_AUTH_TOKEN: pickEnv('ANTHROPIC_AUTH_TOKEN') }
        : {}),
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:
        pickEnv('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')
        || shipped.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
        || '1',
      // OmniRoute alias binding: the four ANTHROPIC_DEFAULT_*_MODEL vars
      // ship in the template's top-level env. Forward them verbatim so
      // the operator contract (sonnet/haiku/opus/fable → default/common/hard/fable)
      // survives every write.
      ...(shipped.env?.ANTHROPIC_DEFAULT_SONNET_MODEL
        ? { ANTHROPIC_DEFAULT_SONNET_MODEL: shipped.env.ANTHROPIC_DEFAULT_SONNET_MODEL }
        : {}),
      ...(shipped.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL
        ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: shipped.env.ANTHROPIC_DEFAULT_HAIKU_MODEL }
        : {}),
      ...(shipped.env?.ANTHROPIC_DEFAULT_OPUS_MODEL
        ? { ANTHROPIC_DEFAULT_OPUS_MODEL: shipped.env.ANTHROPIC_DEFAULT_OPUS_MODEL }
        : {}),
      ...(shipped.env?.ANTHROPIC_DEFAULT_FABLE_MODEL
        ? { ANTHROPIC_DEFAULT_FABLE_MODEL: shipped.env.ANTHROPIC_DEFAULT_FABLE_MODEL }
        : {}),
    },
    hooks: {
      UserPromptSubmit: [{ hooks: [hook('user-prompt-submit', 10)] }],
      SessionStart: [{ hooks: [hook('session-start')] }],
      PreToolUse: [{ matcher: '*', hooks: [hook('pre-tool-use')] }],
      PermissionRequest: [{ matcher: '*', hooks: [hook('permission-request')] }],
      PostToolUse: [{ matcher: '*', hooks: [hook('post-tool-use')] }],
      PostToolUseFailure: [{ matcher: '*', hooks: [hook('post-tool-use-failure')] }],
      SubagentStart: [{ hooks: [hook('subagent-start')] }],
      SubagentStop: [{ hooks: [hook('subagent-stop')] }],
      TaskCreated: [{ hooks: [hook('task-created', 5)] }],
      TaskCompleted: [{ hooks: [hook('task-completed', 5)] }],
      TeammateIdle: [{ hooks: [hook('teammate-idle', 5)] }],
      PreCompact: [{ matcher: '*', hooks: [hook('pre-compact')] }],
      Stop: [{ hooks: [hook('stop')] }],
      SessionEnd: [{ hooks: [hook('session-end')] }],
    },
  };

  // The alias binding (`model`, `modelOverrides`, `ANTHROPIC_DEFAULT_*_MODEL`)
  // is owned entirely by the shipped template — the provisioner never
  // synthesizes `ANTHROPIC_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, or any
  // model-router projection.

  const merged = mergeSettings(existing, bizarSettings, {
    force,
    claudeHooksDir: CLAUDE_HOOKS_DIR,
  });

  if (dryRun) return { ok: true, message: `[dry-run] would write ${fp}` };
  ensureDir(CLAUDE_DIR);
  writeFileSync(fp, JSON.stringify(merged, null, 2) + '\n');
  // F-183 — clear the in-process stash once consumed so subsequent
  // writes in the same run (or in tests) don't accidentally inherit
  // operator credentials.
  if (typeof process.env.BIZAR_SAVED_ENV === 'string') {
    delete process.env.BIZAR_SAVED_ENV;
  }
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
  // Honour `dryRun` BEFORE checking for the `claude` CLI: a dry-run
  // should never fail just because the host does not have Claude Code
  // installed (CI runners, fresh dev containers, agent sandboxes).
  if (dryRun) return { ok: true, message: '[dry-run] would run: claude mcp add bizar -- npx -y @polderlabs/bizar-sdk mcp' };
  if (!haveCmd('claude')) return { ok: false, message: 'claude CLI not on PATH' };
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
    bizarHome: { exists: existsSync(BIZAR_HOME()), path: BIZAR_HOME() },
    gitRepo: existsSync(join(REPO_ROOT, '.git')),
  };
}

export function detectStateJson() {
  return JSON.stringify(detectState(), null, 2);
}

/** Ensure Bizar installs its default durable planning runtime. */
export async function ensureOpenKanRuntime({
  dryRun = false,
  install = installOpenKanPromise,
  home,
  packageSpec,
  force = false,
} = {}) {
  const installHome = resolveOpenKanHome({ home, cwd: process.cwd() });
  try {
    const launcher = resolveOpenKanOk(home ? { home: installHome } : {});
    verifyOpenKanRuntime({ okBin: launcher });
    const agent = installOpenKanAgent({ home: installHome, cwd: process.cwd(), force });
    if (!agent.ok) return { ok: false, home: installHome, launcher, message: agent.message };
    const commands = installOpenKanCommandShims({ home: installHome });
    if (!commands.ok) return { ok: false, home: installHome, launcher, agent, commands, message: commands.message };
    return {
      ok: true,
      installed: false,
      home: installHome,
      launcher,
      agent,
      commands,
      message: `OpenKan ready (${launcher}); native commands available via ok/openkan`,
    };
  } catch (error) {
    if (process.env.BIZAR_SKIP_OPENKAN_INSTALL === '1') {
      return { ok: false, skipped: true, message: `OpenKan unavailable and installation skipped: ${error.message}` };
    }
    if (dryRun) {
      return { ok: true, installed: false, home: installHome, message: `[dry-run] would install OpenKan natively via npm (${packageSpec || '@polderlabs/openkan@latest'}) under ${installHome}` };
    }
    try {
      const result = await install({ home: installHome, packageSpec, force, persistConfig: true });
      const launcher = result.launcher || resolveOpenKanOk({ home: installHome });
      return {
        ok: true,
        installed: true,
        home: installHome,
        version: result.version,
        agent: result.agent,
        launcher,
        message: result.message || `OpenKan installed (${launcher})`,
      };
    } catch (installError) {
      return { ok: false, message: `OpenKan installation failed: ${installError.message || String(installError)}` };
    }
  }
}

// ─── Top-level orchestration ─────────────────────────────────────────────────

/**
 * The unified provision flow. `mode` is 'install' or 'update'.
 * Every step is idempotent.
 *
 * `installClaudeCli` (F-7, default OFF): gates the native Claude Code
 * install. The installer MUST NOT auto-install Claude Code by default;
 * the wizard user must opt in (page 4 confirm) or the operator must
 * pass `--install-claude-cli`. `install.sh --non-interactive` and
 * `bizar install --yes` therefore default to OFF. The orchestrator
 * (`cli/install/index.mjs`) and the CLI parser
 * (`cli/commands/install.mjs`) thread `installClaudeCli: true` from
 * the wizard opt-in or from the flag; commit 7 wires that up.
 *
 * NOTE: we read `opts.installClaudeCli` directly (rather than
 * destructuring it) so the option name does NOT shadow the module-
 * level `installClaudeCli` function referenced on the next line.
 */
export async function runProvision(opts = {}) {
  const {
    mode = 'install',
    dryRun = false,
    force = false,
    openkanHome,
    openkanPackageSpec,
    initializeOpenKanProject = false,
  } = opts;
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
  // F-7 — opt-in gate. Default OFF: `installClaudeCli` is false unless
  // the caller explicitly passes `true`. The wizard opt-in and the
  // `--install-claude-cli` CLI flag both flow through `installClaudeCli:
  // true` from their respective layers (see commit 7).
  if (opts.installClaudeCli) installClaudeCli({ force, dryRun });

  const stepResults = [];
  const runStep = async (label, fn) => {
    section(label);
    const r = await fn();
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.message}`);
    stepResults.push({ label, ...r });
    return r;
  };

  const openKanStep = await runStep('Ensuring OpenKan planning runtime', () => ensureOpenKanRuntime({
    dryRun,
    home: openkanHome,
    packageSpec: openkanPackageSpec,
    force,
  }));
  if (initializeOpenKanProject && openKanStep.ok) {
    await runStep('Initialising OpenKan project workspace', () => {
      if (dryRun) return { ok: true, message: '[dry-run] would initialise .ok/ in the current project' };
      try {
        const result = ensureOpenKanProject({ home: openKanStep.home });
        return { ok: true, message: result.stdout.trim() || '.ok/ is ready' };
      } catch (error) {
        return { ok: false, message: error.message || String(error) };
      }
    });
  }
  await runStep('Syncing skills',    () => syncSkillFiles({ dryRun, force }));
  await runStep('Syncing commands',   () => syncCommandFiles({ dryRun, force }));
  await runStep('Syncing rules',      () => syncRulesFiles({ dryRun, force }));
  await runStep('Syncing hooks',      () => syncHookFiles({ dryRun, force }));
  await runStep('Syncing agents',     () => syncAgentFiles({ dryRun, force }));
  await runStep('Syncing workflows',  () => syncConfigExtras({ dryRun }));
  await runStep('Installing git hooks', () => installGitHooks({ dryRun }));
  await runStep('Building SDK',       () => buildSdk({ dryRun }));

  section('Writing settings.json');
  const settingsStep = writeClaudeSettings({ dryRun, force });
  if (settingsStep.ok) logOk(settingsStep.message); else logErr(settingsStep.message);
  stepResults.push({ label: 'settings.json', ...settingsStep });

  section('MCP server (bizar)');
  const mcpStep = setupMcpServer({ dryRun });
  if (mcpStep.ok) logOk(mcpStep.message); else logWarn(mcpStep.message);
  stepResults.push({ label: 'mcp-server', ...mcpStep });

  section('Writing install marker');
  if (!dryRun) {
    const markerStep = writeInstallMarker({ repoPath: REPO_ROOT });
    if (markerStep.ok) logOk(markerStep.message || `installed.json → ${BIZAR_HOME()}/installed.json`);
    else logErr(markerStep.error || 'install marker write failed');
    stepResults.push({ label: 'install-marker', ...markerStep });
  } else {
    stepResults.push({ label: 'install-marker', ok: true, message: `[dry-run] would write ${BIZAR_HOME()}/installed.json` });
  }

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
  console.log(chalk.dim('  Default model: sonnet → ANTHROPIC_DEFAULT_SONNET_MODEL=default (haiku→common, opus→hard, fable→fable).'));
  console.log(chalk.dim('  Provider routing is owned by OmniRoute; Bizar does not synthesize ANTHROPIC_MODEL or gateway IDs.'));
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
 * Sync auxiliary commands + skills + hooks + rules + native workflows into
 * CLAUDE_DIR. The dedicated sync steps still own the primary command, skill,
 * hook, and agent mirrors; this function guarantees user-level workflow files.
 */
export async function syncConfigExtras({ dryRun = false } = {}) {
  if (dryRun) return { ok: true, message: '[dry-run] would sync auxiliary commands + skills + hooks + rules + native workflows', counts: { skills: 0, commands: 0, hooks: 0, rules: 0, workflows: 0 } };

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
  const commandsSrc = join(REPO_ROOT, 'config', 'claude', 'commands');
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
  const hooksSrc = join(REPO_ROOT, 'config', 'claude', 'hooks');
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
    validateNativeWorkflowDirectory(workflowsSrc);
    await copyDirIfExists(workflowsSrc, workflowsDst);
    counts.workflows = validateNativeWorkflowDirectory(workflowsDst).count;
  }

  return { ok: true, message: `synced (${counts.commands} commands, ${counts.skills} skills, ${counts.hooks} hooks, ${counts.rules} rules, ${counts.workflows} workflows)`, counts };
}

// ─── F-183 — fully clean install ────────────────────────────────────────────

/**
 * Env keys whose values the freshly-emitted `~/.claude/settings.json`
 * must inherit from a previously-installed copy of the file. Operators
 * run `bizar install --force` to repair drifted settings; this set is
 * the contract that keeps gateway credentials + provider URLs alive
 * across the wipe.
 *
 * Anything outside this set is **not** preserved — the re-emitted
 * `permissions` block must mirror the current template so the F-181
 * wildcard expansion and F-176 empty deny/ask lists land on disk.
 */
export const FORCE_CLEAN_PRESERVE_ENV_KEYS = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'BIZAR_HOME',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
]);

/**
 * Resolve `~/.agents/` (the shared skills-registry directory).
 * Honors `process.env.AGENTS_DIR` so tests and operators can override
 * it without bouncing HOME.
 */
export function resolveAgentsDir() {
  if (process.env.AGENTS_DIR && process.env.AGENTS_DIR.trim()) {
    return process.env.AGENTS_DIR.trim();
  }
  return join(HOME, '.agents');
}

/** `~/.agents/` — shared skills-registry directory. Re-evaluated per read so
 * tests that flip `process.env.AGENTS_DIR` are honored. */
export function AGENTS_DIR() {
  return resolveAgentsDir();
}

/**
 * Bizar-managed subdirectories of `~/.claude/`. Anything outside this
 * set under `~/.claude/` is treated as user-owned and is preserved
 * by `forceCleanInstall` (e.g. `.credentials.json`, `statsig/`,
 * `.playwright-mcp/`).
 */
const FORCE_CLEAN_WIPE_DIRS = Object.freeze([
  'agents',
  'skills',
  'commands',
  'hooks',
  'rules',
  'workflows',
  'plugins',
]);

/**
 * F-183 — wipe every Bizar-managed directory under `~/.claude/` plus
 * `~/.agents/`, back up `~/.claude/settings.json` env vars into
 * `process.env.BIZAR_SAVED_ENV`, and return a structured wipe report.
 *
 * The wipe is **idempotent** at the file-system level (rmSync is
 * recursive+force), and the resulting state is fully reproducible by
 * the subsequent `runProvision` call because the factory re-emits the
 * entire settings file from the shipped template (so the F-181
 * wildcard expansion in `permissions.allow` lands automatically).
 *
 * What is **not** wiped:
 *   - `~/.config/bizar/` (BIZAR_HOME) — login state, telemetry,
 *     worktree-queue, model picks, installed.json marker. Operators
 *     rely on this surviving a forced reinstall.
 *   - `~/.claude/.credentials.json`, `~/.claude/statsig/`,
 *     `~/.claude/.playwright-mcp/` — third-party state managed by
 *     Claude Code itself.
 *   - Any subdirectory of `~/.claude/` not in FORCE_CLEAN_WIPE_DIRS.
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ ok: true, message: string, wiped: string[], preserved: string[], env: Record<string, string> }}
 */
export function forceCleanInstall(opts = {}) {
  const { dryRun = false } = opts;
  const claudeDir = resolveClaudeDir();
  const agentsDir = resolveAgentsDir();
  const settingsPath = join(claudeDir, 'settings.json');

  // 1. Stash existing env vars so `writeClaudeSettings` can re-inject
  //    them when the freshly-emitted file lands. Use a string env so
  //    we don't pollute the parent process object graph with arbitrary
  //    operator-defined keys.
  let savedEnv = {};
  if (existsSync(settingsPath)) {
    try {
      const cur = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (cur && typeof cur === 'object' && cur.env && typeof cur.env === 'object') {
        for (const key of FORCE_CLEAN_PRESERVE_ENV_KEYS) {
          if (typeof cur.env[key] === 'string') savedEnv[key] = cur.env[key];
        }
      }
    } catch { /* corrupt settings — treat as no env */ }
  }
  // Also pick up env values from the live process so a freshly-invoked
  // `bizar install --force` carries operator credentials through the
  // wipe even if the on-disk settings file is missing/stale.
  for (const key of FORCE_CLEAN_PRESERVE_ENV_KEYS) {
    if (!savedEnv[key] && process.env[key]) savedEnv[key] = process.env[key];
  }
  process.env.BIZAR_SAVED_ENV = JSON.stringify(savedEnv);

  // 2. Wipe managed dirs.
  const wiped = [];
  for (const sub of FORCE_CLEAN_WIPE_DIRS) {
    const dir = join(claudeDir, sub);
    if (!existsSync(dir)) continue;
    wiped.push(dir);
    if (!dryRun) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  if (existsSync(agentsDir)) {
    wiped.push(agentsDir);
    if (!dryRun) {
      try { rmSync(agentsDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  // 3. Wipe settings.json so writeClaudeSettings re-emits from the
  //    shipped template. Operators keep their gateway / auth env vars
  //    via the BIZAR_SAVED_ENV stash.
  if (existsSync(settingsPath)) {
    wiped.push(settingsPath);
    if (!dryRun) {
      try { rmSync(settingsPath, { force: true }); } catch { /* ignore */ }
    }
  }

  const preserved = [];
  if (existsSync(BIZAR_HOME())) preserved.push(BIZAR_HOME());
  // F-194: typed EvidenceBundle ledger under BIZAR_HOME. Re-emitting
  // 0o700 per `ensureBizarHome` keeps its permissions correct on every
  // wipe, but the per-run JSONL + signatures.bundle MUST survive.
  const evidenceDir = join(BIZAR_HOME(), 'evidence');
  if (existsSync(evidenceDir)) preserved.push(evidenceDir);
  // F-194 B.3: structural-fingerprint learning ledger
  // (instincts.jsonl + reject-feedback.jsonl + behavior.jsonl).
  const learningDir = join(BIZAR_HOME(), 'learning');
  if (existsSync(learningDir)) preserved.push(learningDir);
  // Document the third-party state we intentionally left alone.
  for (const sub of ['.credentials.json', 'statsig', '.playwright-mcp']) {
    const p = join(claudeDir, sub);
    if (existsSync(p)) preserved.push(p);
  }

  const tag = dryRun ? '[dry-run] ' : '';
  const message = `${tag}F-183 clean: wiped ${wiped.length} paths; preserved ${preserved.length} paths (BIZAR_HOME + evidence + learning + third-party state)`;
  return { ok: true, message, wiped, preserved, env: savedEnv };
}

/**
 * Inverse of `forceCleanInstall` — clears the in-process stash once
 * `writeClaudeSettings` has consumed it. Idempotent and side-effect
 * free; exported so tests can run multiple forced installs without
 * leaking stale stashes between scenarios.
 */
export function clearSavedEnv() {
  delete process.env.BIZAR_SAVED_ENV;
}

// ─── CLI entry ──────────────────────────────────────────────────────────────

export function parseFlags(argv) {
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
    else if (a === '--force' || a === '--deep') opts.force = true;
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

// Back-compat alias — `bizar update` historically called `runUpdate(args)`;
// install + update now share `runProvision({ mode: 'update', ... })`.
// `runUpdate` is retained as an importable export for external SDK
// consumers (re-exported from `cli/update.mjs`); `cli/commands/install.mjs`
// no longer imports it — its `update()` command routes through `parseFlags`
// → `runInstaller({ mode: 'update', ... })` instead.
export const runUpdate = (subargs, opts = {}) =>
  runProvision({ ...opts, mode: 'update', subargs });
