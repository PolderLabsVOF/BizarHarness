/**
 * cli/commands/statusline.mjs
 *
 * Customized Claude Code status bar for Bizar.
 *
 * Implements: `bizar statusline <subcommand>` with subcommands:
 *   - render (default): reads JSON from stdin, writes formatted text to stdout
 *   - install: writes/updates the statusLine field in settings.json
 *   - remove: deletes the statusLine field
 *   - show: prints current config
 *   - preview: runs renderer with synthetic JSON fixture
 */
import chalk from 'chalk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ── Constants ───────────────────────────────────────────────────────────────────

const EXIT_OK = 0;
const EXIT_ERROR = 1;

// ── Settings path ───────────────────────────────────────────────────────────

export function settingsPath() {
  const root = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(root, 'settings.json');
}

export function readSettings(path = settingsPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ── Template registry ─────────────────────────────────────────────────────────

export const STATUSLINE_TEMPLATES = {
  default: {
    name: 'default',
    lines: 3,
  },
  compact: {
    name: 'compact',
    lines: 1,
  },
  'git-only': {
    name: 'git-only',
    lines: 1,
  },
};

// ── Argument parsing ─────────────────────────────────────────────────────────

export function parseStatuslineArgs(args = []) {
  const subcommands = ['render', 'install', 'remove', 'show', 'preview'];
  let subcommand = 'render';
  let template;
  let padding;
  let refresh;
  let hideVim = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (subcommands.includes(arg)) {
      subcommand = arg;
    } else if (arg === '--template' && i + 1 < args.length) {
      template = args[++i];
      if (!STATUSLINE_TEMPLATES[template]) {
        throw new Error(`Unknown template: ${template}. Valid: default, compact, git-only`);
      }
    } else if (arg === '--padding' && i + 1 < args.length) {
      padding = parseInt(args[++i], 10);
      if (isNaN(padding) || padding < 0) {
        throw new Error('Padding must be a non-negative integer');
      }
    } else if (arg === '--refresh' && i + 1 < args.length) {
      refresh = parseInt(args[++i], 10);
      if (isNaN(refresh) || refresh < 1) {
        throw new Error('Refresh interval must be at least 1 second');
      }
    } else if (arg === '--hide-vim') {
      hideVim = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, subcommand: 'render' };
    }
  }

  return { subcommand, template, padding, refresh, hideVim };
}

// ── Settings update ─────────────────────────────────────────────────────────

export function updateStatuslineSettings(current, options) {
  if (options.remove) {
    const next = { ...current };
    delete next.statusLine;
    return next;
  }

  const statusLine = {
    type: 'command',
    command: resolveStatuslinePath(),
    padding: options.padding ?? 1,
    refreshInterval: options.refresh ?? 5,
    hideVimModeIndicator: options.hideVim ?? false,
    template: options.template ?? 'default',
  };

  return {
    ...current,
    statusLine,
  };
}

// ── Resolve command path ───────────────────────────────────────────────────

export function resolveStatuslinePath() {
  // Return the literal command string to embed in settings.json
  return 'bizar statusline render';
}

// ── Operator guard ─────────────────────────────────────────────────────────
// render is called by Claude Code itself, so it should never be blocked

export function assertOperatorContext(operation) {
  // render is allowed even when running as an agent (called by Claude Code)
  if (operation === 'render') {
    return true;
  }
  const isAgent = process.env.BIZAR_AGENT || process.env.CLAUDE_CODE_AGENT_NAME;
  if (isAgent) {
    throw new Error(`bizar statusline ${operation}: not available to agents. Run as operator.`);
  }
  return true;
}

// ── Git helpers (injectable for testing) ───────────────────────────────────

const gitCache = new Map();

function clearGitCache() {
  gitCache.clear();
}

async function getGitBranch(cwd, timeout = 2000) {
  const cacheKey = `branch:${cwd}`;
  const cached = gitCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5000) {
    return cached.value;
  }

  try {
    const branch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout,
    }).trim();
    gitCache.set(cacheKey, { value: branch, timestamp: Date.now() });
    return branch;
  } catch {
    gitCache.set(cacheKey, { value: null, timestamp: Date.now() });
    return null;
  }
}

async function getGitDirty(cwd, timeout = 2000) {
  const cacheKey = `dirty:${cwd}`;
  const cached = gitCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5000) {
    return cached.value;
  }

  try {
    const output = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], {
      encoding: 'utf8',
      timeout,
    });

    let modified = 0;
    let staged = 0;
    for (const line of output.split('\n')) {
      if (!line) continue;
      if (line[0] === ' ' && (line[1] === 'M' || line[1] === 'm')) modified++;
      else if (line[0] === 'M') staged++;
      else if (line[0] === '?') {} // untracked, ignore
      else if (line[1] === 'M') modified++; // staged but also modified
    }
    const result = { modified, staged };
    gitCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  } catch {
    gitCache.set(cacheKey, { value: null, timestamp: Date.now() });
    return null;
  }
}

