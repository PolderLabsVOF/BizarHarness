/**
 * cli/commands/validate.mjs
 *
 * v6.3.0 — `bizar validate` subcommand (Claude Code-native).
 *
 * The Claude Code-aware health check. Extends `bizar doctor` with a
 * longer battery of checks specific to a "flawless Claude Code
 * integration":
 *
 *   - `claude` CLI reachable + version
 *   - `~/.claude/settings.json` exists + parses
 *   - Bizar MCP server registered (mcpServers.bizar.*)
 *   - 16 uniquely named agent files in `~/.claude/agents/`
 *   - skills mirrored from `config/skills/` → `~/.claude/skills/`
 *   - 7 rules mirrored from `config/rules/` → `~/.claude/rules/`
 *   - guarded autonomy hooks, including approval, compaction, and advisor context
 *   - shipped slash commands in `~/.claude/commands/`
 *   - permissions follow the current hook-enforced policy
 *   - the complete hook-enforced approval floor is wired
 *   - ~/.config/bizar/ exists (loop/runtime state)
 *
 * Exits non-zero if any check fails. Use `--json` for machine output.
 * Use `--strict` to also fail on lenient checks.
 */
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBizarHome, resolveClaudeConfigDir, resolveGlobalModelRouter } from '../config-paths.mjs';
import { configuredEnabledModels, listModels, resolveEndpoint } from './models.mjs';

function claudeDir() { return resolveClaudeConfigDir(); }
function bizarHome() { return resolveBizarHome(); }

const REPO_ROOT = process.env.BIZAR_REPO_ROOT || process.cwd();

export const REQUIRED_AGENTS = [
  'brand-designer.md', 'debug-specialist.md', 'exec-assistant.md',
  'help-desk.md', 'it-lead.md', 'knowledge-manager.md',
  'office-coordinator.md', 'office-greeter.md', 'office-manager.md',
  'planner.md', 'principal-engineer.md', 'qa-reviewer.md',
  'research-analyst.md', 'senior-engineer.md', 'support-tech.md',
  'ui-designer.md',
];

export const REQUIRED_COMMANDS = [
  'artifact.md', 'audit.md', 'autopilot.md', 'backup.md', 'bizar.md',
  'browser.md', 'cancel.md', 'cron.md', 'doctor.md', 'explain.md', 'init.md',
  'learn.md', 'plan.md', 'plow-through.md', 'pr-review.md', 'quick.md',
  'ralph.md', 'ralplan.md', 'rca.md', 'repair.md', 'restore.md',
  'setup-provider.md', 'spec.md', 'sprint.md', 'team.md', 'test.md',
  'tools.md', 'ultracode.md', 'ultraqa.md', 'ultrawork.md', 'update.md',
  'validate.md', 'verify.md',
];

// v6.3.0 — Claude Code hook adapter scripts (executable, .mjs extension).
export const REQUIRED_HOOKS = [
  'agent-grounding.mjs',
  'agent-model-guard.mjs',
  'advisor-context.mjs',
  'bizar-hook-wrapper.sh',
  'completion-artifact.mjs',
  'content-style-guard.mjs',
  'control-inbox.mjs',
  'git-workflow-guard.mjs',
  'keyword-router.mjs',
  'path-ownership-guard.mjs',
  'permission-request.mjs',
  'persistent-mode.mjs',
  'post-tool-use-failure.mjs',
  'posttooluse-editwrite.mjs',
  'precompact-priorities.sh',
  'pretooluse-bash.mjs',
  'pretooluse-editwrite.mjs',
  'sessionend-recall.mjs',
  'sessionstart-model-sync.mjs',
  'sessionstart-prime.mjs',
  'simplify-guard.mjs',
  'team-lifecycle.mjs',
  'telemetry.mjs',
  'thinking-route.mjs',
  'verify-deliverables.mjs',
  'worker-suggest.mjs',
  'workflow-route-guard.mjs',
  'workflow-route-state.mjs',
  'worktree-archive.mjs',
  'worktree-bootstrap.mjs',
];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((message) => ({ name, ok: true, message: message || 'ok' }))
    .catch((err) => ({ name, ok: false, message: (err && err.message) ? err.message : String(err) }));
}

