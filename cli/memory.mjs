/**
 * cli/memory.mjs
 *
 * `bizar memory` subcommands. Delegates to memory-store.mjs and memory-git.mjs.
 * Supports: init, status, link, unlink, pull, commit, push, sync, reindex,
 * conflicts, doctor.
 */

import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Memory service modules (ESM, shared with bizar-dash)
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bizar-dash', 'src', 'server');
const memoryStore = await import(`${SERVER_ROOT}/memory-store.mjs`).then((m) => m);
const memorySchema = await import(`${SERVER_ROOT}/memory-schema.mjs`).then((m) => m);
const memorySecrets = await import(`${SERVER_ROOT}/memory-secrets.mjs`).then((m) => m);
const memoryGit = await import(`${SERVER_ROOT}/memory-git.mjs`).then((m) => m);

/**
 * Get the project root. Assumes CWD is the project root.
 */
function getProjectRoot() {
  return process.cwd();
}

// ─── Helper formatters ────────────────────────────────────────────────────────

function success(msg) { console.log(chalk.green('✓'), msg); }
function info(msg) { console.log(chalk.blue('ℹ'), msg); }
function warn(msg) { console.log(chalk.yellow('⚠'), msg); }
function error(msg) { console.error(chalk.red('✗'), msg); }

/**
 * Print a key-value row: `  key  … value`
 */
function kv(key, value) {
  const pad = 20;
  const dots = Math.max(2, pad - key.length);
  console.log(`  ${key}${'.'.repeat(dots)} ${value}`);
}

// ─── Subcommand implementations ───────────────────────────────────────────────

/**
 * `bizar memory init`
 * Creates .bizar/memory.json with mode=local-only.
 * If mode=managed is desired, user passes --managed or --repo <name>.
 *
 * Flags (added for install.sh bootstrap):
 *   --yes                Accept all defaults (skip prompts, skip if already initialized)
 *   --memory-mode MODE   Either "local-only" or "managed" (bypasses --managed alias)
 *   --memory-repo-name   Repo name / path for managed mode (bypasses --repo alias)
 */
async function cmdInit(args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, saveConfig } = memoryStore;

  const yesFlag = args.includes('--yes');

  const existing = loadConfig(projectRoot);
  if (existing.exists) {
    if (yesFlag) {
      // Bootstrap mode: skip silently if already initialized
      return;
    }
    warn('memory config already exists — run `bizar memory status` to see current config');
    const mode = existing.config.mode || 'local-only';
    info(`current mode: ${mode}, projectId: ${existing.config.projectId}`);
    return;
  }

  // --memory-mode takes precedence over --managed
  let mode = 'local-only';
  const modeIdx = args.indexOf('--memory-mode');
  if (modeIdx !== -1 && args[modeIdx + 1]) {
    mode = args[modeIdx + 1];
  } else if (args.includes('--managed')) {
    mode = 'managed';
  }

  let repoName = '';

  if (mode === 'managed') {
    // --memory-repo-name takes precedence over --repo
    const repoArg = args.indexOf('--memory-repo-name');
    repoName = repoArg !== -1 ? args[repoArg + 1] : '';
    if (!repoName) {
      const legacyRepoArg = args.indexOf('--repo');
      repoName = legacyRepoArg !== -1 ? args[legacyRepoArg + 1] : '';
    }
    if (!repoName) {
      // Ask via inquirer-style prompt (use readline)
      const rl = await import('node:readline').then((m) =>
        m.createInterface({ input: process.stdin, output: process.stdout })
      );
      repoName = await new Promise((resolve) =>
        rl.question(chalk.cyan('  repo name (e.g. my-org/memory): '), resolve)
      );
      rl.close();
    }
  }

  const home = homedir();
  const projectId = projectRoot.split('/').pop() || 'project';
  const managedPath = mode === 'managed'
    ? join(home, '.local', 'share', 'bizar', 'memory', repoName || 'bizar-memory')
    : null;
  const vaultPath = mode === 'managed' ? managedPath : join(projectRoot, '.obsidian');

  const config = {
    version: 1,
    backend: 'bizar-local',
    projectId,
    memoryRepo: {
      mode,
      path: vaultPath,
      remote: null,
      branch: 'main',
      namespace: mode === 'managed' ? `projects/${projectId}` : null,
    },
    namespaces: {
      project: `projects/${projectId}`,
      global: 'global/bizar',
      user: `users/${process.env.USER || process.env.USERNAME || 'local'}`,
    },
    lightrag: {
      enabled: false,
      host: '127.0.0.1',
      port: 9621,
      workingDir: join(projectRoot, '.bizar', 'lightrag'),
    },
    git: {
      autoPullOnSessionStart: false,
      autoCommitOnMemoryWrite: false,
      autoPushOnSessionEnd: false,
      commitAuthor: 'Bizar Memory <bizar-memory@local>',
      commitMessageTemplate: `memory(${projectId}): {summary}`,
    },
  };

  const result = saveConfig(projectRoot, config);
  if (!result.ok) {
    error(`failed to write config: ${result.error}`);
    process.exit(1);
  }

  const { initVault } = memoryStore;
  const vaultResult = initVault(projectRoot);
  success(`initialized memory config`);
  info(`mode: ${mode}`);
  info(`vault: ${vaultResult.vaultRoot}`);
  if (vaultResult.created.length > 0) {
    for (const c of vaultResult.created) info(`  created: ${c}`);
  }
}