// ── Progress bar ───────────────────────────────────────────────────────────

function formatProgressBar(percentage) {
  const total = 20;
  const filled = Math.round((percentage / 100) * total);
  const empty = total - filled;

  let colorCode = '\x1b[32m'; // green: 0-50%
  if (percentage >= 80) colorCode = '\x1b[31m'; // red: 80-100%
  else if (percentage >= 50) colorCode = '\x1b[33m'; // yellow: 50-80%

  const filledBar = '█'.repeat(filled);
  const emptyBar = '░'.repeat(empty);
  return `${colorCode}${filledBar}${emptyBar}\x1b[0m`;
}

function formatTokens(used) {
  if (!Number.isFinite(used)) return '?';
  if (used >= 1000000) return `${(used / 1000000).toFixed(0)}M`;
  if (used >= 1000) return `${(used / 1000).toFixed(1)}k`;
  return used.toString();
}

// ── Path truncation ─────────────────────────────────────────────────────────

function truncatePath(path, maxLen = 30) {
  if (!path || path.length <= maxLen) return path;
  return '…' + path.slice(-(maxLen - 1));
}

// ── Model display name width-aware ─────────────────────────────────────────

function truncateModelName(name, columns) {
  if (!name) return 'Unknown';
  const maxWidth = Math.min(columns || 80, 40);
  return name.length > maxWidth ? name.slice(0, maxWidth - 1) + '…' : name;
}

// ── Duration formatting ─────────────────────────────────────────────────────

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

// ── Format statusline (pure function) ─────────────────────────────────────
// Uses injected settings for purity - caller passes settings from readSettings()

export function formatStatusline(data, templateName, env, deps = {}) {
  const template = STATUSLINE_TEMPLATES[templateName] || STATUSLINE_TEMPLATES.default;
  const columns = parseInt(env.COLUMNS || '80', 10);

  // Extract data with fallbacks
  const modelId = data?.model?.id || '';
  const modelDisplay = truncateModelName(data?.model?.display_name || modelId || 'Unknown', columns);
  const cwd = data?.workspace?.current_dir || data?.cwd || '';
  const truncatedCwd = truncatePath(cwd);
  const branch = deps.gitBranch || null;
  const dirty = deps.gitDirty || { modified: 0, staged: 0 };
  // Use pre-calculated percentage, falling back to manual calculation.
  // Note: used_percentage is based on input tokens only (excludes output_tokens).
  const contextTotal = data?.context_window?.context_window_size || 0;
  const contextUsed = data?.context_window?.total_input_tokens || 0;
  const calculatedPercentage = contextTotal > 0 ? (contextUsed / contextTotal) * 100 : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(
    data?.context_window?.used_percentage ?? calculatedPercentage,
  )));
  const cost = data?.cost?.total_cost_usd || 0;
  // Use cost.total_duration_ms if available (in ms), convert to seconds
  const durationMs = data?.cost?.total_duration_ms || 0;
  const sessionDuration = Math.floor(durationMs / 1000);
  const prNumber = data?.pr?.number || null;

  // Settings passed from caller (for purity)
  const settings = deps.settings || {};
  const advisorModel = settings.advisorModel || null;
  const customModel = settings.env?.ANTHROPIC_CUSTOM_MODEL_OPTION || null;

  // Build segments
  const lines = [];

  if (templateName === 'default') {
    // Line 1: model + advisor + custom model
    let line1 = `\u{1F916} ${modelDisplay}`;
    if (customModel) {
      line1 += `  ⚡ ${customModel} (custom)`;
    }
    if (advisorModel) {
      line1 += `  \u{1F9E0} ${advisorModel} (advisor)`;
    }
    lines.push(line1);

    // Line 2: cwd + branch + PR
    let line2 = `\u{1F4C1} ${truncatedCwd}`;
    if (branch) {
      let branchInfo = ` ↧ ${branch}`;
      if (dirty.modified > 0 || dirty.staged > 0) {
        branchInfo += `*${dirty.modified}+${dirty.staged}`;
      }
      line2 += branchInfo;
    }
    if (prNumber) {
      line2 += `  \u{1F517} #${prNumber}`;
    }
    lines.push(line2);

    // Line 3: progress bar + tokens + cost + duration
    const progressBar = formatProgressBar(percentage);
    const totalLabel = contextTotal > 0 ? formatTokens(contextTotal) : '?';
    const line3 = `${progressBar} ${percentage}% (${formatTokens(contextUsed)}/${totalLabel})  \u{1F4B5} $${cost.toFixed(2)}  \u{23F1} ${formatDuration(sessionDuration)}`;
    lines.push(line3);

  } else if (templateName === 'compact') {
    // Single line: model · % ctx · $cost · branch · cwd
    let line = `\u{1F916} ${modelDisplay} · ${percentage}% ctx · $${cost.toFixed(2)}`;
    if (branch) {
      let branchInfo = ` · ↧ ${branch}`;
      if (dirty.modified > 0 || dirty.staged > 0) {
        branchInfo += `*${dirty.modified}+${dirty.staged}`;
      }
      line += branchInfo;
    }
    line += ` · ${truncatedCwd}`;
    lines.push(line);

  } else if (templateName === 'git-only') {
    // Single line: branch · PR · cwd (no model/cost)
    let line = '';
    if (branch) {
      let branchInfo = `↧ ${branch}`;
      if (dirty.modified > 0 || dirty.staged > 0) {
        branchInfo += `*${dirty.modified}+${dirty.staged}`;
      }
      line += branchInfo;
    }
    if (prNumber) {
      line += ` · \u{1F517} #${prNumber}`;
    }
    line += ` · ${truncatedCwd}`;
    lines.push(line);
  }

  return lines.join('\n');
}

