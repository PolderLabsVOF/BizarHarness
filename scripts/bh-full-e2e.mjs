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

const settingsPath = join(ROOT, 'config', 'claude', 'settings.json');
try {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const events = [
    'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure',
    'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'PreCompact',
    'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
    'TeammateIdle', 'Stop',
  ];
  const missing = events.filter((event) => !Array.isArray(settings.hooks?.[event]));
  check('settings and lifecycle hooks', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${events.length} events wired`);
  const { EVENT_CHAINS } = await import('../cli/commands/hook.mjs');
  // F-169: the shipped template routes every hook through either the
  // wrapper shim (sh -c probe or absolute wrapper path) instead of a
  // bare `bizar hook <sub>` invocation. The guard-wire check therefore
  // accepts either form but rejects bare `bizar hook` strings.
  const preToolUseWired = (settings.hooks?.PreToolUse || []).some((group) =>
    (group.hooks || []).some((hook) =>
      hook.command && hook.command.includes('pre-tool-use')
      && !/^bizar hook [a-z0-9-]+$/.test(hook.command.trim())
    ));
  const guardWired = preToolUseWired
    && EVENT_CHAINS['pre-tool-use'].includes('git-workflow-guard');
  const guardedCommands = ['git commit -m "test: approval boundary"', 'git push origin main', 'npm publish --access public'];
  const guardDecisions = guardedCommands.map((command) => {
    const result = spawnSync(process.execPath, [join(ROOT, 'cli', 'bin.mjs'), 'hook', 'pre-tool-use'], {
      cwd: ROOT,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        cwd: ROOT,
        tool_input: { command },
      }),
      timeout: 5_000,
    });
    if (result.status !== 0) return `exit:${result.status}`;
    try {
      return JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision;
    } catch {
      return 'invalid-output';
    }
  });
  check(
    'human approval policy',
    ['acceptEdits', 'bypassPermissions'].includes(settings.permissions?.defaultMode)
      && guardWired
      && JSON.stringify(guardDecisions) === JSON.stringify(['allow', 'allow', 'allow']),
    guardWired
      ? `git-workflow-guard decisions: ${guardDecisions.join(', ')}`
      : 'git-workflow-guard is not wired for Bash PreToolUse',
  );
  check('Bizar MCP registration', settings.mcpServers?.bizar?.args?.includes('@polderlabs/bizar-sdk'), 'stdio SDK command configured');
  const controlEvents = [
    ['SessionStart', 'session-start'],
    ['UserPromptSubmit', 'user-prompt-submit'],
  ];
  const missingControlEvents = controlEvents
    .filter(([event, dispatcher]) =>
      !(settings.hooks?.[event] || []).some((group) =>
        (group.hooks || []).some((hook) =>
          hook.command && hook.command.includes(dispatcher)
          && !/^bizar hook [a-z0-9-]+$/.test(hook.command.trim())
        ))
      || !EVENT_CHAINS[dispatcher].includes('control-inbox'))
    .map(([event]) => event);
  check(
    'OpenKan control inbox',
    missingControlEvents.length === 0,
    missingControlEvents.length
      ? `missing from ${missingControlEvents.join(', ')}`
      : 'durable messages inject at supported hook boundaries',
  );
} catch (error) {
  check('settings parse', false, error.message);
}

const agents = readdirSync(join(ROOT, 'config', 'claude', 'agents')).filter((name) => name.endsWith('.md'));
const agentSources = agents.map((file) => {
  const source = readFileSync(join(ROOT, 'config', 'claude', 'agents', file), 'utf8');
  return { file, source, name: /^name:\s*([^\s]+)\s*$/m.exec(source)?.[1] };
});
const agentNames = agentSources.map(({ name }) => name);
check(
  'shipped agents',
  agents.length === 85 && agentNames.every(Boolean) && new Set(agentNames).size === agents.length,
  `${agents.length} unique agent definitions`,
);
const ungroundedAgents = agentSources
  .filter(({ source }) =>
    !/^tools:\s*.*\bWebSearch\b.*$/m.test(source)
    || !/AGENT_BASELINE|agent-baseline/i.test(source))
  .map(({ file }) => file);
check(
  'agent documentation grounding',
  ungroundedAgents.length === 0,
  ungroundedAgents.length
    ? `missing policy/tool: ${ungroundedAgents.join(', ')}`
    : `${agents.length} agents have WebSearch + baseline`,
);

const canonicalSkills = readdirSync(join(ROOT, 'config', 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const mirroredSkills = readdirSync(join(ROOT, 'config', 'claude', 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
check('skill mirror', JSON.stringify(canonicalSkills) === JSON.stringify(mirroredSkills), `${canonicalSkills.length} canonical skills`);

const requiredHooks = [
  'agent-grounding.mjs',
  'agent-model-guard.mjs',
  'advisor-context.mjs',
  'bizar-hook-wrapper.sh',
  'control-inbox.mjs',
  'content-style-guard.mjs',
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
  'completion-artifact.mjs',
];
const missingHooks = requiredHooks.filter((name) => !existsSync(join(ROOT, 'config', 'claude', 'hooks', name)));
check('ported workflow hooks', missingHooks.length === 0, missingHooks.length ? `missing ${missingHooks.join(', ')}` : `${requiredHooks.length} hooks present`);

const requiredTools = [
  'plan_action',
  'loop_list', 'loop_status', 'loop_start', 'loop_stop',
  'graph_query', 'graph_path',
  'list_instincts', 'list_decisions',
  'bizar_task', 'bizar_workflow', 'bizar_control', 'bizar_audit',
  'bizar_model_list',
];
const { BIZAR_TOOLS } = await import('../packages/sdk/dist/mcp/server.js');
const toolNames = new Set(BIZAR_TOOLS.map((tool) => tool.name));
const missingTools = requiredTools.filter((name) => !toolNames.has(name));
check('MCP tool surface', missingTools.length === 0, missingTools.length ? `missing ${missingTools.join(', ')}` : `${requiredTools.length} tools`);

run('SDK typecheck', process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'packages/sdk/tsconfig.json']);
run('removed-surface verifier', process.execPath, ['scripts/verify-removed-surfaces.mjs']);
const hookTests = readdirSync(join(ROOT, 'config', 'claude', 'hooks', '__tests__'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => join('config', 'claude', 'hooks', '__tests__', name));
run('hook guard tests', process.execPath, ['--test', '--test-concurrency=1', ...hookTests]);
run('control plane tests', process.execPath, [
  '--test',
  '--test-concurrency=1',
  'cli/control-store.test.mjs',
  'cli/control-inbox-hook.test.mjs',
  'cli/commands/control.test.mjs',
]);

const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
