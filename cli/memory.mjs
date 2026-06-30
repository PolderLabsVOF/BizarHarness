/**
 * cli/memory.mjs
 *
 * `bizar memory` subcommands. Delegates to memory-store.mjs and memory-git.mjs.
 * Supports: init, status, link, unlink, write, pull, commit, push, sync,
 * reindex, conflicts, doctor.
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
const memoryLightrag = await import(`${SERVER_ROOT}/memory-lightrag.mjs`).then((m) => m);

/**
 * Get the project root. Assumes CWD is the project root.
 */
function getProjectRoot() {
  return process.cwd();
}

/**
 * Validate a git remote URL. Accepts HTTPS, SSH (scp-style), and SSH URL form.
 * Rejects file://, plain paths, and other schemes.
 *
 * @param {string} url
 * @returns {{ valid: true, kind: 'ssh'|'https'|'ssh-url' } | { valid: false, error: string }}
 */
export function validateRemoteUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return { valid: false, error: 'URL must be a non-empty string' };
  }
  const trimmed = url.trim();
  // SSH scp-style: git@host:path
  if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.+$/.test(trimmed)) {
    return { valid: true, kind: 'ssh' };
  }
  // SSH URL form: ssh://[user@]host[:port]/path
  if (/^ssh:\/\/(?:[a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+(?::\d+)?\/.+$/.test(trimmed)) {
    return { valid: true, kind: 'ssh-url' };
  }
  // HTTPS: https://host/path
  if (/^https:\/\/[a-zA-Z0-9._-]+(?::\d+)?\/.+$/.test(trimmed)) {
    return { valid: true, kind: 'https' };
  }
  return { valid: false, error: 'URL must be ssh://, https://, or git@host:path form' };
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
 * `bizar memory write <relpath> [--type …] [--status …] [--confidence …]`
 *                          `[--tag <tag>]… [--body <body>|--body-file <file>]`
 *                          `[--title <title>] [--json]`
 *
 * Write a single note to the vault. Validates the path, type, status, and
 * confidence against the schema, builds frontmatter via `defaultFrontmatter`,
 * then delegates to `memoryStore.writeNote`. Designed for agents (and humans)
 * that want to write memory notes without going through the dashboard UI.
 */
async function cmdWrite(args) {
  const projectRoot = getProjectRoot();
  const { writeNote, loadConfig } = memoryStore;
  const { defaultFrontmatter, VALID_TYPES, VALID_STATUSES, VALID_CONFIDENCES } = memorySchema;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Usage: bizar memory write <relpath> [options]

  Write a single note to the vault. <relpath> must end in .md and is
  resolved relative to the project namespace root (e.g.
  decisions/0001-foo.md), NOT prefixed with the namespace.

  Options:
    --type <type>            One of: ${VALID_TYPES.join(', ')}
                             (default: project_overview)
    --status <status>        One of: ${VALID_STATUSES.join(', ')}
                             (default: active)
    --confidence <conf>      One of: ${VALID_CONFIDENCES.join(', ')}
                             (default: verified)
    --tag <tag>              Tag to attach (may be passed multiple times)
    --title <title>          Frontmatter title field
    --memory-id <id>         Custom memory_id (default: <type>_<timestamp>)
                             Must match [a-zA-Z0-9._-]+
    --scope <scope>          Frontmatter scope field (e.g. project, team)
    --source-agent <name>    Frontmatter source_agent field
    --body <text>            Note body as a string
    --body-file <path>       Path to a file containing the body
                             (exactly one of --body / --body-file is allowed)
    --json                   Emit the full returned note as JSON
    --help, -h               Show this help

  Exactly one of --body or --body-file is required, unless you intend
  to write an empty body (in which case omit both).
  `.trim());
    return;
  }

  // Parse positional relpath (first non-flag arg)
  const positional = args.filter((a) => !a.startsWith('-'));
  const relpath = positional[0];
  if (!relpath) {
    error('relpath is required: `bizar memory write <relpath>`');
    info('run `bizar memory write --help` for usage');
    process.exit(1);
  }
  if (!relpath.endsWith('.md')) {
    error(`relpath must end in .md: ${relpath}`);
    process.exit(1);
  }

  // ── Parse flags ──────────────────────────────────────────────────────────
  const optVal = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith('-')) return undefined;
    return v;
  };

  const type = optVal('--type') ?? 'project_overview';
  if (!VALID_TYPES.includes(type)) {
    error(`invalid --type: '${type}'`);
    info(`must be one of: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  const status = optVal('--status') ?? 'active';
  if (!VALID_STATUSES.includes(status)) {
    error(`invalid --status: '${status}'`);
    info(`must be one of: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const confidence = optVal('--confidence') ?? 'verified';
  if (!VALID_CONFIDENCES.includes(confidence)) {
    error(`invalid --confidence: '${confidence}'`);
    info(`must be one of: ${VALID_CONFIDENCES.join(', ')}`);
    process.exit(1);
  }

  const title = optVal('--title');

  // Multi-value --tag
  const tags = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' && args[i + 1] && !args[i + 1].startsWith('-')) {
      tags.push(args[i + 1]);
      i++;
    }
  }

  const inlineBody = optVal('--body');
  const bodyFile = optVal('--body-file');
  if (inlineBody !== undefined && bodyFile !== undefined) {
    error('use either --body or --body-file, not both');
    process.exit(1);
  }

  // --memory-id (kebab/snake-case only)
  const memoryId = optVal('--memory-id');
  if (memoryId !== undefined) {
    if (!/^[a-zA-Z0-9._-]+$/.test(memoryId)) {
      error(`invalid --memory-id: '${memoryId}' (must be kebab/snake-case)`);
      info('expected pattern: mem_<path>, e.g. mem_api_memory_schema_md');
      process.exit(1);
    }
  }

  // --scope (free-form, but non-empty when provided)
  const scope = optVal('--scope');
  if (scope !== undefined && scope.length === 0) {
    error('--scope must be a non-empty string');
    process.exit(1);
  }

  // --source-agent (free-form, but non-empty when provided)
  const sourceAgent = optVal('--source-agent');
  if (sourceAgent !== undefined && sourceAgent.length === 0) {
    error('--source-agent must be a non-empty string');
    process.exit(1);
  }

  let body = '';
  if (bodyFile) {
    try {
      body = readFileSync(bodyFile, 'utf8');
    } catch (err) {
      error(`failed to read --body-file ${bodyFile}: ${err.message}`);
      process.exit(1);
    }
  } else if (inlineBody !== undefined) {
    body = inlineBody;
  }

  // ── Build frontmatter ───────────────────────────────────────────────────
  const { config } = loadConfig(projectRoot);
  const projectId = config.projectId || projectRoot.split('/').pop() || 'unknown';

  const frontmatter = defaultFrontmatter({
    type,
    project_id: projectId,
    status,
    confidence,
    tags,
  });
  if (title) frontmatter.title = title;
  if (memoryId) frontmatter.memory_id = memoryId;
  if (scope) frontmatter.scope = scope;
  if (sourceAgent) frontmatter.source_agent = sourceAgent;

  // ── Write ───────────────────────────────────────────────────────────────
  let result;
  try {
    result = writeNote(projectRoot, relpath, { frontmatter, body });
  } catch (err) {
    if (err.code === 'SCHEMA_VALIDATION_FAILED') {
      error(`schema validation failed: ${err.message.replace(/^schema validation failed: /, '')}`);
    } else if (err.code === 'SECRET_DETECTED') {
      error(err.message);
    } else {
      error(err.message);
    }
    process.exit(1);
  }

  // ── Output ──────────────────────────────────────────────────────────────
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  success(`wrote ${result.relPath}`);
  console.log();
  console.log(chalk.bold('  Note'));
  console.log('  ─────────────────────────────');
  kv('relpath', result.relPath);
  kv('type', String(result.frontmatter.type));
  kv('status', String(result.frontmatter.status));
  kv('confidence', String(result.frontmatter.confidence));
  kv('memory_id', String(result.frontmatter.memory_id));
  if (Array.isArray(result.frontmatter.tags) && result.frontmatter.tags.length > 0) {
    kv('tags', result.frontmatter.tags.join(', '));
  }
  if (title) kv('title', title);
  kv('size', `${result.size} bytes`);
  console.log();
}

/**
 * `bizar memory init`
 * Creates .bizar/memory.json with mode=managed (default).
 * Pass --memory-mode local-only to use local vault storage instead.
 *
 * Flags (added for install.sh bootstrap):
 *   --yes                Accept all defaults (skip prompts, skip if already initialized)
 *   --memory-mode MODE   Either "local-only" or "managed" (bypasses --managed alias)
 *   --memory-repo-name   Repo name / path for managed mode (bypasses --repo alias)
 */
async function cmdInit(args) {
  const projectRoot = getProjectRoot();
  const { loadConfig, saveConfig } = memoryStore;

  // ── Help (must come before any work — fixes gap in cmdInit --help coverage) ─
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Usage: bizar memory init [options]

  Initialize memory config for this project.

  Options:
    --memory-mode <managed|local-only>   Vault mode (default: managed)
    --memory-repo-name <name>            Vault directory name (managed mode)
    --yes                                Skip prompts; non-interactive
    --non-interactive                    Alias for --yes
    --help, -h                           Show this help
    `.trim());
    return;
  }

  // --non-interactive is the canonical alias; --yes kept for backward compat.
  const yesFlag = args.includes('--yes') || args.includes('--non-interactive');

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
  let mode = 'managed';
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
 * `bizar memory setup` — configure or reconfigure the memory vault.
 *
 * v4.2.0 — first-class bootstrap entry point. Two flows:
 *   - No existing config  → behaves like `init` + adds the remote (managed mode).
 *   - Existing config     → optionally updates the remote URL on a managed vault.
 *
 * Flags:
 *   --mode <managed|local-only>     Vault mode (default: managed)
 *   --remote <url>                  Git remote URL (required for managed)
 *   --repo-name <name>              Vault directory name (default: bizar-memory)
 *   --non-interactive               No prompts; use flags or defaults
 *   --yes                           Same as --non-interactive (backward compat)
 *
 * The remote URL is written to BOTH `memoryRepo.remote` (canonical,
 * read by resolveVault) and the top-level `gitRemote` (read by cmdPush).
 * Both must agree or `bizar memory push` will fail silently.
 *
 * Connectivity is checked via `memoryGit.lsRemote` after `addRemote`. A
 * failure here is informational only — credentials may not be configured
 * yet — and does NOT abort the setup.
 *
 * @param {string[]} argv
 */
export async function cmdSetup(argv) {
  const projectRoot = getProjectRoot();
  const { loadConfig, saveConfig, initVault, resolveVault } = memoryStore;

  // ── Parse flags ──────────────────────────────────────────────────────────
  const optVal = (name) => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('-')) return undefined;
    return v;
  };
  const hasFlag = (name) => argv.includes(name);

  const nonInteractive = hasFlag('--non-interactive') || hasFlag('--yes');

  // --mode (default managed). Accept --memory-mode alias too.
  let mode = 'managed';
  const modeRaw = optVal('--mode') ?? optVal('--memory-mode');
  if (modeRaw) mode = modeRaw;
  else if (hasFlag('--local-only')) mode = 'local-only';
  else if (hasFlag('--managed')) mode = 'managed';
  if (mode !== 'managed' && mode !== 'local-only') {
    error(`invalid --mode: '${mode}' (must be 'managed' or 'local-only')`);
    process.exit(1);
  }

  // --remote
  let remote = optVal('--remote');
  if (remote !== undefined) {
    const v = validateRemoteUrl(remote);
    if (!v.valid) {
      error(`invalid --remote URL: ${v.error}`);
      info('examples:');
      info('  --remote git@github.com:user/repo.git');
      info('  --remote ssh://git@github.com/user/repo.git');
      info('  --remote https://github.com/user/repo.git');
      process.exit(1);
    }
    // Store the trimmed canonical form
    remote = remote.trim();
  }

  // --repo-name (or --memory-repo-name, --repo)
  const repoName = optVal('--repo-name') ?? optVal('--memory-repo-name') ?? optVal('--repo') ?? 'bizar-memory';

  // ── Help ────────────────────────────────────────────────────────────────
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
  Usage: bizar memory setup [--remote <url>] [--mode <mode>] [--non-interactive]

  Configure or reconfigure this project's memory vault.

  Options:
    --mode <managed|local-only>   Vault mode (default: managed)
    --remote <url>                Git remote URL (required for managed)
                                  Accepts: ssh://, https://, git@host:path
    --repo-name <name>            Vault directory name (default: bizar-memory)
    --local-only                  Shortcut for --mode local-only
    --non-interactive             Skip prompts; use flags or defaults
    --yes                         Alias for --non-interactive
    --help, -h                    Show this help

  Examples:
    # Bootstrap: first-time init with a remote
    bizar memory setup --non-interactive \\
      --remote git@github.com:org/bizar-memory.git

    # Reconfigure the remote on an existing managed vault
    bizar memory setup --non-interactive \\
      --remote https://github.com/org/bizar-memory.git

    # Convert to local-only (removes remote but keeps notes)
    bizar memory setup --non-interactive --local-only
    `.trim());
    return;
  }

  // ── Read existing config ────────────────────────────────────────────────
  const { config: existingCfg, exists: configExists } = loadConfig(projectRoot);

  // Decide whether this is a bootstrap (no config) or reconfigure (config
  // already exists). The branch shape drives the rest of the function.
  const isBootstrap = !configExists;

  // Reconfigure path: if no --remote was passed AND --mode wasn't changed,
  // just print status and exit. Otherwise apply the change.
  if (!isBootstrap) {
    const existingMode = existingCfg.memoryRepo?.mode || existingCfg.mode || 'local-only';
    const existingRemote = existingCfg.memoryRepo?.remote || existingCfg.gitRemote || '';
    const modeChanged = mode !== existingMode;
    const remoteChanged = remote !== undefined && remote !== existingRemote;

    if (!modeChanged && !remoteChanged) {
      // Nothing to do — print status and exit
      console.log(chalk.bold('\n  Memory setup (no changes)'));
      console.log('  ─────────────────────────────');
      success('already configured');
      kv('mode', existingMode);
      kv('remote', existingRemote || '(none)');
      kv('vault', existingCfg.memoryRepo?.path || existingCfg.repoName || '(unknown)');
      console.log();
      info(`run \`bizar memory setup --remote <url>\` to change the remote`);
      return;
    }

    // ── Reconfigure path — apply in place ───────────────────────────────
    const updatedCfg = { ...existingCfg };

    if (modeChanged && remote === undefined) {
      // Switching modes without a new remote is fine, but warn if going
      // managed without a URL to push to.
      if (mode === 'managed' && !existingRemote) {
        warn('switching to managed mode with no remote configured — push will fail');
        info('pass --remote <url> to set one');
      }
    }

    if (remote !== undefined) {
      // Dual-write: top-level + memoryRepo.*
      updatedCfg.gitRemote = remote;
      updatedCfg.memoryRepo = {
        ...(existingCfg.memoryRepo || {}),
        mode: mode === 'managed' ? 'managed' : (updatedCfg.memoryRepo?.mode || 'local-only'),
        remote,
      };
    }
    if (modeChanged) {
      updatedCfg.mode = mode;
      if (updatedCfg.memoryRepo) {
        updatedCfg.memoryRepo.mode = mode;
      }
    }

    const saveResult = saveConfig(projectRoot, updatedCfg);
    if (!saveResult.ok) {
      error(`failed to save config: ${saveResult.error}`);
      process.exit(1);
    }

    // If we now have a remote on a managed vault, register it.
    if (mode === 'managed' && remote) {
      addRemoteToVault(projectRoot, remote);
    }

    printSetupResult({ mode, remote, vaultPath: updatedCfg.memoryRepo?.path });
    return;
  }

  // ── Bootstrap path (no existing config) ─────────────────────────────────

  // For managed bootstrap, we need a remote. If missing, prompt or error.
  if (mode === 'managed' && !remote) {
    if (nonInteractive) {
      error('--remote is required for --mode managed in non-interactive setup');
      info('pass --remote <url> (or run without --non-interactive to be prompted)');
      process.exit(1);
    }
    // Prompt via readline
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(chalk.cyan('  remote URL (ssh://, https://, or git@host:path): '), resolve);
    });
    rl.close();
    const trimmed = (answer || '').trim();
    if (!trimmed) {
      error('a remote URL is required for managed mode');
      process.exit(1);
    }
    const v = validateRemoteUrl(trimmed);
    if (!v.valid) {
      error(`invalid remote URL: ${v.error}`);
      process.exit(1);
    }
    remote = trimmed;
  }

  // Build a config object mirroring cmdInit's shape, with the remote set.
  const home = homedir();
  const projectId = projectRoot.split('/').pop() || 'project';
  const vaultPath = mode === 'managed'
    ? join(home, '.local', 'share', 'bizar', 'memory', repoName)
    : join(projectRoot, '.obsidian');

  const cfg = {
    version: 1,
    backend: 'bizar-local',
    projectId,
    memoryRepo: {
      mode,
      path: vaultPath,
      remote: mode === 'managed' ? (remote || null) : null,
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

  // Top-level gitRemote mirrors memoryRepo.remote so cmdPush works.
  if (mode === 'managed' && remote) {
    cfg.gitRemote = remote;
  }

  const saveResult = saveConfig(projectRoot, cfg);
  if (!saveResult.ok) {
    error(`failed to write config: ${saveResult.error}`);
    process.exit(1);
  }

  // Initialize the vault on disk.
  const vaultResult = initVault(projectRoot);
  if (!vaultResult.ok) {
    error(`vault init failed: ${vaultResult.error || 'unknown'}`);
    process.exit(1);
  }
  if (vaultResult.created.length > 0) {
    for (const c of vaultResult.created) info(`  created: ${c}`);
  }

  // For managed bootstrap with a remote, register it on the new vault.
  if (mode === 'managed' && remote) {
    addRemoteToVault(projectRoot, remote);
  }

  printSetupResult({ mode, remote, vaultPath });
}

/**
 * Register `remote` as `origin` on the vault's git repo, then probe
 * connectivity via `lsRemote`. Both operations are best-effort: we
 * warn on failure but never abort the setup.
 *
 * @param {string} projectRoot
 * @param {string} remote
 */
function addRemoteToVault(projectRoot, remote) {
  const { resolveVault } = memoryStore;
  const { vaultRoot } = resolveVault(projectRoot);

  // Sanity check: is the vault a git repo? initVault should have ensured
  // this, but double-check before calling git remote.
  const gitDir = join(vaultRoot, '.git');
  if (!existsSync(gitDir)) {
    warn('vault is not a git repo — skipping remote registration');
    info('run `bizar memory init` or `bizar memory sync` to repair');
    return;
  }

  if (typeof memoryGit.addRemote !== 'function') {
    warn('memoryGit.addRemote is not available in this build');
    info('(waiting for the addRemote/lsRemote stream to merge) — remote URL saved to config');
    return;
  }

  const addResult = memoryGit.addRemote(vaultRoot, 'origin', remote);
  if (!addResult || addResult.ok === false) {
    warn(`failed to register remote: ${addResult?.error || 'unknown error'}`);
    info('the remote URL is still saved in .bizar/memory.json');
    return;
  }
  if (addResult.action === 'unchanged') {
    info(`remote 'origin' already set to ${remote}`);
  } else if (addResult.action === 'updated') {
    success(`updated remote 'origin' → ${remote}`);
  } else {
    success(`registered remote 'origin' → ${remote}`);
  }

  if (typeof memoryGit.lsRemote !== 'function') {
    info('skipping connectivity probe (lsRemote not available yet)');
    return;
  }

  const probe = memoryGit.lsRemote(vaultRoot, 'origin', { timeoutMs: 5000 });
  if (typeof probe === 'string' && probe.length > 0) {
    const refCount = probe.split('\n').filter(Boolean).length;
    success(`connectivity ok (${refCount} refs reachable)`);
  } else {
    warn('could not reach remote (auth, network, or unknown host)');
    info('the vault is set up; configure credentials and run `bizar memory pull`');
  }
}

/**
 * Render the standard "setup complete" report using the existing `kv`
 * style. The connectivity line is omitted if not relevant.
 *
 * @param {{ mode: string, remote: string|undefined|null, vaultPath: string }} opts
 */
function printSetupResult({ mode, remote, vaultPath }) {
  console.log();
  success('memory setup complete');
  console.log('  ─────────────────────────────');
  kv('mode', mode);
  kv('vault', String(vaultPath || ''));
  if (remote) kv('remote', remote);
  console.log();
  if (!remote) {
    info('local-only mode — notes are stored in this project only');
    info('run `bizar memory setup --remote <url>` to attach a remote later');
  } else {
    info('next steps:');
    info('  1. `bizar memory pull` to fetch the existing vault (if any)');
    info('  2. `bizar memory write <relpath>` to start adding notes');
    info('  3. `bizar memory push` to publish');
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

  // LightRAG status
  try {
    const { isLightRAGRunning, isLightRAGInstalled, resolveLightRAGConfig } = memoryStore;
    const cfg = resolveLightRAGConfig(projectRoot);
    if (!cfg.enabled) {
      kv('lightrag', chalk.gray('disabled'));
    } else if (!(await isLightRAGInstalled())) {
      kv('lightrag', chalk.yellow('not installed — `uv tool install "lightrag-hku[api]"`'));
    } else {
      const running = await isLightRAGRunning(cfg);
      kv('lightrag', running ? chalk.green(`${cfg.host}:${cfg.port} (running)`) : chalk.yellow(`${cfg.host}:${cfg.port} (not running — run \`bizar memory reindex\`)`));
    }
  } catch (err) {
    kv('lightrag', chalk.gray(`status unavailable (${err.message})`));
  }

  // Last reindex attempt
  const reindexMarker = join(projectRoot, '.bizar', 'memory-cache', 'last-reindex.json');
  if (existsSync(reindexMarker)) {
    try {
      const { finishedAt, ok, inserted, failed, noteCount } = JSON.parse(readFileSync(reindexMarker, 'utf8'));
      kv('lastReindex', `${new Date(finishedAt).toLocaleString()} — ${ok ? chalk.green(`${inserted}/${noteCount} ok`) : chalk.red(`${failed} failed`)}`);
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
  const { pull, isGitInstalled, ensureUpstream } = memoryGit;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    error('pull only works in managed mode');
    process.exit(1);
  }

  if (!isGitInstalled()) {
    error('git is not installed');
    process.exit(1);
  }

  const { vaultRoot, branch } = resolveVault(projectRoot);
  const remoteName = config.gitRemote ? 'origin' : 'origin';

  // Pre-flight: ensure upstream is set. Without this, `git pull` fails with
  // "no tracking information" on freshly-cloned or locally-initialized vaults.
  const upstreamResult = ensureUpstream(vaultRoot, config.branch || branch || 'main', remoteName);
  if (!upstreamResult.ok) {
    info(`upstream not set (${upstreamResult.error}); pull may fail`);
  } else if (upstreamResult.action === 'set') {
    success(`set upstream to ${remoteName}/${config.branch || branch || 'main'}`);
  }

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
  const { pull, addAll, commit: gitCommit, push: gitPush, status: gitStatus, acquireLock, isGitInstalled, ensureUpstream } = memoryGit;

  const { config } = loadConfig(projectRoot);
  if (config.mode === 'local-only') {
    error('sync only works in managed mode');
    process.exit(1);
  }

  if (!isGitInstalled()) {
    error('git is not installed');
    process.exit(1);
  }

  const { vaultRoot, branch } = resolveVault(projectRoot);
  const branchName = config.branch || branch || 'main';

  // Pre-flight: ensure upstream is set. Some workflows create a vault before
  // origin exists; without upstream, `git pull` fails with "no tracking".
  if (config.gitRemote) {
    const upstreamResult = ensureUpstream(vaultRoot, branchName, 'origin');
    if (!upstreamResult.ok) {
      info(`upstream not set (${upstreamResult.error}); pull may fail`);
    } else if (upstreamResult.action === 'set') {
      success(`set upstream to origin/${branchName}`);
    }
  }

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
 * v4.1.0 — populates the LightRAG server with every note in the vault.
 *
 * Steps:
 *   1. Resolve LightRAG config from `.bizar/memory.json`.
 *   2. Ensure `lightrag-server` is installed (searches common paths).
 *   3. Ensure server is running (auto-starts if not).
 *   4. List all notes from the vault.
 *   5. Insert each note via `POST /documents` with stable id
 *      `bizar://<projectId>/<relPath>`.
 *   6. Write marker file with stats.
 *
 * The reindex is idempotent — re-running re-inserts the same notes under
 * the same ids; LightRAG's id-keyed storage handles this gracefully.
 */
async function cmdReindex(args) {
  const projectRoot = getProjectRoot();
  const _atomic = await import('./atomic.mjs').then((m) => m);
  const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
  mkdirSync(cacheDir, { recursive: true });

  const { isLightRAGInstalled, reindexVault, resolveLightRAGConfig } = memoryStore;

  // Preflight: is lightrag-server installed?
  if (!(await isLightRAGInstalled())) {
    error('lightrag-server not installed');
    info('install it with: uv tool install "lightrag-hku[api]"');
    info('then run `bizar memory reindex` again');
    process.exit(1);
  }

  // Preflight: is lightrag enabled in config?
  const config = resolveLightRAGConfig(projectRoot);
  if (!config.enabled) {
    warn('lightrag is disabled in .bizar/memory.json (lightrag.enabled = false)');
    info('set lightrag.enabled = true and run `bizar memory reindex` again');
    return;
  }

  info(`reindexing vault into LightRAG at http://${config.host}:${config.port}…`);
  const result = await reindexVault(projectRoot, { logger: console });

  if (!result.ok && result.inserted === 0) {
    error(`reindex failed: ${result.error || 'unknown'}`);
    if (result.failures?.length > 0) {
      info(`first failure: ${result.failures[0].relPath} — ${result.failures[0].error}`);
    }
    process.exit(1);
  }

  if (result.started) {
    success(`started LightRAG server (pid ${result.pid})`);
  }
  success(`reindexed ${result.inserted}/${result.noteCount} notes in ${result.durationMs}ms`);
  if (result.failed > 0) {
    warn(`${result.failed} notes failed — see marker for details`);
  }
  info(`marker: ${result.markerPath}`);
}

/**
 * `bizar memory search <query>`
 * v4.1.0 — merged lexical + semantic search.
 *
 * - Lexical: token-frequency matching against vault notes (instant, free).
 * - Semantic: LightRAG `/query` with `mode: 'mix'` (combines local entity
 *   graph + global relation graph). Skipped if LightRAG isn't running.
 */
async function cmdSearch(args) {
  const query = args.join(' ').trim();
  if (!query) {
    error('search requires a query: `bizar memory search <query>`');
    process.exit(1);
  }
  const projectRoot = getProjectRoot();
  const { searchVault } = memoryStore;

  // Lexical
  const lexical = searchVault(projectRoot, query, { limit: 10 });
  console.log(chalk.bold('\n  Lexical results (token-frequency):'));
  if (lexical.length === 0) {
    console.log(chalk.dim('    (no matches)'));
  } else {
    for (const r of lexical.slice(0, 5)) {
      console.log(`  ${chalk.cyan(r.relPath)} ${chalk.dim(`(score ${r.score})`)}`);
      console.log(chalk.dim(`    ${r.snippet}`));
    }
  }

  // Semantic (best-effort)
  console.log(chalk.bold('\n  Semantic answer (LightRAG):'));
  try {
    const cfg = memoryStore.resolveLightRAGConfig(projectRoot);
    const semantic = await memoryLightrag.query(cfg, query, { topK: 10 });
    if (!semantic.ok) {
      console.log(chalk.dim(`    ${semantic.error || 'unavailable'}`));
      if (semantic.error?.includes('not running')) {
        console.log(chalk.dim('    tip: run `bizar memory reindex` to start + populate LightRAG'));
      }
    } else {
      const response = semantic.response?.response || semantic.response?.answer || '';
      if (response) {
        console.log(`  ${response.split('\n').join('\n  ')}`);
      } else {
        console.log(chalk.dim('    (no answer returned)'));
      }
    }
  } catch (err) {
    console.log(chalk.dim(`    ${err.message}`));
  }
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
      if (/^<{7}\s|^={7}\s|^>{7}\s/m.test(content)) {
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

    // Check 7: last reindex
    const reindexMarker = join(projectRoot, '.bizar', 'memory-cache', 'last-reindex.json');
    if (existsSync(reindexMarker)) {
      try {
        const { finishedAt, ok, inserted, failed, noteCount } = JSON.parse(readFileSync(reindexMarker, 'utf8'));
        const ageMs = Date.now() - new Date(finishedAt).getTime();
        const ageH = ageMs / 3600000;
        const summary = `${inserted}/${noteCount} inserted${failed > 0 ? `, ${failed} failed` : ''}`;
        const status = ok ? chalk.green(summary) : chalk.red(summary);
        kv('lastReindex', ageH < 24 ? `${status} ${chalk.dim(`(${Math.round(ageH)}h ago)`)}` : `${status} ${chalk.yellow(`(${Math.round(ageH)}h ago)`)}`);
      } catch { /* ignore */ }
    } else {
      kv('lastReindex', chalk.yellow('never — run `bizar memory reindex`'));
    }

    // Check 8: LightRAG status
    try {
      const { isLightRAGInstalled, isLightRAGRunning, resolveLightRAGConfig } = memoryStore;
      const cfg = resolveLightRAGConfig(projectRoot);
      if (!cfg.enabled) {
        kv('lightrag', chalk.gray('disabled'));
      } else if (!(await isLightRAGInstalled())) {
        kv('lightrag', chalk.yellow('not installed — `uv tool install "lightrag-hku[api]"`'));
      } else {
        const running = await isLightRAGRunning(cfg);
        kv('lightrag', running ? chalk.green(`${cfg.host}:${cfg.port} running`) : chalk.yellow(`not running — run \`bizar memory reindex\``));
      }
    } catch (err) {
      kv('lightrag', chalk.gray(`status check failed: ${err.message}`));
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

// ─── read / list / delete (Fix 4 + Fix 5 plumbing) ────────────────────────────

/**
 * Parse `--namespace <ns>` and return the chosen namespace plus the remaining
 * positional args. Defaults to 'project' when the flag is absent.
 */
function parseNamespaceFlag(args) {
  const idx = args.indexOf('--namespace');
  if (idx === -1) return { namespace: 'project', rest: args };
  const v = args[idx + 1];
  if (!v || v.startsWith('-')) return { namespace: 'project', rest: args };
  // Remove the flag and its value from the rest
  const rest = args.filter((a, i) => i !== idx && i !== idx + 1);
  return { namespace: v, rest };
}

/**
 * `bizar memory read [--namespace <ns>] <relpath>`
 *
 * Read a single note and print its raw content (frontmatter + body) to stdout.
 */
async function cmdRead(args) {
  const projectRoot = getProjectRoot();
  const { resolveVault, resolveNamespaceRoot } = memoryStore;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Usage: bizar memory read [--namespace <ns>] <relpath>

  Read a single note and print it to stdout (YAML frontmatter + body).

  Options:
    --namespace <project|global|user>   Namespace to read from (default: project)
    --help, -h                          Show this help
    `.trim());
    return;
  }

  const { namespace, rest } = parseNamespaceFlag(args);
  const relpath = rest.filter((a) => !a.startsWith('-'))[0];
  if (!relpath) {
    error('relpath is required: `bizar memory read <relpath>`');
    info('run `bizar memory read --help` for usage');
    process.exit(1);
  }

  let note;
  if (namespace === 'project') {
    note = memoryStore.readNote(projectRoot, relpath);
  } else {
    const vi = resolveVault(projectRoot);
    const root = resolveNamespaceRoot(vi, namespace);
    if (!root) {
      error(`unknown namespace: ${namespace}`);
      process.exit(1);
    }
    note = memoryStore.readNote(projectRoot, relpath, { root });
  }

  if (!note) {
    error(`note not found: ${relpath}`);
    process.exit(1);
  }
  process.stdout.write(note.raw);
  if (!note.raw.endsWith('\n')) process.stdout.write('\n');
}

/**
 * `bizar memory list [--namespace <ns>] [--json] [dir]`
 *
 * List notes under a directory. Default: walk the project namespace root.
 * Pass `dir` (e.g. `decisions/`) to scope to a subdirectory. The dir is
 * resolved RELATIVE TO the namespace root.
 */
async function cmdList(args) {
  const projectRoot = getProjectRoot();
  const { resolveVault, resolveNamespaceRoot } = memoryStore;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Usage: bizar memory list [--namespace <ns>] [dir]

  List notes under a directory. Default: the project namespace root.

  Options:
    --namespace <project|global|user>   Namespace to list (default: project)
    --json                              Emit JSON array
    [dir]                               Subdirectory under the namespace (e.g. decisions/)
    --help, -h                          Show this help
    `.trim());
    return;
  }

  const { namespace, rest } = parseNamespaceFlag(args);
  const asJson = rest.includes('--json');
  const dir = rest.filter((a) => !a.startsWith('-'))[0] || '';

  let notes;
  if (namespace === 'project') {
    notes = memoryStore.listNotes(projectRoot, dir ? { namespace: dir } : {});
  } else {
    const vi = resolveVault(projectRoot);
    const root = resolveNamespaceRoot(vi, namespace);
    if (!root) {
      error(`unknown namespace: ${namespace}`);
      process.exit(1);
    }
    notes = memoryStore.listNotes(projectRoot, dir ? { root, namespace: dir } : { root });
  }

  // listNotes returns relPaths RELATIVE to the search root, so when we
  // filter by `dir` we need to re-attach the dir prefix for display —
  // otherwise the user sees `0001-foo.md` instead of the more useful
  // `decisions/0001-foo.md`. Strip a trailing slash for cleanliness.
  const displayPrefix = dir ? dir.replace(/\/+$/, '') + '/' : '';

  if (asJson) {
    console.log(JSON.stringify(notes.map((n) => ({
      relPath: displayPrefix + n.relPath,
      size: n.size,
      mtime: n.mtime,
    })), null, 2));
    return;
  }
  if (notes.length === 0) {
    console.log(chalk.dim('  (no notes)'));
    return;
  }
  for (const n of notes) {
    console.log(`  ${displayPrefix}${n.relPath}`);
  }
}

/**
 * `bizar memory delete [--namespace <ns>] <relpath>`
 *
 * Delete a single note from the vault.
 */
async function cmdDelete(args) {
  const projectRoot = getProjectRoot();
  const { resolveVault, resolveNamespaceRoot } = memoryStore;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Usage: bizar memory delete [--namespace <ns>] <relpath>

  Delete a single note from the vault.

  Options:
    --namespace <project|global|user>   Namespace to delete from (default: project)
    --help, -h                          Show this help
    `.trim());
    return;
  }

  const { namespace, rest } = parseNamespaceFlag(args);
  const relpath = rest.filter((a) => !a.startsWith('-'))[0];
  if (!relpath) {
    error('relpath is required: `bizar memory delete <relpath>`');
    info('run `bizar memory delete --help` for usage');
    process.exit(1);
  }

  let ok;
  if (namespace === 'project') {
    ok = memoryStore.deleteNote(projectRoot, relpath);
  } else {
    const vi = resolveVault(projectRoot);
    const root = resolveNamespaceRoot(vi, namespace);
    if (!root) {
      error(`unknown namespace: ${namespace}`);
      process.exit(1);
    }
    ok = memoryStore.deleteNote(projectRoot, relpath, { root });
  }

  if (!ok) {
    error(`note not found: ${relpath}`);
    process.exit(1);
  }
  success(`deleted ${relpath}`);
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
    case 'setup':
      await cmdSetup(args);
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
    case 'write':
      await cmdWrite(args);
      break;
    case 'read':
      await cmdRead(args);
      break;
    case 'list':
      await cmdList(args);
      break;
    case 'delete':
      await cmdDelete(args);
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
    case 'search':
      await cmdSearch(args);
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
    setup         Configure or reconfigure the memory vault (mode + remote)
    status        Show current memory configuration
    link <path>   Link to a shared memory repo (clone if URL)
    unlink        Revert to local-only mode
    write         Write a single note to the vault
    read          Read a single note and print it to stdout
    list          List notes (optionally filtered by namespace + dir)
    delete        Delete a single note from the vault
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