// ── Synthetic fixture for preview ─────────────────────────────────────────

function getPreviewFixture() {
  return {
    model: {
      id: 'claude-sonnet-4-5-20250514',
      display_name: 'Sonnet 4.5',
    },
    workspace: {
      current_dir: '/home/user/proj',
    },
    context_window: {
      used_percentage: 35,
      total_input_tokens: 12000,
      total_output_tokens: 5500,
      context_window_size: 50000,
    },
    cost: {
      total_cost_usd: 0.42,
      total_duration_ms: 252000, // 4m12s
    },
    pr: {
      number: 142,
    },
    vim: {
      mode: 'insert',
    },
  };
}

// ── Run render ───────────────────────────────────────────────────────────

export async function runStatuslineRender({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
} = {}) {
  let data = '';
  try {
    if (typeof stdin.read === 'function') {
      data = stdin.read() || '';
    }
    if (!data && typeof stdin[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stdin) data += chunk;
    }
    if (!data.trim()) {
      stderr.write('bizar statusline render: no input (stdin is empty)\n');
      return EXIT_ERROR;
    }

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseErr) {
      stderr.write(`bizar statusline render: invalid JSON: ${parseErr.message}\n`);
      return EXIT_ERROR;
    }

    const args = process.argv.slice(2);
    const parsedArgs = parseStatuslineArgs(args);
    const templateName = parsedArgs.template || 'default';
    const cwd = parsed?.workspace?.current_dir;
    let gitBranch = null;
    let gitDirty = null;

    if (cwd) {
      const results = await Promise.all([
        getGitBranch(cwd),
        getGitDirty(cwd),
      ]);
      gitBranch = results[0];
      gitDirty = results[1];
    }

    const output = formatStatusline(parsed, templateName, env, {
      gitBranch,
      gitDirty,
      settings: readSettings(),
    });

    stdout.write(output + '\n');
    return EXIT_OK;
  } catch (err) {
    stderr.write(`bizar statusline render: ${err.message}\n`);
    return EXIT_ERROR;
  }
}

// ── Run install ───────────────────────────────────────────────────────────

export async function runStatuslineInstall(args = []) {
  assertOperatorContext('install');

  const options = parseStatuslineArgs(args);
  if (options.help) {
    showStatuslineHelp();
    return { ok: true };
  }

  const path = settingsPath();
  let current;
  try {
    current = readSettings(path);
  } catch (error) {
    console.error(chalk.red(`  ✗ Invalid JSON in ${path}: ${error.message}`));
    return { ok: false, error: error.message };
  }

  const next = updateStatuslineSettings(current, {
    install: true,
    padding: options.padding,
    refresh: options.refresh,
    hideVim: options.hideVim,
    template: options.template,
  });

  // Print diff
  if (current.statusLine) {
    console.log(chalk.dim('  Current statusLine:'));
    console.log(chalk.dim('  ' + JSON.stringify(current.statusLine, null, 2).replace(/\n/g, '\n  ')));
  }
  console.log(chalk.green('  New statusLine:'));
  console.log(chalk.green('  ' + JSON.stringify(next.statusLine, null, 2).replace(/\n/g, '\n  ')));

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  console.log(chalk.green(`\n  ✓ Installed statusline at ${path}`));

  return { ok: true, path, settings: next };
}

