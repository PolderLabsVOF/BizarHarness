#!/usr/bin/env node
/**
 * cli/provision-claude.mjs
 *
 * v6.3.0 — Claude Code-native installer + updater.
 *
 * Replaces `cli/provision.mjs` (the Cline-era provisioner). The install
 * / update flow for Claude Code is different from Cline:
 *
 *   - Config root is `~/.claude/` (NOT `~/.cline/`).
 *   - The configuration file is `~/.claude/settings.json` (NOT
 *     `~/.cline/cline.json`).
 *   - MCP servers are registered via `claude mcp add` (NOT by
 *     patching a `plugin[]` array).
 *   - Plugins are managed via `claude plugin install ...` (NOT
 *     copied into `~/.cline/plugins/bizar/`).
 *   - Skills live under `~/.claude/skills/<name>/SKILL.md`.
 *   - Commands live under `~/.claude/commands/<name>.md`.
 *   - Rules live under `~/.claude/rules/<name>.md`.
 *   - Hooks are wired into `~/.claude/settings.json` (NOT installed
 *     as executable files in `~/.cline/hooks/`).
 *   - `~/.claude/CLAUDE.md` mirrors the repo's `AGENTS.md`.
 *
 * Public API:
 *   runProvision({ mode, dryRun, force, yes, restart, ... })
 *     Runs the full provision flow for `mode` ('install' | 'update').
 *   detectState()
 *     Probe what's installed without modifying anything.
 *     Returns a structured state object.
 *
 * Both modes are idempotent and safe to re-run.
 *
 * Flags (parsed by the CLI shim at the bottom):
 *   --mode=install|update|install-only-system
 *   --dry-run            Print actions, make no changes.
 *   --force              Overwrite existing files.
 *   --yes / -y           Same as --force.
 *   --non-interactive    Same as --yes.
 */

import chalk from 'chalk';
import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
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

// Repo root = `<pkg>/cli/provision-claude.mjs` → one level up.
// This works for source checkouts AND global npm installs.
export const REPO_ROOT = resolve(__dirname, '..');

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Resolve the Claude Code config directory.
 *
 * Resolution order (matches Claude Code's own resolver, see
 * https://code.claude.com/docs/en/cli-reference):
 *   1. `process.env.CLAUDE_CONFIG_DIR` (explicit override)
 *   2. `$HOME/.claude` (default)
 *   3. (Windows only) `%APPDATA%\Claude`
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

/** `~/.bizar_home/` — Bizar-specific runtime state (NOT under ~/.claude/). */
export const BIZAR_HOME = process.env.BIZAR_HOME
  || join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'bizar');

// Standard Claude Code subdirectories (v6.3.0 — Claude Code layout)
export const CLAUDE_AGENTS_DIR = join(CLAUDE_DIR, 'agents');
export const CLAUDE_SKILLS_DIR = join(CLAUDE_DIR, 'skills');
export const CLAUDE_COMMANDS_DIR = join(CLAUDE_DIR, 'commands');
export const CLAUDE_HOOKS_DIR = join(CLAUDE_DIR, 'hooks');
export const CLAUDE_RULES_DIR = join(CLAUDE_DIR, 'rules');
export const CLAUDE_PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');

// Service / dashboard pid files
const SERVICE_PID_FILE = join(BIZAR_HOME, 'service.pid');
const DASHBOARD_PID_FILE = join(BIZAR_HOME, 'dashboard.pid');
const DASHBOARD_PORT_FILE = join(BIZAR_HOME, 'dashboard.port');

// ─── Tiny utilities ──────────────────────────────────────────────────────────