/**
 * `bizar memory status`
 */
async function cmdStatus(_args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, resolveVault, initVault, listNotes } = memoryStore;
  const { isGitInstalled, status: gitStatus } = memoryGit;

  const { config, exists } = loadConfig(projectRoot);
  if (!exists) {
    warn('memory not initialized — run `bizar memory init` first');
    return;
  }

  const { vaultRoot, mode, projectId, branch } = resolveVault(projectRoot);

  console.log(chalk.bold('\n  Bizar Memory Status'));
  console.log('  ─────────────────────────────');
  kv('mode', mode);
  kv('projectId', projectId);
  kv('vault', vaultRoot);
  kv('branch', branch);

  // Ensure vault exists
  if (!existsSync(vaultRoot)) {
    warn(`vault directory does not exist — run \`bizar memory init\` or \`bizar memory sync\``);
  } else {
    const notes = listNotes(projectRoot);
    kv('noteCount', String(notes.length));
  }

  // Git status if managed
  if ((mode === 'managed' || mode === 'linked') && existsSync(vaultRoot)) {
    if (isGitInstalled()) {
      const gs = gitStatus(vaultRoot);
      if (gs.ok) {
        kv('git', `${gs.branch} (${gs.clean ? chalk.green('clean') : chalk.red('dirty')})`);
        if (gs.ahead > 0) kv('ahead', String(gs.ahead));
        if (gs.behind > 0) kv('behind', String(gs.behind));
      } else {
        kv('git', chalk.yellow(`not a git repo`));
      }
    } else {
      kv('git', chalk.yellow(`git not installed`));
    }
  }

  // LightRAG stub
  kv('lightrag', chalk.gray('stub (Phase 2)'));

  // Last reindex attempt
  const reindexMarker = join(projectRoot, '.bizar', 'memory-cache', 'last-reindex-attempt.json');
  if (existsSync(reindexMarker)) {
    try {
      const { attemptedAt, ok } = JSON.parse(readFileSync(reindexMarker, 'utf8'));
      kv('lastReindex', `${new Date(attemptedAt).toLocaleString()} — ${ok ? chalk.green('ok') : chalk.red('failed')}`);
    } catch { /* ignore */ }
  }

  console.log();
}

/**
 * `bizar memory link <path|url>`
 */
async function cmdLink(args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, saveConfig, resolveVault } = memoryStore;
  const { clone, isGitInstalled } = memoryGit;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`  Usage: bizar memory link [--force] <path|url>`);
    console.log(`  Link this project to a shared memory repo.`);
    console.log(`  Use --force to overwrite an existing link.`);
    return;
  }

  const force = args.includes('--force');
  const { config: existing } = loadConfig(projectRoot);

  if (existing.mode === 'managed' && !force) {
    error('already linked — use --force to overwrite');
    process.exit(1);
  }

  const target = args.filter((a) => !a.startsWith('--'))[0];
  if (!target) {
    error('specify a path or URL to link to');
    process.exit(1);
  }

  let repoPath;
  let gitRemote = '';

  if (target.startsWith('http') || target.startsWith('git')) {
    // Clone URL
    if (!isGitInstalled()) {
      error('git is not installed — cannot clone');
      process.exit(1);
    }
    const repoName = target.split('/').pop().replace(/\.git$/, '');
    repoPath = join(process.env.HOME, '.local', 'share', 'bizar', 'memory', repoName);
    info(`cloning ${target} → ${repoPath}`);
    const result = clone(target, repoPath);
    if (!result.ok) {
      error(`clone failed: ${result.error}`);
      process.exit(1);
    }
    gitRemote = target;
  } else {
    // Local path — validate it exists
    if (!existsSync(target)) {
      error(`path does not exist: ${target}`);
      process.exit(1);
    }
    repoPath = target;
  }

  const config = {
    ...existing,
    mode: 'managed',
    repoName: repoPath,
    gitRemote,
    branch: existing.branch || 'main',
  };

  const result = saveConfig(projectRoot, config);
  if (!result.ok) {
    error(`failed to save config: ${result.error}`);
    process.exit(1);
  }

  success(`linked to ${repoPath}`);
}