// ── Run remove ───────────────────────────────────────────────────────────

export async function runStatuslineRemove(args = []) {
  assertOperatorContext('remove');

  const options = parseStatuslineArgs(args);
  if (options.help) {
    showStatuslineHelp();
    return { ok: true };
  }

  const path = settingsPath();
  let current;
  try {
    current = readSettings(path);
  } catch (error) {
    console.error(chalk.red(`  ✗ Invalid JSON in ${path}: ${error.message}`));
    return { ok: false, error: error.message };
  }

  if (!current.statusLine) {
    console.log(chalk.yellow('  No statusLine configured. Nothing to remove.'));
    return { ok: true, path, settings: current };
  }

  console.log(chalk.dim('  Current statusLine:'));
  console.log(chalk.dim('  ' + JSON.stringify(current.statusLine, null, 2).replace(/\n/g, '\n  ')));

  const next = updateStatuslineSettings(current, { remove: true });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  console.log(chalk.green(`\n  ✓ Removed statusline from ${path}`));

  return { ok: true, path, settings: next };
}

// ── Run show ────────────────────────────────────────────────────────────

export async function runStatuslineShow(args = []) {
  assertOperatorContext('show');

  const options = parseStatuslineArgs(args);
  if (options.help) {
    showStatuslineHelp();
    return { ok: true };
  }

  const path = settingsPath();
  const current = readSettings(path);

  console.log(`  Settings: ${path}`);
  console.log(`  Template: ${options.template || 'default'}`);

  if (current.statusLine) {
    console.log(chalk.green('  Current statusLine:'));
    console.log('  ' + JSON.stringify(current.statusLine, null, 2).replace(/\n/g, '\n  '));
  } else {
    console.log(chalk.yellow('  No statusLine configured.'));
  }

  console.log(`\n  Command: ${resolveStatuslinePath()}`);
  console.log(chalk.dim('  (Copy this to your settings.json if needed)'));

  return { ok: true, path, settings: current };
}

// ── Run preview ───────────────────────────────────────────────────────────

export async function runStatuslinePreview(args = []) {
  assertOperatorContext('preview');

  const options = parseStatuslineArgs(args);
  const templateName = options.template || 'default';

  console.log(chalk.dim('  Preview template: ' + templateName));
  console.log();

  const fixture = getPreviewFixture();
  const output = formatStatusline(fixture, templateName, process.env, {
    gitBranch: 'main',
    gitDirty: { modified: 2, staged: 1 },
    settings: readSettings(),
  });

  console.log(output);
  console.log();
  console.log(chalk.dim('  (This is what you will see in your terminal)'));

  return { ok: true };
}

// ── Help ───────────────────────────────────────────────────────────────────

export function showStatuslineHelp() {
  console.log(`
  bizar statusline — Customized Claude Code status bar

  Usage:
    bizar statusline render                    # Read JSON from stdin, write formatted text
    bizar statusline install                   # Install statusLine in settings.json
    bizar statusline remove                    # Remove statusLine from settings.json
    bizar statusline show                      # Show current configuration
    bizar statusline preview                   # Preview with synthetic data

  Options:
    --template <name>   Template: default, compact, git-only (default: default)
    --padding <n>       Horizontal padding (default: 1)
    --refresh <seconds> Refresh interval, min 1 (default: 5)
    --hide-vim          Hide Vim mode indicator
    --help, -h          Show this help

  Templates:
    default    3 lines: model + cwd/branch/pr + progress/cost/duration
    compact    1 line:  model · % ctx · $cost · branch · cwd
    git-only   1 line: branch · PR · cwd (no model/cost)

  The render subcommand is called by Claude Code's status line feature.
  It reads JSON from stdin and writes formatted text to stdout.
  `);
}

// ── Main run function ─────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name !== 'statusline') return false;

  const parsed = parseStatuslineArgs(args);

  if (isHelpRequest || parsed.help) {
    showStatuslineHelp();
    return true;
  }

  switch (parsed.subcommand) {
    case 'render':
      await runStatuslineRender();
      break;
    case 'install':
      await runStatuslineInstall(args);
      break;
    case 'remove':
      await runStatuslineRemove(args);
      break;
    case 'show':
      await runStatuslineShow(args);
      break;
    case 'preview':
      await runStatuslinePreview(args);
      break;
    default:
      showStatuslineHelp();
      return false;
  }

  return true;
}

// Export for testing
export { clearGitCache };