function settingsJsonPath() {
  return join(claudeDir(), 'settings.json');
}

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const CHECKS = {
  'claude-cli-reachable': async () => {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) throw new Error(`claude --version exited ${r.status}`);
    return (r.stdout || r.stderr || '').trim().split('\n')[0] || 'claude available';
  },

  'claude-settings-exists': async () => {
    const p = settingsJsonPath();
    if (!existsSync(p)) throw new Error(`not found at ${p}`);
    return p;
  },

  'claude-settings-parses': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    if (!cfg) throw new Error('invalid JSON');
    return '~/.claude/settings.json parses';
  },

  'claude-settings-schema': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    if (!cfg?.$schema) {
      return 'no $schema declared (advisory only)';
    }
    if (!cfg.$schema.includes('claude-code-settings')) {
      throw new Error(`unexpected $schema: ${cfg.$schema}`);
    }
    return `$schema = ${cfg.$schema}`;
  },

  'mcp-server-bizar-registered': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const servers = cfg?.mcpServers;
    if (!servers || !servers.bizar) {
      throw new Error(`mcpServers.bizar missing in ${settingsJsonPath()} — run \`bizar install\``);
    }
    const s = servers.bizar;
    return `bizar MCP server registered: command=${s.command || '(unset)'}, type=${s.type || 'stdio'}`;
  },

  'mcp-server-bizar-command': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const s = cfg?.mcpServers?.bizar;
    if (!s) throw new Error('bizar MCP server not registered');
    const args = Array.isArray(s.args) ? s.args.join(' ') : '';
    const expected = 'npx -y @polderlabs/bizar-sdk mcp';
    const actual = `${s.command || ''} ${args}`.trim();
    if (!actual.includes('@polderlabs/bizar-sdk')) {
      throw new Error(`MCP server command does not reference @polderlabs/bizar-sdk: ${actual}`);
    }
    return `MCP command OK: ${actual}`;
  },

  'permissions-policy-current': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const allow = cfg?.permissions?.allow || [];
    const staleWildcard = allow.find((p) => typeof p === 'string' && p === 'mcp__*');
    if (staleWildcard) {
      throw new Error('legacy mcp__* wildcard remains in permissions.allow');
    }
    return `hook-enforced policy active (${allow.length} explicit allow entries)`;
  },

  'permissions-deny-dangerous': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const permissionHooks = cfg?.hooks?.PermissionRequest;
    const preToolHooks = cfg?.hooks?.PreToolUse;
    if (!Array.isArray(permissionHooks) || permissionHooks.length === 0) {
      throw new Error('PermissionRequest approval-floor hook is not wired');
    }
    if (!Array.isArray(preToolHooks) || preToolHooks.length === 0) {
      throw new Error('PreToolUse safety hooks are not wired');
    }
    return 'hook-enforced approval and destructive-action floor wired';
  },

  'hooks-pretooluse-wired': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const arr = cfg?.hooks?.PreToolUse;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('no PreToolUse hooks wired in settings.json');
    }
    const m = arr.find((h) => h.matcher === '*'
      || (h.matcher && h.matcher.includes('Write') && h.matcher.includes('Edit')));
    if (!m) throw new Error('PreToolUse matcher does not cover Write and Edit');
    return `${arr.length} PreToolUse hook(s) wired (matcher: ${m.matcher})`;
  },

  'hooks-posttooluse-wired': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const arr = cfg?.hooks?.PostToolUse;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('no PostToolUse hooks wired in settings.json');
    }
    return `${arr.length} PostToolUse hook(s) wired`;
  },

  'hooks-sessionstart-wired': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const arr = cfg?.hooks?.SessionStart;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('no SessionStart hooks wired in settings.json');
    }
    return `${arr.length} SessionStart hook(s) wired`;
  },

  'hooks-userpromptsubmit-wired': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const arr = cfg?.hooks?.UserPromptSubmit;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('no UserPromptSubmit hooks wired in settings.json');
    }
    return `${arr.length} UserPromptSubmit hook(s) wired`;
  },

  'hooks-sessionend-wired': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const arr = cfg?.hooks?.SessionEnd;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('no SessionEnd hook wired in settings.json');
    }
    return `${arr.length} SessionEnd hook(s) wired`;
  },

  'hooks-complete-lifecycle': async () => {
    const cfg = readJsonSafe(settingsJsonPath());
    const required = [
      'UserPromptSubmit', 'SessionStart', 'PreToolUse', 'PermissionRequest',
      'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop',
      'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'PreCompact', 'Stop',
      'SessionEnd',
    ];
    const missing = required.filter((event) => !Array.isArray(cfg?.hooks?.[event]) || cfg.hooks[event].length === 0);
    if (missing.length > 0) throw new Error(`missing lifecycle events: ${missing.join(', ')}`);
    return `all ${required.length} lifecycle events wired`;
  },

  'agent-files-installed': async () => {
    const dir = join(claudeDir(), 'agents');
    if (!existsSync(dir)) throw new Error(`agents dir missing: ${dir}`);
    const missing = REQUIRED_AGENTS.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`missing: ${missing.join(', ')}`);
    return `all ${REQUIRED_AGENTS.length} agents present in ${dir}`;
  },

  'agent-frontmatter-format': async () => {
    const dir = join(claudeDir(), 'agents');
    if (!existsSync(dir)) throw new Error('agents dir missing');
    const names = new Map();
    for (const file of REQUIRED_AGENTS) {
      const text = readFileSync(join(dir, file), 'utf8');
      if (!text.startsWith('---')) {
        throw new Error(`${file} has no YAML frontmatter`);
      }
      const name = /^name:\s*([^\s]+)\s*$/m.exec(text)?.[1];
      if (!name) throw new Error(`${file} has no frontmatter name`);
      if (names.has(name)) throw new Error(`duplicate agent name ${name}: ${names.get(name)}, ${file}`);
      names.set(name, file);
    }
    return `${names.size} unique agent names`;
  },

  'slash-commands-installed': async () => {
    const dir = join(claudeDir(), 'commands');
    if (!existsSync(dir)) throw new Error(`commands dir missing: ${dir}`);
    const missing = REQUIRED_COMMANDS.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) {
      throw new Error(`missing: ${missing.join(', ')} — run \`bizar update\``);
    }
    return `all ${REQUIRED_COMMANDS.length} slash commands present`;
  },

  'team-command-present': async () => {
    const team = join(claudeDir(), 'commands', 'team.md');
    if (!existsSync(team)) throw new Error(`${team} missing — run \`bizar update\``);
    return '/team command installed';
  },

  'test-command-present': async () => {
    const testCmd = join(claudeDir(), 'commands', 'test.md');
    if (!existsSync(testCmd)) throw new Error(`${testCmd} missing — run \`bizar update\``);
    return '/test command installed';
  },

  'validate-command-present': async () => {
    const v = join(claudeDir(), 'commands', 'validate.md');
    if (!existsSync(v)) throw new Error(`${v} missing — run \`bizar update\``);
    return '/validate command installed';
  },

  'skills-installed': async () => {
    const dir = join(claudeDir(), 'skills');
    if (!existsSync(dir)) throw new Error(`skills dir missing: ${dir} — run \`bizar update\``);
    const entries = readdirSync(dir, { withFileTypes: true });
    const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (skills.length === 0) throw new Error('no skills installed — run `bizar update`');
    return `${skills.length} skill(s) installed: ${skills.slice(0, 5).join(', ')}${skills.length > 5 ? '...' : ''}`;
  },

  'rules-installed': async () => {
    const dir = join(claudeDir(), 'rules');
    if (!existsSync(dir)) throw new Error(`rules dir missing: ${dir} — run \`bizar update\``);
    const entries = readdirSync(dir).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    if (entries.length === 0) throw new Error('no rules installed — run `bizar update`');
    return `${entries.length} rule file(s): ${entries.join(', ')}`;
  },

  'hooks-installed': async () => {
    const dir = join(claudeDir(), 'hooks');
    if (!existsSync(dir)) throw new Error(`hooks dir missing: ${dir} — run \`bizar update\``);
    const missing = REQUIRED_HOOKS.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) {
      throw new Error(`missing: ${missing.join(', ')} — run \`bizar update\``);
    }
    // Verify hooks are executable. On Windows, chmod is a no-op so
    // skip the check there.
    if (process.platform !== 'win32') {
      const nonExec = [];
      for (const f of REQUIRED_HOOKS) {
        try {
          const st = statSync(join(dir, f));
          // 0o755 = owner=rwx, group=r-x, other=r-x. Just check owner has x.
          if ((st.mode & 0o100) === 0) nonExec.push(f);
        } catch {
          nonExec.push(f);
        }
      }
      if (nonExec.length > 0) {
        throw new Error(`hooks not executable: ${nonExec.join(', ')} — run \`chmod +x ~/.claude/hooks/*\``);
      }
    }
    return `all ${REQUIRED_HOOKS.length} Claude Code hook file(s) executable in ${dir}`;
  },

  'bizar-home-exists': async () => {
    const h = bizarHome();
    if (!existsSync(h)) {
      throw new Error(`BIZAR_HOME missing at ${h} — run \`bizar install\``);
    }
    return `BIZAR_HOME = ${h}`;
  },

  'provider-reachable': async () => {
    const { endpoint, authToken } = resolveEndpoint();
    if (!endpoint) {
      const path = resolveGlobalModelRouter();
      const router = readJsonSafe(path);
      const fallback = router ? configuredEnabledModels(router) : [];
      if (fallback.length === 0) {
        throw new Error(`no gateway URL or enabled configured model in ${path}; implicit defaults are prohibited`);
      }
      return `no gateway URL; explicit configured fallback is ${fallback[0]}`;
    }
    try {
      const models = await listModels({ endpoint, authToken, timeoutMs: 4000 });
      return `provider reachable at ${endpoint} (${models.length} models)`;
    } catch (err) {
      throw new Error(`provider at ${endpoint} unreachable: ${err.message ?? err}`);
    }
  },

  'claude-md-mirrored': async () => {
    const f = join(claudeDir(), 'CLAUDE.md');
    if (!existsSync(f)) {
      throw new Error(`${f} missing — run \`bizar install\` to mirror AGENTS.md`);
    }
    const stat = statSync(f);
    if (stat.size < 200) throw new Error(`${f} is suspiciously small (${stat.size} bytes)`);
    return `CLAUDE.md mirrored (${stat.size} bytes)`;
  },
};

