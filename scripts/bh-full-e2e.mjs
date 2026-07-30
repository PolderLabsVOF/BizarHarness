#!/usr/bin/env node
/**
 * End-to-end smoke test for the Claude Code-native harness.
 *
 * This proves the package's actual runtime boundary: SDK + stdio MCP,
 * project settings, shipped agents/skills/hooks, and removed-surface
 * invariants. It deliberately starts no daemon or web service.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(42)} ${detail}`);
}

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const detail = result.status === 0
    ? `${command} ${args.join(' ')} exited 0`
    : (result.stderr || result.stdout || `exit ${result.status}`).trim().split('\n').slice(-1)[0];
  check(name, result.status === 0, detail);
}

console.log('\n  BIZAR E2E — Claude Code core harness\n');

const settingsPath = join(ROOT, '.claude', 'settings.json');
try {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const events = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'PreCompact', 'SubagentStart'];
  const missing = events.filter((event) => !Array.isArray(settings.hooks?.[event]));
  check('settings and lifecycle hooks', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${events.length} events wired`);
  check('human approval policy', settings.permissions?.defaultMode === 'acceptEdits' && settings.permissions?.ask?.some((v) => v.includes('git commit')), 'acceptEdits + explicit mutation asks');
  check('Bizar MCP registration', settings.mcpServers?.bizar?.args?.includes('@polderlabs/bizar-sdk'), 'stdio SDK command configured');
} catch (error) {
  check('settings parse', false, error.message);
}

const agents = readdirSync(join(ROOT, '.claude', 'agents')).filter((name) => name.endsWith('.md'));
const agentNames = agents.map((file) => {
  const source = readFileSync(join(ROOT, '.claude', 'agents', file), 'utf8');
  return /^name:\s*([^\s]+)\s*$/m.exec(source)?.[1];
});
check(
  'shipped agents',
  agents.length === 16 && agentNames.every(Boolean) && new Set(agentNames).size === agents.length,
  `${agents.length} unique agent definitions`,
);

const canonicalSkills = readdirSync(join(ROOT, 'config', 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const mirroredSkills = readdirSync(join(ROOT, '.claude', 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
check('skill mirror', JSON.stringify(canonicalSkills) === JSON.stringify(mirroredSkills), `${canonicalSkills.length} canonical skills`);

const requiredHooks = [
  'advisor-context.mjs',
  'content-style-guard.mjs',
  'git-workflow-guard.mjs',
  'precompact-priorities.sh',
  'simplify-guard.mjs',
  'telemetry.mjs',
];
const missingHooks = requiredHooks.filter((name) => !existsSync(join(ROOT, '.claude', 'hooks', name)));
check('ported workflow hooks', missingHooks.length === 0, missingHooks.length ? `missing ${missingHooks.join(', ')}` : `${requiredHooks.length} hooks present`);

const requiredTools = [
  'plan_action',
  'loop_list', 'loop_status', 'loop_start', 'loop_stop',
  'graph_query', 'graph_path',
  'list_instincts', 'list_decisions',
];
const { BIZAR_TOOLS } = await import('../packages/sdk/dist/mcp/server.js');
const toolNames = new Set(BIZAR_TOOLS.map((tool) => tool.name));
const missingTools = requiredTools.filter((name) => !toolNames.has(name));
check('MCP tool surface', missingTools.length === 0, missingTools.length ? `missing ${missingTools.join(', ')}` : `${requiredTools.length} tools`);

run('SDK typecheck', process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'packages/sdk/tsconfig.json']);
run('removed-surface verifier', process.execPath, ['scripts/verify-removed-surfaces.mjs']);
const hookTests = readdirSync(join(ROOT, '.claude', 'hooks', '__tests__'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => join('.claude', 'hooks', '__tests__', name));
run('hook guard tests', process.execPath, ['--test', '--test-concurrency=1', ...hookTests]);

const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