function haveCmd(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the SDK workspace so its compiled JS output lives at
 * `<pkg>/packages/sdk/dist/`. The dashboard imports the SDK memory
 * module from `dist/memory/index.js`, not from `src/memory/index.js`,
 * so without this build step the npm-installed package ships a TS
 * source tree that the dashboard cannot run.
 *
 * v7.0.1 — `install.sh` + `bizar update` previously skipped this step
 * entirely. Symptom: `bizar dash start` crashes with
 * `Cannot find module .../packages/sdk/dist/memory/index.js`
 * (or .../src/memory/index.js for older import paths). Root cause: the
 * SDK's `package.json` advertises `./dist/*` exports, but the SDK's
 * `tsconfig.json` is never compiled by the installer.
 *
 * Bun resolution: when bun is invoked from a globally npm-installed
 * package, its lifecycle script runs with a minimal PATH that does
 * NOT include `~/.bun/bin`. So `bun run build:sdk` (which shells out to
 * `tsc` via bun's bin shim) fails with `tsc: command not found`. To
 * dodge that, we resolve bun to its absolute path
 * (`$HOME/.bun/bin/bun`) and prepend that dir to the child process
 * PATH so bun's tsc shim is visible.
 *
 * Idempotent: skips when `dist/memory/index.js` already exists.
 * Non-fatal: returns `{ ok: false, message }` rather than throwing —
 * the rest of the provision flow should still complete (some operators
 * run a separate build pipeline, e.g. a CI step).
 */
export async function buildSdk({ dryRun = false } = {}) {
  const sdkRoot = join(REPO_ROOT, 'packages', 'sdk');
  const srcEntry = join(sdkRoot, 'src', 'memory', 'index.ts');
  const distEntry = join(sdkRoot, 'dist', 'memory', 'index.js');

  if (!existsSync(srcEntry)) {
    // No SDK TS source — this is a stripped install or an unusual layout.
    // Don't fail the whole provision over it; just report.
    return { ok: true, skipped: true, message: `SDK src not found at ${srcEntry} — skipping build (likely a non-bundled install)` };
  }

  if (existsSync(distEntry)) {
    return { ok: true, skipped: true, message: `SDK dist already present — skipping build (delete ${join(sdkRoot, 'dist')} to force)` };
  }

  if (dryRun) {
    return { ok: true, skipped: false, message: `would build SDK at ${sdkRoot}` };
  }

  // Resolve bun to an absolute path. `command -v bun` finds whatever is
  // on PATH, but bun's bin dir (typically `~/.bun/bin`) is NOT always on
  // PATH — especially when invoked from a globally npm-installed package
  // whose lifecycle scripts run with a minimal env. Without the absolute
  // path, `bun run build:sdk` shells out to `tsc`, finds no shim on PATH,
  // and fails with `tsc: command not found`.
  //
  // Bun's bin dir contains only `bun` and `bunx` — NOT `tsc`. So even
  // when bun runs `build:sdk` (which executes the `tsc` line from
  // package.json), the child shell still needs `tsc` on PATH. The npm
  // global bin dir (where `npm install -g typescript` lands the shim) is
  // the typical source — resolve it via `npm root -g`'s parent and
  // prepend both bun's bin and the npm global bin to the child PATH.
  const bunFromHome = join(process.env.HOME || '', '.bun', 'bin', 'bun');
  let cmd, args, childEnv;
  if (existsSync(bunFromHome)) {
    cmd = bunFromHome;
    args = ['run', 'build:sdk'];
    const pathDelim = process.platform === 'win32' ? ';' : ':';
    const bunBin = dirname(bunFromHome);
    let npmGlobalBin = '';
    try {
      const npmRootG = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      // npm root -g returns .../lib/node_modules — parent is .../lib, and
      // the bin dir lives at .../bin. So walk up one and over.
      npmGlobalBin = join(dirname(npmRootG), '..', 'bin');
    } catch {
      // npm not on PATH — fall back to the standard location.
      npmGlobalBin = process.platform === 'win32'
        ? join(process.env.APPDATA || '', 'npm')
        : join(process.env.HOME || '', '.local', 'bin');
    }
    const pathParts = [bunBin];
    if (npmGlobalBin && existsSync(npmGlobalBin)) pathParts.push(npmGlobalBin);
    pathParts.push(process.env.PATH || '');
    childEnv = { ...process.env, PATH: pathParts.join(pathDelim) };
  } else if (haveCmd('bun')) {
    cmd = 'bun';
    args = ['run', 'build:sdk'];
    childEnv = process.env;
  } else {
    // Fallback: npx tsc. Requires a network round-trip on first use but
    // works on systems without bun installed (CI, minimal containers).
    cmd = 'npx';
    args = ['--yes', 'tsc', '-p', 'packages/sdk/tsconfig.json'];
    childEnv = process.env;
  }

  try {
    logInfo(`building SDK with \`${cmd} ${args.join(' ')}\` (REPO_ROOT=${REPO_ROOT})`);
    execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe', timeout: 180_000, env: childEnv });
    if (existsSync(distEntry)) {
      return { ok: true, skipped: false, message: 'SDK built (dist/memory/index.js present)' };
    }
    return { ok: false, message: `build completed but ${distEntry} still missing — check tsconfig outDir` };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().split('\n').slice(0, 5).join(' | ') : '(no stderr)';
    return { ok: false, message: `SDK build failed: ${stderr}` };
  }
}

/**
 * Build the Bizar plugin shim (`plugins/bizar/`) so the loader can find
 * `plugins/bizar/dist/index.js` at runtime. Same root cause as `buildSdk()`:
 * the npm-installed package ships `plugins/bizar/index.ts` (TS source) but
 * nothing at `dist/`. Without this build step, `bizar dash start` reports
 * `Plugin source not found at .../plugins/bizar` from `cli/install.mjs:installPluginBizar`
 * (which is misleading — the dir exists, just the compiled entry doesn't).
 *
 * v8.0.2 — same bun/npx/tsc strategy as `buildSdk()`. We compile the
 * single TS entry `plugins/bizar/index.ts` to `plugins/bizar/dist/index.js`
 * via the existing `plugins/bizar/tsconfig.json`.
 *
 * Idempotent: skips when `plugins/bizar/dist/index.js` already exists.
 * Non-fatal: returns `{ ok: false, message }` rather than throwing.
 */
export async function buildPlugin({ dryRun = false } = {}) {
  const pluginRoot = join(REPO_ROOT, 'plugins', 'bizar');
  const srcEntry = join(pluginRoot, 'index.ts');
  const distEntry = join(pluginRoot, 'dist', 'index.js');

  if (!existsSync(srcEntry)) {
    return { ok: true, skipped: true, message: `Plugin src not found at ${srcEntry} — skipping build` };
  }

  if (existsSync(distEntry)) {
    return { ok: true, skipped: true, message: `Plugin dist already present — skipping build (delete ${join(pluginRoot, 'dist')} to force)` };
  }

  if (dryRun) {
    return { ok: true, skipped: false, message: `would build plugin at ${pluginRoot}` };
  }

  // Same PATH-resolution dance as buildSdk(): npm-global scripts may have
  // a stripped PATH that doesn't include ~/.bun/bin or the npm bin dir,
  // so bun's tsc shim isn't visible to the child shell.
  const bunFromHome = join(process.env.HOME || '', '.bun', 'bin', 'bun');
  let cmd, args, childEnv;
  if (existsSync(bunFromHome)) {
    cmd = bunFromHome;
    args = ['x', 'tsc', '-p', 'plugins/bizar/tsconfig.json'];
    const pathDelim = process.platform === 'win32' ? ';' : ':';
    const bunBin = dirname(bunFromHome);
    let npmGlobalBin = '';
    try {
      const npmRootG = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      npmGlobalBin = join(dirname(npmRootG), '..', 'bin');
    } catch {
      npmGlobalBin = process.platform === 'win32'
        ? join(process.env.APPDATA || '', 'npm')
        : join(process.env.HOME || '', '.local', 'bin');
    }
    const pathParts = [bunBin];
    if (npmGlobalBin && existsSync(npmGlobalBin)) pathParts.push(npmGlobalBin);
    pathParts.push(process.env.PATH || '');
    childEnv = { ...process.env, PATH: pathParts.join(pathDelim) };
  } else if (haveCmd('bun')) {
    cmd = 'bun';
    args = ['x', 'tsc', '-p', 'plugins/bizar/tsconfig.json'];
    childEnv = process.env;
  } else {
    cmd = 'npx';
    args = ['--yes', 'tsc', '-p', 'plugins/bizar/tsconfig.json'];
    childEnv = process.env;
  }

  try {
    logInfo(`building plugin with \`${cmd} ${args.join(' ')}\` (REPO_ROOT=${REPO_ROOT})`);
    execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe', timeout: 180_000, env: childEnv });
    if (existsSync(distEntry)) {
      return { ok: true, skipped: false, message: 'Plugin built (dist/index.js present)' };
    }
    return { ok: false, message: `build completed but ${distEntry} still missing — check tsconfig outDir` };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().split('\n').slice(0, 5).join(' | ') : '(no stderr)';
    return { ok: false, message: `Plugin build failed: ${stderr}` };
  }
}

/**
 * Build the dashboard SPA (Vite production bundle) so the Node server
 * in `bizar-dash/src/server/server.mjs` can serve the React UI from
 * `bizar-dash/dist/index.html` + `dist/assets/*`. Without this step,
 * npm installs that don't ship a pre-built `dist/` (the published
 * tarball excludes it because it is `.gitignore`'d) leave the
 * dashboard serving 404s for every asset, and the page renders blank
 * with errors like `can't access property 'useState', et is undefined`.
 *
 * v7.0.3 — `install.sh` + `bizar update` previously skipped the
 * dashboard build entirely. Symptom: a fresh `bizar install` /
 * `bizar update` overwrote the package's pre-existing `dist/` (if
 * any) and the dashboard's first request returned a 404 for the
 * bundle, followed by the React error above in the browser console.
 *
 * Same bun / npx resolution strategy as `buildSdk()`. The vite config
 * reads the same `tsconfig.json` for type info, but the heavy lifting
 * is `vite build` itself which uses esbuild internally, so no tsc
 * dependency here.
 *
 * Idempotent: skips when `bizar-dash/dist/index.html` already exists.
 * Non-fatal: returns `{ ok: false, message }` rather than throwing —
 * the rest of the provision flow should still complete.
 */
export async function buildDash({ dryRun = false } = {}) {
  const dashDir = join(REPO_ROOT, 'bizar-dash');
  const distIndex = join(dashDir, 'dist', 'index.html');

  if (!existsSync(join(dashDir, 'src', 'web', 'index.html'))) {
    return { ok: true, skipped: true, message: `Dashboard src not found at ${join(dashDir, 'src', 'web', 'index.html')} — skipping build` };
  }

  if (existsSync(distIndex)) {
    return { ok: true, skipped: true, message: `Dashboard dist already present — skipping build (delete ${join(dashDir, 'dist')} to force)` };
  }

  if (dryRun) {
    return { ok: true, skipped: false, message: `would build dashboard at ${dashDir}` };
  }

  const bunFromHome = join(process.env.HOME || '', '.bun', 'bin', 'bun');
  let cmd, args, childEnv;
  if (existsSync(bunFromHome)) {
    cmd = bunFromHome;
    args = ['run', 'build:dash'];
    const pathDelim = process.platform === 'win32' ? ';' : ':';
    const bunBin = dirname(bunFromHome);
    const pathParts = [bunBin, process.env.PATH || ''];
    childEnv = { ...process.env, PATH: pathParts.join(pathDelim) };
  } else if (haveCmd('bun')) {
    cmd = 'bun';
    args = ['run', 'build:dash'];
    childEnv = process.env;
  } else {
    cmd = 'npx';
    args = ['--yes', 'vite', 'build'];
    childEnv = process.env;
  }

  try {
    logInfo(`building dashboard with \`${cmd} ${args.join(' ')}\` (REPO_ROOT=${REPO_ROOT})`);
    // `vite build` writes to the configured outDir (../../dist from
    // src/web/). On a non-bun shell the cwd must be REPO_ROOT because
    // the configured `root` is relative. Bun handles this either way.
    execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe', timeout: 240_000, env: childEnv });
    if (existsSync(distIndex)) {
      return { ok: true, skipped: false, message: 'Dashboard built (dist/index.html present)' };
    }
    return { ok: false, message: `build completed but ${distIndex} still missing — check vite.config.ts outDir` };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().split('\n').slice(0, 5).join(' | ') : '(no stderr)';
    return { ok: false, message: `Dashboard build failed: ${stderr}` };
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

function logOk(msg)   { console.log(chalk.green('  ✓') + ' ' + msg); }
function logInfo(msg) { console.log(chalk.cyan('  →') + ' ' + msg); }
function logWarn(msg) { console.log(chalk.yellow('  ⚠') + ' ' + msg); }
function logErr(msg)  { console.log(chalk.red('  ✗') + ' ' + msg); }
function section(title) { console.log('\n' + chalk.bold.cyan(`── ${title} ──`)); }

// ─── Bizar HOME bootstrap ────────────────────────────────────────────────────

/**
 * Ensure `~/.bizar_home/` (or `$BIZAR_HOME`) exists with the runtime
 * subdirectories Bizar needs (memory vault, loops dir, dashboard port
 * file). Idempotent.
 */
export function ensureBizarHome({ dryRun = false } = {}) {
  if (dryRun) {
    return { ok: true, message: `[dry-run] would ensure ${BIZAR_HOME}` };
  }
  mkdirSync(BIZAR_HOME, { recursive: true });
  mkdirSync(join(BIZAR_HOME, 'memory-vault'), { recursive: true });
  mkdirSync(join(BIZAR_HOME, 'loops'), { recursive: true });
  // Touch the dashboard port file so downstream readers can probe it.
  if (!existsSync(DASHBOARD_PORT_FILE)) {
    writeFileSync(DASHBOARD_PORT_FILE, '4321\n');
  }
  return { ok: true, message: `${BIZAR_HOME} ready`, path: BIZAR_HOME };
}

// ─── Toolchain ───────────────────────────────────────────────────────────────

function checkToolchain() {
  section('Toolchain');
  if (haveCmd('node')) logOk(`node ${execSync('node --version').toString().trim()}`);
  else { logErr('node not on PATH — install Node.js 18+ from https://nodejs.org'); process.exit(1); }

  if (haveCmd('npm')) logOk(`npm ${execSync('npm --version').toString().trim()}`);
  else logWarn('npm not on PATH — Claude Code install will need npm');

  if (haveCmd('git')) logOk(`git ${execSync('git --version').toString().trim().split(' ')[2]}`);
  else logWarn('git not on PATH — optional for many tasks');

  if (haveCmd('claude')) logOk(`claude ${execSync('claude --version').toString().trim().split('\n')[0]}`);
  else logWarn('claude not on PATH — will install via npm');

  if (haveCmd('agent-browser')) logOk(`agent-browser ${execSync('agent-browser --version').toString().trim()}`);
  else logInfo('agent-browser not installed (optional; npm install -g agent-browser)');
}

/** Install Claude Code CLI + SDK globally via npm. Idempotent. */
function installClaudeCli({ force = false, dryRun = false } = {}) {
  if (haveCmd('claude') && !force) return;
  section('Installing Claude Code CLI');
  logInfo('npm install -g @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code');
  if (dryRun) return;
  try {
    execSync(
      'npm install -g @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code',
      { stdio: 'inherit' },
    );
    logOk('Claude Code CLI installed');
  } catch (err) {
    logErr(`npm install failed: ${err.message}`);
    logWarn('retry manually: npm install -g @anthropic-ai/claude-code');
  }
}

// ─── File sync helpers ──────────────────────────────────────────────────────

/**
 * Mirror a source directory into a destination directory, copying
 * files and preserving subdirectory structure. Skips dotfiles by default.
 */
function syncDir(srcDir, destDir, opts = {}) {
  if (!existsSync(srcDir)) return { copied: 0, skipped: 0 };
  ensureDir(destDir);
  let copied = 0;
  let skipped = 0;
  for (const name of readdirSync(srcDir)) {
    if (name.startsWith('.')) continue;
    const sp = join(srcDir, name);
    const dp = join(destDir, name);
    const st = statSync(sp);
    if (opts.filter && !opts.filter(name, sp)) { skipped++; continue; }
    if (st.isDirectory()) {
      const r = syncDir(sp, dp, opts);
      copied += r.copied;
      skipped += r.skipped;
    } else {
      copyFileSync(sp, dp);
      copied++;
    }
  }
  return { copied, skipped };
}

/**
 * Copy `config/agents/*.md` → `~/.claude/agents/*.md`.
 *
 * v6.3.0 — Agent files use Claude Code frontmatter (name / description
 * / tools / model at the top). The source files in `config/agents/`
 * have already been migrated by a parallel task; this helper is a
 * straight copy with no YAML regeneration (Claude Code reads `.md`
 * directly — no `.yaml` shadow needed).
 */
export async function syncAgentFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'agents');
  const dest = CLAUDE_AGENTS_DIR;
  if (!existsSync(src)) {
    return { ok: true, message: `no agents source at ${src}`, copied: 0, skipped: 0 };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  }
  ensureDir(dest);
  ensureDir(join(dest, '_shared'));
  // Top-level .md files
  let { copied, skipped } = syncDir(src, dest, { filter: (n) => n.endsWith('.md') });
  // _shared/ — always overwrite (it's tiny + ships agent defaults).
  const sharedSrc = join(src, '_shared');
  if (existsSync(sharedSrc)) {
    for (const entry of readdirSync(sharedSrc, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      copyFileSync(join(sharedSrc, entry.name), join(dest, '_shared', entry.name));
      copied++;
    }
  }
  return { ok: true, message: `${copied} agent(s) synced (${skipped} kept)`, copied, skipped };
}

/**
 * Copy `config/skills/<name>/` → `~/.claude/skills/<name>/`.
 *
 * Each skill is mirrored as its own subdirectory under
 * `~/.claude/skills/<name>/`. Honors `force` to overwrite.
 */
export async function syncSkillFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'skills');
  const dest = CLAUDE_SKILLS_DIR;
  if (!existsSync(src)) {
    return { ok: true, message: `no skills source at ${src}`, copied: 0, skipped: 0 };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  }
  ensureDir(dest);
  copyDirContents(src, dest);

  // Mirror AGENT_BASELINE.md → ~/.claude/skills/agent-baseline/SKILL.md
  // (the Claude Code skill loader resolves the `name: agent-baseline`
  // reference via this path).
  const sharedBaseline = join(REPO_ROOT, 'config', 'agents', '_shared', 'AGENT_BASELINE.md');
  if (existsSync(sharedBaseline)) {
    const baselineDir = join(dest, 'agent-baseline');
    ensureDir(baselineDir);
    copyFileSync(sharedBaseline, join(baselineDir, 'SKILL.md'));
  }

  const count = readdirSync(dest).filter((n) => {
    try { return statSync(join(dest, n)).isDirectory(); } catch { return false; }
  }).length;
  return { ok: true, message: `${count} skill(s) synced`, copied: count, skipped: 0 };
}

/**
 * Copy `.claude/commands/*.md` → `~/.claude/commands/*.md`.
 *
 * Slash commands live in the project's `.claude/commands/` directory
 * (project-scoped). The global mirror in `~/.claude/commands/` makes
 * them available across every Claude Code session for the user.
 */
export async function syncCommandFiles({ dryRun = false, force = false } = {}) {
  // Project-scoped commands first, then legacy `config/commands/` as
  // a fallback for older Bizar installs.
  const candidates = [
    join(REPO_ROOT, '.claude', 'commands'),
    join(REPO_ROOT, 'config', 'commands'),
  ];
  let src = null;
  for (const c of candidates) if (existsSync(c)) { src = c; break; }
  if (!src) {
    return { ok: true, message: 'no commands source found', copied: 0, skipped: 0 };
  }
  const dest = CLAUDE_COMMANDS_DIR;
  if (dryRun) {
    return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  }
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: (n) => n.endsWith('.md') });
  return { ok: true, message: `${copied} command(s) synced (${skipped} kept)`, copied, skipped };
}

