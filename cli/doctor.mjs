/**
 * cli/doctor.mjs
 *
 * v6.3.0 — `bizar doctor` subcommand (Claude Code-native).
 *
 * Runs a battery of health checks against the local Bizar / Claude Code
 * install and reports pass/fail for each. Returns a structured summary
 * suitable for callers (e.g. `bizar update`) that want to act on the
 * result without re-printing the per-check output.
 *
 * Checks:
 *   claude-cli-reachable:    claude --version exits 0
 *   settings-valid:          ~/.claude/settings.json parses
 *   mcp-server-registered:   settings.json has mcpServers.bizar
 *   hooks-wired:             every shipped lifecycle event is wired
 *   agent-files-installed:   all shipped agent .md files are deployed
 *   command-files-installed: all shipped slash commands are deployed
 *   skill-files-installed:   skills include the default output skill
 *   rule-files-installed:    all shipped rule files are deployed
 *   hook-files-installed:    all shipped hook entrypoints are executable
 *   tools-on-path:           at least one of semble/skills/claude
 *   bizar-home:              BIZAR_HOME exists
 *   provider-reachable:       provider gateway responds
 *
 * Usage:
 *   import { runDoctor } from "./doctor.mjs";
 *   const r = await runDoctor();
 *   const r = await runDoctor({ silent: true });
 */
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveBizarHome,
  resolveClaudeConfigDir,
  resolveGlobalModelRouter,
} from './config-paths.mjs';
import {
  REQUIRED_AGENTS,
  REQUIRED_COMMANDS,
  REQUIRED_HOOKS,
} from './commands/validate.mjs';
import { configuredFallbackModels } from './commands/models.mjs';

const REQUIRED_RULES = [
  'general.md', 'git.md', 'javascript.md', 'python.md',
  'testing.md', 'thinking.md', 'uncertainty.md',
];
const REQUIRED_HOOK_EVENTS = [
  'UserPromptSubmit', 'SessionStart', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'PreCompact', 'Stop',
  'SessionEnd',
];

function claudeDir() {
  return resolveClaudeConfigDir();
}

function bizarHome() {
  return resolveBizarHome();
}

// ── individual checks ───────────────────────────────────────────────────────

async function checkClaudeReachable() {
  const r = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status !== 0) {
    throw new Error(`claude --version exited ${r.status}`);
  }
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || 'claude available';
}

async function checkSettingsValid() {
  const cfgPath = join(claudeDir(), 'settings.json');
  if (!existsSync(cfgPath)) {
    throw new Error(`not found at ${cfgPath}`);
  }
  try {
    JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }
  return 'settings.json parses';
}

async function checkMcpServerRegistered() {
  const cfgPath = join(claudeDir(), 'settings.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const servers = cfg.mcpServers || {};
  if (!servers.bizar) {
    throw new Error('mcpServers.bizar missing from settings.json');
  }
  return `bizar MCP server registered (${servers.bizar.command ?? '?'})`;
}

async function checkHooksWired() {
  const cfgPath = join(claudeDir(), 'settings.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const hooks = cfg.hooks || {};
  const missing = REQUIRED_HOOK_EVENTS.filter((e) => !Array.isArray(hooks[e]) || hooks[e].length === 0);
  if (missing.length > 0) {
    throw new Error(`missing hook events: ${missing.join(', ')}`);
  }
  return `${REQUIRED_HOOK_EVENTS.length} lifecycle hook events wired`;
}

async function checkAgentFilesInstalled() {
  const dir = join(claudeDir(), 'agents');
  if (!existsSync(dir)) {
    throw new Error(`agents dir missing: ${dir}`);
  }
  const missing = REQUIRED_AGENTS.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`missing agents: ${missing.join(', ')} — run \`bizar update\``);
  return `all ${REQUIRED_AGENTS.length} agents installed`;
}

async function checkCommandFilesInstalled() {
  const dir = join(claudeDir(), 'commands');
  const missing = REQUIRED_COMMANDS.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`missing commands: ${missing.join(', ')} — run \`bizar update\``);
  return `all ${REQUIRED_COMMANDS.length} slash commands installed`;
}

async function checkSkillFilesInstalled() {
  const dir = join(claudeDir(), 'skills');
  if (!existsSync(dir)) {
    throw new Error(`skills dir missing: ${dir}`);
  }
  const skills = readdirSync(dir).filter((d) => {
    const fp = join(dir, d, 'SKILL.md');
    return existsSync(fp);
  });
  if (!skills.includes('i-have-adhd')) throw new Error('default i-have-adhd skill missing — run `bizar update`');
  return `${skills.length} skills installed, including i-have-adhd`;
}