/**
 * `bizar memory unlink`
 */
async function cmdUnlink(_args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, saveConfig } = memoryStore;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    warn('not linked — nothing to do');
    return;
  }

  const newConfig = { ...config, mode: 'local-only', repoName: '', gitRemote: '' };
  const result = saveConfig(projectRoot, newConfig);
  if (!result.ok) {
    error(`failed to save config: ${result.error}`);
    process.exit(1);
  }
  success('unlinked — reverted to local-only mode');
}

/**
 * `bizar memory pull`
 */
async function cmdPull(_args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, resolveVault } = memoryStore;
  const { pull, isGitInstalled } = memoryGit;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    error('pull only works in managed mode');
    process.exit(1);
  }

  if (!isGitInstalled()) {
    error('git is not installed');
    process.exit(1);
  }

  const { vaultRoot } = resolveVault(projectRoot);
  info(`pulling into ${vaultRoot}`);
  const result = pull(vaultRoot);
  if (!result.ok) {
    error(`pull failed: ${result.error}`);
    process.exit(1);
  }
  success('pulled successfully');
}

/**
 * `bizar memory commit [-m msg]`
 */
async function cmdCommit(args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, resolveVault } = memoryStore;
  const { commit: gitCommit, addAll, isGitInstalled } = memoryGit;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    error('commit only works in managed mode');
    process.exit(1);
  }

  if (!isGitInstalled()) {
    error('git is not installed');
    process.exit(1);
  }

  const { vaultRoot } = resolveVault(projectRoot);

  // Stage all
  const addResult = addAll(vaultRoot);
  if (!addResult.ok) {
    error(`git add failed: ${addResult.error}`);
    process.exit(1);
  }

  // Message
  const msgIdx = args.indexOf('-m');
  let message;
  if (msgIdx !== -1 && args[msgIdx + 1]) {
    message = args[msgIdx + 1];
  } else {
    const date = new Date().toISOString().replace(/T.*/, '');
    message = `[memory-sync] ${date} vault sync`;
  }

  const result = gitCommit(vaultRoot, message);
  if (!result.ok) {
    error(`commit failed: ${result.error}`);
    process.exit(1);
  }
  success(`committed: ${message}`);
}

/**
 * `bizar memory push`
 */
async function cmdPush(_args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, resolveVault } = memoryStore;
  const { push, isGitInstalled } = memoryGit;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    error('push only works in managed mode');
    process.exit(1);
  }

  if (!isGitInstalled()) {
    error('git is not installed');
    process.exit(1);
  }

  const { vaultRoot, branch } = resolveVault(projectRoot);
  info(`pushing to ${config.gitRemote || 'origin'}`);
  const result = push(vaultRoot, { remote: config.gitRemote || 'origin', branch });
  if (!result.ok) {
    error(`push failed: ${result.error}`);
    process.exit(1);
  }
  success('pushed successfully');
}

/**
 * `bizar memory sync`
 * Full sync orchestrator: pull → stage → validate → secret-scan →
 * commit → push (if remote configured).
 */