/**
 * Copy `config/rules/*.md` → `~/.claude/rules/*.md`.
 *
 * Claude Code auto-loads every `.md` file under `~/.claude/rules/` as
 * an always-on rule (https://code.claude.com/docs/en/rules).
 */
export async function syncRulesFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, 'config', 'rules');
  const dest = CLAUDE_RULES_DIR;
  if (!existsSync(src)) {
    return { ok: true, message: `no rules source at ${src}`, copied: 0, skipped: 0 };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  }
  ensureDir(dest);
  const { copied, skipped } = syncDir(src, dest, { filter: (n) => n.endsWith('.md') || n.endsWith('.txt') });
  return { ok: true, message: `${copied} rule(s) synced (${skipped} kept)`, copied, skipped };
}

/**
 * Copy `.claude/hooks/*.mjs` → `~/.claude/hooks/*.mjs`.
 *
 * Hook adapter scripts are real Node modules — Claude Code spawns them
 * and pipes JSON on stdin / stdout. They must be `chmod +x` so Claude
 * Code can `execve` them directly.
 */
export async function syncHookFiles({ dryRun = false, force = false } = {}) {
  const src = join(REPO_ROOT, '.claude', 'hooks');
  const dest = CLAUDE_HOOKS_DIR;
  ensureDir(dest);
  if (!existsSync(src)) {
    return { ok: true, message: `no hooks source at ${src}`, copied: 0, skipped: 0 };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would sync ${src} → ${dest}` };
  }
  copyDirContents(src, dest);
  // Make all scripts executable.
  for (const name of readdirSync(dest)) {
    const fp = join(dest, name);
    try {
      const st = statSync(fp);
      if (st.isFile() && (name.endsWith('.sh') || name.endsWith('.mjs'))) {
        chmodSync(fp, 0o755);
      }
    } catch { /* ignore */ }
  }
  return { ok: true, message: 'hook scripts installed', copied: readdirSync(dest).length, skipped: 0 };
}

// ─── settings.json ───────────────────────────────────────────────────────────

/**
 * Generate `~/.claude/settings.json` with the Bizar harness surface:
 *   - $schema pointing to https://json.schemastore.org/claude-code-settings.json
 *   - mcpServers block registering the `bizar` MCP server (stdio)
 *   - permissions.allow for mcp__bizar__*
 *   - permissions.deny for dangerous patterns
 *   - hooks.PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, SessionEnd
 *   - env block with BIZAR_HOME, BIZAR_MEMORY_VAULT
 *
 * Idempotent — we merge with any existing settings.json (preserve
 * user-added keys, never overwrite).
 */
export function writeClaudeSettings({ dryRun = false, force = false } = {}) {
  const fp = join(CLAUDE_DIR, 'settings.json');
  const existing = readJsonSafe(fp, {}) || {};

  const bizarSettings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    mcpServers: {
      bizar: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@polderlabs/bizar-sdk', 'mcp'],
        env: {
          BIZAR_HOME,
          BIZAR_MEMORY_VAULT: process.env.BIZAR_MEMORY_VAULT || join(BIZAR_HOME, 'memory-vault'),
        },
      },
    },
    permissions: {
      allow: ['mcp__bizar__*'],
      deny: [
        'Read(./.env)',
        'Read(./.env.*)',
        'Bash(rm -rf /)',
        'Bash(sudo *)',
        'Write(./node_modules/**)',
        'Write(./package-lock.json)',
      ],
    },
    env: {
      BIZAR_HOME,
      BIZAR_MEMORY_VAULT: process.env.BIZAR_MEMORY_VAULT || join(BIZAR_HOME, 'memory-vault'),
    },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit|Bash',
          hooks: [
            {
              type: 'command',
              command: join(CLAUDE_HOOKS_DIR, 'pretooluse-editwrite.mjs'),
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: join(CLAUDE_HOOKS_DIR, 'posttooluse-editwrite.mjs'),
              timeout: 10,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: join(CLAUDE_HOOKS_DIR, 'userpromptsubmit-tag.mjs'),
              timeout: 10,
            },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: join(CLAUDE_HOOKS_DIR, 'sessionstart-prime.mjs'),
              timeout: 10,
            },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: 'command',
              command: join(CLAUDE_HOOKS_DIR, 'sessionend-record.mjs'),
              timeout: 10,
            },
          ],
        },
      ],
    },
  };

  // Merge bizarre-specific keys into existing settings, preserve user's
  // unrelated keys (model, attribution, theme, etc.).
  const merged = { ...existing };
  if (force) {
    Object.assign(merged, bizarSettings);
  } else {
    merged.$schema = merged.$schema || bizarSettings.$schema;
    merged.mcpServers = { ...(existing.mcpServers || {}), ...bizarSettings.mcpServers };
    merged.permissions = {
      allow: [...new Set([...(existing.permissions?.allow || []), ...bizarSettings.permissions.allow])],
      deny:  [...new Set([...(existing.permissions?.deny || []),  ...bizarSettings.permissions.deny])],
      ask:   [...new Set([...(existing.permissions?.ask || [])])],
    };
    merged.env   = { ...(existing.env || {}), ...bizarSettings.env };
    merged.hooks = { ...(existing.hooks || {}), ...bizarSettings.hooks };
  }

  if (dryRun) {
    return { ok: true, message: `[dry-run] would write ${fp}` };
  }
  ensureDir(CLAUDE_DIR);
  writeFileSync(fp, JSON.stringify(merged, null, 2) + '\n');
  return { ok: true, message: `wrote ${fp}`, path: fp };
}

// ─── CLAUDE.md mirror ──────────────────────────────────────────────────────

/**
 * Mirror the repo's `AGENTS.md` into `~/.claude/CLAUDE.md`.
 *
 * Claude Code reads `~/.claude/CLAUDE.md` at session start as a global
 * memory file. Mirroring `AGENTS.md` (the canonical harness entry
 * point) makes the project's always-on rules available to every
 * Claude Code session for the user, not just project-scoped sessions.
 */
export function writeClaudeMdMirror({ dryRun = false, force = false } = {}) {
  const srcCandidates = [
    join(REPO_ROOT, 'AGENTS.md'),
    join(REPO_ROOT, 'CLAUDE.md'),
  ];
  const src = srcCandidates.find((p) => existsSync(p));
  const dest = join(CLAUDE_DIR, 'CLAUDE.md');
  if (!src) {
    return { ok: false, message: 'no CLAUDE.md / AGENTS.md found in repo root' };
  }
  if (existsSync(dest) && !force) {
    return { ok: true, message: `${dest} already exists — pass --force to overwrite` };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would mirror ${src} → ${dest}` };
  }
  ensureDir(CLAUDE_DIR);
  // Add a banner so users know this is auto-generated.
  const body = readFileSync(src, 'utf8');
  const banner =
    `# CLAUDE.md — Mirror of AGENTS.md for Claude Code compatibility\n\n` +
    `> Auto-generated by \`cli/provision-claude.mjs:writeClaudeMdMirror\`.\n` +
    `> DO NOT EDIT THIS FILE DIRECTLY — edit the project root's \`AGENTS.md\`\n` +
    `> and re-run \`bizar update\` (or \`make mirror-claude-md\`) to refresh.\n\n` +
    `---\n\n`;
  writeFileSync(dest, banner + body);
  return { ok: true, message: `mirrored ${src} → ${dest}`, path: dest };
}

