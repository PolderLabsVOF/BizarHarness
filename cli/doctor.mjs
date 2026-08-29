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
 * Checks (8 total):
 *   claude-cli-reachable:    claude --version exits 0
 *   settings-valid:          ~/.claude/settings.json parses
 *   mcp-server-registered:   settings.json has mcpServers.bizar
 *   hooks-wired:             settings.json has PreToolUse/PostToolUse/etc
 *   agent-files-installed:   agent .md files deployed
 *   skill-files-installed:   SKILL.md files deployed
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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const BIZAR_HOME = process.env.BIZAR_HOME
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'bizar');

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
  const cfgPath = join(CLAUDE_DIR, 'settings.json');
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
  const cfgPath = join(CLAUDE_DIR, 'settings.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const servers = cfg.mcpServers || {};
  if (!servers.bizar) {
    throw new Error('mcpServers.bizar missing from settings.json');
  }
  return `bizar MCP server registered (${servers.bizar.command ?? '?'})`;
}

async function checkHooksWired() {
  const cfgPath = join(CLAUDE_DIR, 'settings.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const hooks = cfg.hooks || {};
  const required = ['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit'];
  const missing = required.filter((e) => !Array.isArray(hooks[e]) || hooks[e].length === 0);
  if (missing.length > 0) {
    throw new Error(`missing hook events: ${missing.join(', ')}`);
  }
  return `hooks wired: ${required.join(', ')}`;
}

async function checkAgentFilesInstalled() {
  const dir = join(CLAUDE_DIR, 'agents');
  if (!existsSync(dir)) {
    throw new Error(`agents dir missing: ${dir}`);
  }
  const have = readdirSync(dir).filter((f) => f.endsWith('.md'));
  if (have.length === 0) {
    throw new Error('no agent .md files installed');
  }
  return `${have.length} agents installed: ${have.slice(0, 4).join(', ')}${have.length > 4 ? '…' : ''}`;
}

async function checkSkillFilesInstalled() {
  const dir = join(CLAUDE_DIR, 'skills');
  if (!existsSync(dir)) {
    throw new Error(`skills dir missing: ${dir}`);
  }
  const skills = readdirSync(dir).filter((d) => {
    const fp = join(dir, d, 'SKILL.md');
    return existsSync(fp);
  });
  if (skills.length === 0) {
    throw new Error('no SKILL.md files found');
  }
  return `${skills.length} skills installed`;
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
  if (!existsSync(BIZAR_HOME)) {
    throw new Error(`BIZAR_HOME missing: ${BIZAR_HOME}`);
  }
  return `BIZAR_HOME present at ${BIZAR_HOME}`;
}

async function checkProviderReachable() {
  const url = process.env.ANTHROPIC_BASE_URL || process.env.BIZAR_MODEL_ROUTER_URL;
  if (!url) {
    return 'provider gateway not configured (using session default)';
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
  { name: 'skill-files-installed',     run: checkSkillFilesInstalled },
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