async function cmdSync(args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, resolveVault, validateAll, scanForSecrets, listNotes } = memoryStore;
  const { pull, addAll, commit: gitCommit, push: gitPush, status: gitStatus, acquireLock, isGitInstalled } = memoryGit;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    error('sync only works in managed mode');
    process.exit(1);
  }

  if (!isGitInstalled()) {
    error('git is not installed');
    process.exit(1);
  }

  const { vaultRoot } = resolveVault(projectRoot);

  // Acquire lock
  const lock = acquireLock(vaultRoot);
  if (lock.error) {
    error(`vault is locked by another process — try again later`);
    process.exit(1);
  }

  try {
    // 1. Pull
    info('pulling latest changes...');
    const pullResult = pull(vaultRoot);
    if (!pullResult.ok) {
      warn(`pull failed (may be up to date): ${pullResult.error}`);
    } else {
      success('pulled');
    }

    // 2. Check status
    const gs = gitStatus(vaultRoot);
    if (gs.clean) {
      info('nothing to sync — vault is clean');
      return;
    }

    // 3. Validate changed files
    const allNotes = listNotes(projectRoot);
    const changedSet = new Set([...gs.modified, ...gs.untracked]);
    const invalidNotes = allNotes.filter((n) => !n.schemaValid && changedSet.has(n.relPath));
    if (invalidNotes.length > 0) {
      error('schema validation failed for changed notes:');
      for (const n of invalidNotes) {
        const { errors } = memorySchema.validateNote(n.frontmatter, n.body);
        console.error(`  ${n.relPath}: ${errors.join('; ')}`);
      }
      process.exit(1);
    }

    // 4. Secret scan changed files
    const scanResults = [];
    for (const relPath of changedSet) {
      const result = scanForSecrets(projectRoot, relPath);
      if (!result.safe) {
        scanResults.push(...result.findings);
      }
    }

    const highFindings = scanResults.filter((f) => f.severity === 'HIGH');
    if (highFindings.length > 0) {
      error('HIGH-severity secrets detected — blocking commit:');
      for (const f of highFindings) {
        console.error(`  [${f.id}] line ${f.line}: ${f.snippet}`);
      }
      process.exit(1);
    }

    if (scanResults.length > 0) {
      warn(`${scanResults.length} MEDIUM-severity finding(s):`);
      for (const f of scanResults) {
        warn(`  [${f.id}] line ${f.line}: ${f.snippet}`);
      }
    }

    // 5. Add all
    const addResult = addAll(vaultRoot);
    if (!addResult.ok) {
      error(`git add failed: ${addResult.error}`);
      process.exit(1);
    }

    // 6. Commit
    const date = new Date().toISOString().replace(/T.*/, '');
    const summary = allNotes.length > 0 ? allNotes[0].relPath.slice(0, 60) : 'vault sync';
    const message = `[memory-sync] ${date} ${summary}`;
    const commitResult = gitCommit(vaultRoot, message);
    if (!commitResult.ok) {
      error(`commit failed: ${commitResult.error}`);
      process.exit(1);
    }
    success(`committed: ${message}`);

    // 7. Push if remote configured
    if (config.gitRemote) {
      if (args.includes('--push')) {
        const pushResult = gitPush(vaultRoot, { remote: config.gitRemote, branch: config.branch || 'main' });
        if (!pushResult.ok) {
          error(`push failed: ${pushResult.error}`);
          process.exit(1);
        }
        success('pushed');
      } else {
        info('skipping push (pass --push to push after commit)');
      }
    }

    success('sync complete');
  } finally {
    lock.release();
  }
}

/**
 * `bizar memory reindex`
 * STUB — Phase 2 will implement LightRAG integration.
 */
async function cmdReindex(_args) {
  const projectRoot = getProjectRoot();
  const { atomicWriteJson } = await import('./atomic.mjs').then((m) => m);
  const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  const marker = join(cacheDir, 'last-reindex-attempt.json');
  const result = {
    attemptedAt: new Date().toISOString(),
    ok: false,
    reason: 'lightrag-not-implemented',
  };
  atomicWriteJson(marker, result);
  console.log(chalk.yellow('reindex: LightRAG runtime not yet implemented — Phase 2'));
  console.log(`  marker written to ${marker}`);
}

/**
 * `bizar memory conflicts`
 */
async function cmdConflicts(_args) {
  const projectRoot = getProjectRoot();
  const { listNotes, readNote } = memoryStore;

  const notes = listNotes(projectRoot);
  const conflicts = [];

  // Frontmatter-based conflicts
  for (const note of notes) {
    if (note.frontmatter?.status === 'conflict') {
      conflicts.push({ relPath: note.relPath, reason: 'frontmatter: status=conflict' });
    }
  }

  // Git conflict markers in working tree
  const { vaultRoot } = memoryStore.resolveVault(projectRoot);
  const { readFileSync: rf } = await import('node:fs');
  for (const note of notes) {
    const filePath = join(vaultRoot, note.relPath);
    try {
      const content = rf(filePath, 'utf8');
      if (/^<{7}\s|^={7}\s|>{7}\s/.test(content)) {
        conflicts.push({ relPath: note.relPath, reason: 'git conflict markers detected' });
      }
    } catch { /* skip */ }
  }

  if (conflicts.length === 0) {
    success('no conflicts found');
  } else {
    console.log(chalk.red(`\n  ${conflicts.length} conflict(s) found:`));
    for (const c of conflicts) {
      console.log(`  ${c.relPath} — ${c.reason}`);
    }
  }
}

/**
 * `bizar memory doctor`
 */