// ─── MCP server registration ─────────────────────────────────────────────────

/**
 * Register the `bizar` MCP server via `claude mcp add`. Idempotent —
 * if the server is already registered in settings.json, we skip the
 * `claude mcp add` call.
 *
 * Per https://code.claude.com/docs/en/mcp, the canonical way to add a
 * stdio MCP server is:
 *
 *   claude mcp add <name> -- <command> [args...]
 */
export function setupMcpServer({ dryRun = false } = {}) {
  // Idempotency probe: read existing settings.json and look for a
  // bizar MCP server entry. If present, skip.
  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  const existing = readJsonSafe(settingsPath, null);
  if (existing && existing.mcpServers && existing.mcpServers.bizar) {
    return { ok: true, message: `bizar MCP server already registered in ${settingsPath}` };
  }

  if (!haveCmd('claude')) {
    return { ok: false, message: 'claude CLI not on PATH — install @anthropic-ai/claude-code first' };
  }
  if (dryRun) {
    return { ok: true, message: '[dry-run] would run: claude mcp add bizar -- npx -y @polderlabs/bizar-sdk mcp' };
  }

  const r = spawnSync('claude', [
    'mcp', 'add', '-f', '-s', 'user', 'bizar', '--',
    'npx', '-y', '@polderlabs/bizar-sdk', 'mcp',
  ], { stdio: 'inherit', timeout: 60_000 });

  if (r.status !== 0) {
    return { ok: false, message: `claude mcp add exited with code ${r.status}` };
  }
  return { ok: true, message: 'bizar MCP server registered via `claude mcp add`' };
}