const CHECK_ORDER = [
  'claude-cli-reachable',
  'claude-settings-exists',
  'claude-settings-parses',
  'claude-settings-schema',
  'mcp-server-bizar-registered',
  'mcp-server-bizar-command',
  'permissions-policy-current',
  'permissions-deny-dangerous',
  'hooks-pretooluse-wired',
  'hooks-posttooluse-wired',
  'hooks-sessionstart-wired',
  'hooks-userpromptsubmit-wired',
  'hooks-sessionend-wired',
  'hooks-complete-lifecycle',
  'agent-files-installed',
  'agent-frontmatter-format',
  'slash-commands-installed',
  'team-command-present',
  'test-command-present',
  'validate-command-present',
  'skills-installed',
  'rules-installed',
  'hooks-installed',
  'bizar-home-exists',
  'claude-md-mirrored',
  'provider-reachable',
];

const LENIENT_CHECKS = new Set([
  'claude-cli-reachable', // Claude Code CLI is normally on $PATH only on dev hosts; CI containers without it shouldn't fail validation
  'provider-reachable',
  'claude-settings-schema', // advisory — schema field is documentation
]);

export function showValidateHelp() {
  console.log(`
  bizar validate — Validate the Bizar install end-to-end.

  Usage:
    bizar validate                Run the full check battery (default)
    bizar validate --json         Machine-readable JSON output
    bizar validate --strict       Fail on lenient checks (e.g. provider gateway offline)
    bizar validate --only <name>  Run only the named check (e.g. team-command-present)
    bizar validate --help         Show this help

  Description:
    A complete health check that confirms the Bizar install is fully
    integrated with Claude Code:
      • claude CLI reachable + version
      • ~/.claude/settings.json parses + Bizar MCP server registered
      • permissions follow the current hook-enforced policy
      • hook-enforced approval and destructive-action floor
      • all 14 Claude Code lifecycle events wired in settings.json
      • all shipped agent files installed with unique Claude Code names
      • all shipped slash commands
      • all skills / rules / hooks mirrored to ~/.claude/
      • ~/.config/bizar/ runtime state ready
      • configured provider gateway reachable (lenient unless --strict)

  Exit codes:
    0  All checks passed (or only lenient ones failed)
    1  One or more strict checks failed
    2  Invalid --only argument

  Related:
    bizar doctor          Concise install-integrity check
    bizar update          Refresh the install (re-runs the provisioner)
    bizar repair          Fix common issues (stale symlinks, version drift)
  `);
}