async function cmdDoctor(_args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, resolveVault, initVault, listNotes, validateAll, scanForSecrets } = memoryStore;
  const { isGitInstalled, status: gitStatus } = memoryGit;

  console.log(chalk.bold('\n  Bizar Memory Doctor'));
  console.log('  ─────────────────────────────');

  let allPassed = true;

  // Check 1: git installed
  kv('git binary', isGitInstalled() ? chalk.green('present') : chalk.red('missing'));
  if (!isGitInstalled()) allPassed = false;

  // Check 2: config exists
  const { config, exists: configExists } = loadConfig(projectRoot);
  kv('config file', configExists ? chalk.green('present') : chalk.red('missing'));
  if (!configExists) allPassed = false;

  // Check 3: vault exists
  if (configExists) {
    const { vaultRoot } = resolveVault(projectRoot);
    kv('vault dir', existsSync(vaultRoot) ? chalk.green('present') : chalk.red('missing'));
    if (!existsSync(vaultRoot)) allPassed = false;

    // Check 4: vault is a git repo (if managed)
    if ((config.mode === 'managed' || config.mode === 'linked') && existsSync(vaultRoot)) {
      const gs = gitStatus(vaultRoot);
      kv('git repo', gs.ok ? chalk.green('yes') : chalk.red('no'));
      if (!gs.ok) allPassed = false;
    }

    // Check 5: note count
    const notes = listNotes(projectRoot);
    kv('notes', notes.length > 0 ? chalk.green(String(notes.length)) : chalk.yellow('0'));

    // Check 6: schema validation pass rate
    const validationResults = validateAll(projectRoot);
    const invalidCount = validationResults.length;
    if (invalidCount === 0) {
      kv('schema valid', chalk.green('all notes valid'));
    } else {
      kv('schema valid', chalk.red(`${invalidCount} note(s) invalid`));
      for (const r of validationResults.slice(0, 5)) {
        console.error(`    ${r.relPath}: ${r.errors.join('; ')}`);
      }
      allPassed = false;
    }

    // Check 7: last secret scan
    const reindexMarker = join(projectRoot, '.bizar', 'memory-cache', 'last-reindex-attempt.json');
    if (existsSync(reindexMarker)) {
      try {
        const { attemptedAt } = JSON.parse(readFileSync(reindexMarker, 'utf8'));
        const ageMs = Date.now() - new Date(attemptedAt).getTime();
        const ageH = ageMs / 3600000;
        kv('lastReindex', ageH < 24 ? chalk.green(`${Math.round(ageH)}h ago`) : chalk.yellow(`${Math.round(ageH)}h ago`));
      } catch { /* ignore */ }
    } else {
      kv('lastReindex', chalk.yellow('never'));
    }
  }

  console.log('\n  ─────────────────────────────');
  if (allPassed) {
    success(chalk.bold('All checks passed'));
  } else {
    error(chalk.bold('Some checks failed — run `bizar memory init` or `bizar memory sync`'));
  }
  console.log();
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * @param {string} subcommand
 * @param {string[]} args
 */
export async function runMemory(subcommand, args) {
  switch (subcommand) {
    case 'init':
      await cmdInit(args);
      break;
    case 'status':
      await cmdStatus(args);
      break;
    case 'link':
      await cmdLink(args);
      break;
    case 'unlink':
      await cmdUnlink(args);
      break;
    case 'pull':
      await cmdPull(args);
      break;
    case 'commit':
      await cmdCommit(args);
      break;
    case 'push':
      await cmdPush(args);
      break;
    case 'sync':
      await cmdSync(args);
      break;
    case 'reindex':
      await cmdReindex(args);
      break;
    case 'conflicts':
      await cmdConflicts(args);
      break;
    case 'doctor':
      await cmdDoctor(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      error(`unknown subcommand: ${subcommand}`);
      console.error(`  Run \`bizar memory --help\` for usage.`);
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
  Bizar Memory Service

  Usage:
    bizar memory <subcommand> [options]

  Subcommands:
    init          Initialize memory config for this project
    status        Show current memory configuration
    link <path>   Link to a shared memory repo (clone if URL)
    unlink        Revert to local-only mode
    pull          Git pull from the shared repo
    commit [-m]   Git commit staged changes
    push          Git push to the shared repo
    sync [--push] Full sync: pull → validate → scan → commit → [push]
    reindex       Rebuild search index (STUB — Phase 2)
    conflicts     List notes with conflict markers
    doctor        Run health checks

  Options:
    --help, -h    Show this help
  `.trim());
}