/**
 * If `./.claude-plugin/plugin.json` exists, install the Bizar plugin
 * via `claude plugin install .`. Per
 * https://code.claude.com/docs/en/plugins, a Claude Code plugin is a
 * directory containing a `.claude-plugin/plugin.json` manifest.
 */
export function setupClaudePlugin({ dryRun = false } = {}) {
  const manifestPath = join(REPO_ROOT, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) {
    return { ok: true, message: `no plugin manifest at ${manifestPath} — skipping plugin install` };
  }
  if (!haveCmd('claude')) {
    return { ok: false, message: 'claude CLI not on PATH — install @anthropic-ai/claude-code first' };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would run: claude plugin install ${REPO_ROOT}` };
  }

  const r = spawnSync('claude', ['plugin', 'install', '.'], {
    stdio: 'inherit',
    timeout: 120_000,
    cwd: REPO_ROOT,
  });
  if (r.status !== 0) {
    return { ok: false, message: `claude plugin install exited with code ${r.status}` };
  }
  return { ok: true, message: `claude plugin installed from ${REPO_ROOT}` };
}

// ─── Dashboard service ───────────────────────────────────────────────────────

function installDashboardService({ dryRun = false, start = true } = {}) {
  const bin = join(REPO_ROOT, 'cli', 'bin.mjs');
  if (!existsSync(bin)) {
    return { ok: false, message: `cli/bin.mjs not found at ${bin} — service registration deferred` };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would run: node ${bin} service install` };
  }
  const r = spawnSync('node', [bin, 'service', 'install'], { stdio: 'inherit' });
  if (r.status !== 0) {
    return { ok: false, message: `service install returned ${r.status}` };
  }
  return { ok: true, message: 'dashboard service registered' };
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Probe the current state without modifying anything. Both install and
 * update flows start here so they can decide what to skip.
 *
 * Returned shape:
 *   {
 *     claudeDir: string,
 *     claudeCli: { available, version },
 *     agentsDir: { exists, count },
 *     skillsDir: { exists, count },
 *     commandsDir: { exists, count },
 *     hooksDir: { exists, count },
 *     rulesDir: { exists, count },
 *     settingsFile: { exists, parses },
 *     mcpServer: { registered, type, command },
 *     pluginManifest: { exists },
 *     bizarHome: { exists },
 *     gitRepo: boolean,
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
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mjs'))).length;
    } catch { return 0; }
  };
  const countSkillDirs = (dir) => {
    if (!existsSync(dir)) return 0;
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    } catch { return 0; }
  };

  const mcpServer = settings && settings.mcpServers && settings.mcpServers.bizar
    ? {
        registered: true,
        type: settings.mcpServers.bizar.type || 'stdio',
        command: settings.mcpServers.bizar.command || 'npx',
      }
    : { registered: false };

  return {
    claudeDir: CLAUDE_DIR,
    claudeCli: { available: !!claudeVersion, version: claudeVersion },
    agentsDir: { exists: existsSync(CLAUDE_AGENTS_DIR), count: countMd(CLAUDE_AGENTS_DIR) },
    skillsDir: { exists: existsSync(CLAUDE_SKILLS_DIR), count: countSkillDirs(CLAUDE_SKILLS_DIR) },
    commandsDir: { exists: existsSync(CLAUDE_COMMANDS_DIR), count: countMd(CLAUDE_COMMANDS_DIR) },
    hooksDir: { exists: existsSync(CLAUDE_HOOKS_DIR), count: countMd(CLAUDE_HOOKS_DIR) },
    rulesDir: { exists: existsSync(CLAUDE_RULES_DIR), count: countMd(CLAUDE_RULES_DIR) },
    settingsFile: {
      exists: existsSync(settingsPath),
      parses: settings !== null && typeof settings === 'object',
      path: settingsPath,
    },
    mcpServer,
    pluginManifest: { exists: existsSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json')) },
    bizarHome: { exists: existsSync(BIZAR_HOME), path: BIZAR_HOME },
    gitRepo: existsSync(join(REPO_ROOT, '.git')),
  };
}