export async function runValidate(opts = {}) {
  const json = !!opts.json;
  const strict = !!opts.strict;
  const only = typeof opts.only === 'string' && opts.only.trim() ? opts.only.trim() : null;
  const list = only ? [only] : CHECK_ORDER;
  if (only && !CHECKS[only]) {
    console.error(chalk.red(`  ✗ Unknown check: ${only}`));
    console.error(chalk.dim(`  Run \`bizar validate\` to see all available checks.`));
    process.exit(2);
    return;
  }

  const results = [];
  for (const name of list) {
    const fn = CHECKS[name];
    if (!fn) continue;
    const r = await check(name, fn);
    results.push(r);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 2) + '\n');
    const failed = results.filter((r) => !r.ok).length;
    const strictFailed = results.filter((r) => !r.ok && !LENIENT_CHECKS.has(r.name)).length;
    process.exit(strict ? (failed > 0 ? 1 : 0) : (strictFailed > 0 ? 1 : 0));
    return;
  }

  for (const r of results) {
    const isLenient = LENIENT_CHECKS.has(r.name);
    const marker = r.ok ? chalk.green('✓') : (isLenient ? chalk.yellow('⚠') : chalk.red('✗'));
    const label = r.name.padEnd(32);
    const msg = r.ok ? chalk.dim(`  ${r.message}`) : (isLenient ? chalk.yellow(`  ${r.message}`) : chalk.red(`  ${r.message}`));
    console.log(`  ${marker} ${label}${msg}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const strictFailed = results.filter((r) => !r.ok && !LENIENT_CHECKS.has(r.name)).length;
  console.log('');
  if (strictFailed === 0 && (failed === 0 || (!strict && failed === results.filter((r) => LENIENT_CHECKS.has(r.name)).length))) {
    console.log(chalk.green(`  ✓ ${passed} checks passed, ${failed} lenient warning(s)`));
    process.exit(0);
  } else {
    console.log(chalk.yellow(`  ⚠ ${passed} checks passed, ${failed} failed (${strictFailed} strict)`));
    console.log(chalk.dim(`  Run \`bizar update\` to refresh the install, or \`bizar repair\` for common fixes.`));
    process.exit(1);
  }
}

// ── run() entry point (used by bin.mjs dispatcher) ───────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name !== 'validate') return false;
  if (isHelpRequest) {
    showValidateHelp();
    return true;
  }
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  await runValidate({ json, strict, only });
  return true;
}