async function checkRuleFilesInstalled() {
  const dir = join(claudeDir(), 'rules');
  const missing = REQUIRED_RULES.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`missing rules: ${missing.join(', ')} — run \`bizar update\``);
  return `all ${REQUIRED_RULES.length} rules installed`;
}

async function checkHookFilesInstalled() {
  const dir = join(claudeDir(), 'hooks');
  const missing = REQUIRED_HOOKS.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`missing hooks: ${missing.join(', ')} — run \`bizar update\``);
  if (process.platform !== 'win32') {
    const nonExecutable = REQUIRED_HOOKS.filter((file) => (statSync(join(dir, file)).mode & 0o100) === 0);
    if (nonExecutable.length > 0) throw new Error(`hooks not executable: ${nonExecutable.join(', ')}`);
  }
  return `all ${REQUIRED_HOOKS.length} hook entrypoints installed`;
}

/**
 * Lenient: passes if at least one of semble/skills/claude is on PATH.
 * These are informational — none of them are strictly required for
 * `bizar doctor` to do its job, and missing them shouldn't fail the
 * overall health report.
 */
async function checkToolsAvailable() {
  const tools = ['semble', 'skills', 'claude'];
  const found = tools.filter(which);
  if (found.length === 0) {
    throw new Error(`none of ${tools.join('/')} on PATH`);
  }
  return `available: ${found.join(', ')}`;
}

async function checkBizarHome() {
  const dir = bizarHome();
  if (!existsSync(dir)) {
    throw new Error(`BIZAR_HOME missing: ${dir}`);
  }
  return `BIZAR_HOME present at ${dir}`;
}

async function checkProviderReachable() {
  const url = process.env.ANTHROPIC_BASE_URL || process.env.BIZAR_MODEL_ROUTER_URL;
  if (!url) {
    const routerPath = resolveGlobalModelRouter();
    let router;
    try {
      router = JSON.parse(readFileSync(routerPath, 'utf8'));
    } catch {
      throw new Error(`no provider URL and no readable global model router at ${routerPath}`);
    }
    const configured = configuredFallbackModels(router);
    if (configured.length === 0) {
      throw new Error('no enabled configured model; implicit provider defaults are prohibited');
    }
    return `no gateway URL; explicit configured fallback is ${configured[0]}`;
  }
  let res;
  try {
    res = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    throw new Error(`provider at ${url} unreachable: ${err.message ?? err}`);
  }
  if (!res.ok) {
    throw new Error(`provider at ${url} responded HTTP ${res.status}`);
  }
  return `provider at ${url} ok`;
}

// ── runner ──────────────────────────────────────────────────────────────────

const CHECKS = [
  { name: 'claude-cli-reachable',       run: checkClaudeReachable },
  { name: 'settings-valid',            run: checkSettingsValid },
  { name: 'mcp-server-registered',     run: checkMcpServerRegistered },
  { name: 'hooks-wired',               run: checkHooksWired },
  { name: 'agent-files-installed',     run: checkAgentFilesInstalled },
  { name: 'command-files-installed',   run: checkCommandFilesInstalled },
  { name: 'skill-files-installed',     run: checkSkillFilesInstalled },
  { name: 'rule-files-installed',      run: checkRuleFilesInstalled },
  { name: 'hook-files-installed',      run: checkHookFilesInstalled },
  { name: 'tools-on-path',             run: checkToolsAvailable },
  { name: 'bizar-home',                run: checkBizarHome },
  { name: 'provider-reachable',        run: checkProviderReachable },
];

export async function runDoctor(opts = {}) {
  const silent = !!opts.silent;
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const check of CHECKS) {
    let result;
    try {
      const message = await check.run();
      result = { name: check.name, ok: true, message: message ?? 'ok' };
    } catch (err) {
      result = { name: check.name, ok: false, message: err?.message ?? String(err) };
    }
    results.push(result);
    if (result.ok) passed += 1;
    else failed += 1;

    if (!silent) {
      const tag = result.ok ? chalk.green('  ✔ ') : chalk.red('  ✖ ');
      process.stdout.write(`${tag}${check.name}${result.ok ? '' : ` — ${result.message}`}\n`);
    }
  }

  if (!silent) {
    const summary = chalk.bold(
      failed > 0
        ? chalk.red(`${failed} checks failed, ${passed} passed`)
        : chalk.green(`${passed} checks passed`),
    );
    process.stdout.write(`\n${summary}\n`);
  }

  return { passed, failed, results };
}

// ── helper ──────────────────────────────────────────────────────────────────

function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 && !!r.stdout?.trim();
}

// Stand-alone CLI invocation (so `bizar doctor` still works when imported
// without the bin dispatcher).
if (import.meta.url === `file://${process.argv[1]}`) {
  const silent = process.argv.includes('--silent');
  runDoctor({ silent }).then(({ failed }) => {
    process.exit(failed === 0 ? 0 : 1);
  });
}