/** Read-only JSON snapshot of detectState() — for diagnostics + tests. */
export function detectStateJson() {
  return JSON.stringify(detectState(), null, 2);
}

// ─── Top-level orchestration ─────────────────────────────────────────────────

/**
 * The unified provision flow. `mode` is 'install' or 'update'.
 *
 * Steps performed:
 *   1. Detect state (no side effects).
 *   2. Ensure ~/.bizar_home/ exists (memory-vault, loops, port file).
 *   3. Check toolchain + install Claude Code CLI if missing.
 *   4. Sync agent files to ~/.claude/agents/.
 *   5. Sync skills to ~/.claude/skills/.
 *   6. Sync commands to ~/.claude/commands/.
 *   7. Sync rules to ~/.claude/rules/.
 *   8. Sync hook adapter scripts to ~/.claude/hooks/.
 *   9. Write ~/.claude/settings.json with MCP + hooks + permissions + env.
 *  10. Register the Bizar MCP server via `claude mcp add`.
 *  11. Install the Bizar plugin via `claude plugin install .` (optional).
 *  12. Mirror AGENTS.md → ~/.claude/CLAUDE.md.
 *  13. (install) Register dashboard service.
 *  14. Print summary.
 *
 * Every step is idempotent — running this twice is safe.
 */
export async function runProvision(opts = {}) {
  const {
    mode = 'install',
    dryRun = false,
    force = false,
    yes = false,
    start = true,
  } = opts;

  const effectiveMode = mode === 'update' ? 'update' : 'install';

  console.log('');
  console.log(chalk.bold.cyan('  ⚡ BizarHarness Provisioner v6.3.0 (Claude Code)'));
  console.log(chalk.dim(`     Mode: ${effectiveMode}${force ? ' (force)' : ''}${dryRun ? ' (dry-run)' : ''}`));
  console.log('');

  // ── 1. Detect state ──────────────────────────────────────────────────
  const state = detectState();

  // ── 2. Bizar HOME bootstrap ──────────────────────────────────────────
  section('Bizar HOME');
  const bizarHomeStep = ensureBizarHome({ dryRun });
  if (bizarHomeStep.ok) logOk(bizarHomeStep.message);
  else logErr(bizarHomeStep.message);

  // ── 3. Toolchain ────────────────────────────────────────────────────
  checkToolchain();
  installClaudeCli({ force, dryRun });

  // ── 4-8. File sync ──────────────────────────────────────────────────
  const stepResults = [];
  const runStep = async (label, fn) => {
    section(label);
    const r = await fn();
    const marker = r.ok ? '✓' : '✗';
    console.log(`  ${marker} ${r.message}`);
    stepResults.push({ label, ...r });
    return r;
  };

  await runStep('Syncing agents',   () => syncAgentFiles({ dryRun, force }));
  await runStep('Syncing skills',   () => syncSkillFiles({ dryRun, force }));
  await runStep('Syncing commands', () => syncCommandFiles({ dryRun, force }));
  await runStep('Syncing rules',    () => syncRulesFiles({ dryRun, force }));
  await runStep('Syncing hooks',    () => syncHookFiles({ dryRun, force }));

  // ── 4b. Build the SDK workspace so dist/ exists. ────────────────────
  // The dashboard imports from packages/sdk/dist/* at runtime; without
  // this step v7.0.0+ npm installs crash on dashboard startup because
  // the SDK ships as TS source only. See `buildSdk()` JSDoc for the
  // full story.
  await runStep('Building SDK',     () => buildSdk({ dryRun }));

  // ── 4b.2. Build the Bizar plugin shim so dist/index.js exists. ────
  // The loader expects `plugins/bizar/dist/index.js`. Without this
  // step v8.0.x npm installs crash on `bizar dash start` with
  // `Plugin source not found at .../plugins/bizar` from
  // `cli/install.mjs:installPluginBizar` (the dir exists, but the
  // compiled entry does not). See `buildPlugin()` JSDoc.
  await runStep('Building plugin',  () => buildPlugin({ dryRun }));

  // ── 4c. Build the dashboard SPA so dist/index.html exists. ───────────
  // The Node server in `bizar-dash/src/server/server.mjs` serves the
  // React UI from `bizar-dash/dist/`. The published npm tarball excludes
  // `dist/` because it is `.gitignore`'d, so a fresh install must
  // rebuild it. Skips when already present (idempotent). See
  // `buildDash()` JSDoc for the v7.0.3 reason this step exists.
  await runStep('Building dashboard', () => buildDash({ dryRun }));

  // ── 9. settings.json (MCP + hooks + permissions + env) ──────────────
  section('Writing settings.json');
  const settingsStep = writeClaudeSettings({ dryRun, force });
  if (settingsStep.ok) logOk(settingsStep.message); else logErr(settingsStep.message);
  stepResults.push({ label: 'settings.json', ...settingsStep });

  // ── 10. MCP server registration ──────────────────────────────────────
  section('MCP server (bizar)');
  const mcpStep = setupMcpServer({ dryRun });
  if (mcpStep.ok) logOk(mcpStep.message); else logWarn(mcpStep.message);
  stepResults.push({ label: 'mcp-server', ...mcpStep });

  // ── 11. Plugin install (optional) ───────────────────────────────────
  section('Claude plugin');
  const pluginStep = setupClaudePlugin({ dryRun });
  if (pluginStep.ok) logOk(pluginStep.message); else logWarn(pluginStep.message);
  stepResults.push({ label: 'claude-plugin', ...pluginStep });

  // ── 12. CLAUDE.md mirror ────────────────────────────────────────────
  section('CLAUDE.md mirror');
  const claudeMdStep = writeClaudeMdMirror({ dryRun, force });
  if (claudeMdStep.ok) logOk(claudeMdStep.message); else logWarn(claudeMdStep.message);
  stepResults.push({ label: 'claude-md', ...claudeMdStep });

  // ── 13. Dashboard service ───────────────────────────────────────────
  if (start && effectiveMode === 'install') {
    section('Dashboard service');
    const svcStep = installDashboardService({ dryRun });
    if (svcStep.ok) logOk(svcStep.message); else logWarn(svcStep.message);
    stepResults.push({ label: 'service', ...svcStep });
  }

  // ── 14. Summary ─────────────────────────────────────────────────────
  section('Provision complete');
  const finalState = detectState();
  console.log(chalk.dim(JSON.stringify(finalState, null, 2)));
  console.log('');
  const anyFail = stepResults.some((r) => !r.ok);
  if (anyFail) {
    console.log(chalk.yellow('  ⚠ Some steps had issues. See messages above.'));
  } else {
    console.log(chalk.bold.green('  ✓ Bizar is ready.'));
    console.log(chalk.dim('     Next: restart your Claude Code session to pick up the new config.'));
  }
  console.log('');
  return { ok: !anyFail, mode: effectiveMode, state: finalState, stepResults };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const opts = {
    mode: 'install',
    dryRun: false,
    force: false,
    yes: false,
    start: true,
    update: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode=install') opts.mode = 'install';
    else if (a === '--mode=update') opts.mode = 'update';
    else if (a === '--mode=install-only-system') opts.mode = 'install-only-system';
    else if (a === '--mode') {
      const v = argv[++i];
      if (v === 'install' || v === 'update' || v === 'install-only-system') opts.mode = v;
    }
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--non-interactive') opts.yes = true;
    else if (a === '--no-service') opts.start = false;
    else if (a === '--update') opts.mode = 'update';
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node cli/provision-claude.mjs [--mode=install|update|install-only-system]\n' +
        '       [--dry-run] [--force] [--yes] [--non-interactive] [--no-service]',
      );
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
