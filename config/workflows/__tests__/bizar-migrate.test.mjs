/**
 * config/workflows/__tests__/bizar-migrate.test.mjs
 *
 * Capture stub for the `bizar-migrate` native workflow. Drives the
 * workflow through a mocked `agent()` runtime and asserts:
 *   - meta export shape (name, description, whenToUse, >=5 phases),
 *   - self-contained source (no static or dynamic imports),
 *   - return value matches `{ status, migration, contract, waves, verification }`
 *     with `status: 'ready-for-integration'`,
 *   - >= 4 distinct agent() calls per run,
 *   - every captured agent() payload carries a static alias `model` and
 *     a forwarded `routingDecisionId`,
 *   - phases fire in declared order, parallel() fans out Inventory and
 *     Wave-2, and Wave-1 / Wave-2 / Wave-3 lanes run in worktree
 *     isolation routed to `todd` (implementer).
 *
 * Run with `node --test config/workflows/__tests__/bizar-migrate.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');
const WORKFLOW_FILE = resolve(workflowsDir, 'bizar-migrate.js');

const STATIC_ALIASES = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);

function loadSource() {
  return readFileSync(WORKFLOW_FILE, 'utf8');
}

function extractMeta(source) {
  const start = source.search(/export\s+const\s+meta\s*=\s*\{/);
  if (start < 0) throw new Error('meta export not found');
  const open = source.indexOf('{', start);
  let depth = 0;
  let inString = null;
  let escape = false;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('meta export braces unbalanced');
  return new Function(`return (${source.slice(open, end + 1)});`)();
}

function extractBody(source) {
  const importRegex = /^\s*import\s+(?:\{([^}]+)\}|([^\s{]+))\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
  const metaStart = source.search(/export\s+const\s+meta\s*=\s*\{/);
  if (metaStart < 0) throw new Error('meta export not found');
  const open = source.indexOf('{', metaStart);
  let depth = 0;
  let inString = null;
  let escape = false;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('meta braces unbalanced');
  return source.slice(end + 1).replace(importRegex, '').trim();
}

function makeRuntime(args) {
  const calls = [];
  const phase = (name) => calls.push({ primitive: 'phase', name });
  const log = (...rest) => calls.push({ primitive: 'log', args: rest });

  function buildStub(opts) {
    const label = opts?.label || '';
    if (label === 'inventory:repo' || label === 'inventory:docs') {
      return {
        summary: 'stub inventory summary',
        files: ['stub/file.ts'],
        interfaces: ['StubInterface'],
        breakingChanges: ['StubBreaking'],
      };
    }
    if (label === 'contract:author' || label === 'contract:audit') {
      return {
        contract: 'stub contract body',
        owners: ['stub-owner'],
        boundary: 'stub boundary',
      };
    }
    if (label === 'wave1:interface' || label.startsWith('wave2:') || label === 'wave3:cleanup') {
      return { stub: true, label, files: ['changed.ts'], summary: 'stub wave result' };
    }
    if (label === 'verification:final') {
      return { verified: true, summary: 'stub verification', conflicts: [], remainingGates: [] };
    }
    return { stub: true, label };
  }

  const agent = async (prompt, opts) => {
    const header = typeof prompt === 'string'
      ? prompt.match(/^\[Bizar dispatch \d+: [^;]+; role=([^;]+); phase=([^;]+); label=([^\]]+)\]/)
      : null;
    const dispatchMeta = {
      role: header?.[1],
      phase: header?.[2],
      label: header?.[3],
      subagentType: opts?.subagent_type,
      isolation: opts?.isolation,
      model: opts?.model,
      routingDecisionId: opts?.routingDecisionId,
    };
    calls.push({ primitive: 'agent', ...dispatchMeta });
    return buildStub(dispatchMeta);
  };
  const parallel = async (fns) => {
    calls.push({ primitive: 'parallel', count: Array.isArray(fns) ? fns.length : 0 });
    return Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  };
  const pipeline = async () => {
    throw new Error('bizar-migrate.js must not invoke pipeline() at runtime');
  };
  return { calls, agent, parallel, pipeline, phase, log, args };
}

async function runWorkflow(args) {
  const source = loadSource();
  const body = extractBody(source);
  const runtime = makeRuntime(args);
  const fn = new Function(
    'args', 'agent', 'pipeline', 'parallel', 'phase', 'log',
    `return (async () => { ${body} })();`,
  );
  const result = await fn(
    runtime.args, runtime.agent, runtime.pipeline, runtime.parallel, runtime.phase, runtime.log,
  );
  return { result, calls: runtime.calls };
}

function agentCallsByLabel(calls, matcher) {
  return calls.filter((c) => {
    if (c.primitive !== 'agent') return false;
    const label = c.label || '';
    return typeof matcher === 'string' ? label === matcher : matcher.test(label);
  });
}

test('bizar-migrate: meta export shape (pure literal, 5 phases)', () => {
  const meta = extractMeta(loadSource());
  assert.equal(meta.name, 'bizar-migrate');
  assert.equal(typeof meta.description, 'string');
  assert.ok(meta.description.length > 0, 'description must be non-empty');
  assert.equal(typeof meta.whenToUse, 'string');
  assert.ok(meta.whenToUse.length > 0, 'whenToUse must be non-empty');
  assert.ok(Array.isArray(meta.phases));
  assert.ok(meta.phases.length >= 5, `phases must list >=5 stages (saw ${meta.phases.length})`);
  const titles = meta.phases.map((p) => p.title);
  assert.ok(titles.includes('Inventory'), 'must declare Inventory phase');
  assert.ok(titles.includes('Contract'), 'must declare Contract phase');
  assert.ok(titles.includes('Wave-1'), 'must declare Wave-1 phase');
  assert.ok(titles.includes('Wave-2'), 'must declare Wave-2 phase');
  assert.ok(titles.includes('Wave-3 + Verify'), 'must declare Wave-3 + Verify phase');
  for (const phase of meta.phases) {
    assert.equal(typeof phase.title, 'string');
    assert.equal(typeof phase.detail, 'string');
  }
});

test('bizar-migrate: source is self-contained (no static or dynamic imports)', () => {
  const source = loadSource();
  assert.ok(!/^\s*import\s/m.test(source), 'bizar-migrate.js must not contain static imports');
  assert.ok(!/\bimport\s*\(/.test(source), 'bizar-migrate.js must not contain dynamic imports');
});

test('bizar-migrate: returns ready-for-integration with the expected shape', async () => {
  const { result, calls } = await runWorkflow({
    from: 'js',
    to: 'ts',
    routingDecisionId: 'routing-test-123',
  });
  assert.equal(result.status, 'ready-for-integration');
  assert.equal(result.migration, 'Migrate from js to ts');
  assert.ok(result.contract && typeof result.contract === 'object');
  assert.ok(result.waves, 'result.waves must exist');
  assert.ok(result.waves.wave1, 'result.waves.wave1 must exist');
  assert.ok(Array.isArray(result.waves.wave2), 'result.waves.wave2 must be an array');
  assert.ok(result.waves.wave3, 'result.waves.wave3 must exist');
  assert.ok(result.verification, 'result.verification must exist');

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 4, `expected >=4 distinct agent() calls, saw ${agentCalls.length}`);
});

test('bizar-migrate: every agent() payload carries a static alias model + forwarded routingDecisionId', async () => {
  const ROUTING_ID = 'routing-decision-xyz-789';
  const { calls } = await runWorkflow({
    from: 'rest',
    to: 'grpc',
    routingDecisionId: ROUTING_ID,
  });
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 4, `expected >=4 distinct agent() calls, saw ${agentCalls.length}`);
  for (const call of agentCalls) {
    assert.ok(
      STATIC_ALIASES.includes(call.model),
      `every agent() call must carry a static alias model (saw ${call.model})`,
    );
    assert.equal(
      call.routingDecisionId,
      ROUTING_ID,
      `every agent() call must forward the routingDecisionId from args (saw ${call.routingDecisionId})`,
    );
  }
});

test('bizar-migrate: phases fire in declared order with parallel fan-out', async () => {
  const { calls } = await runWorkflow({
    from: 'vue2',
    to: 'vue3',
    wave2_modules: [
      { name: 'module-a', scope: ['a/**'], task: 'migrate a' },
      { name: 'module-b', scope: ['b/**'], task: 'migrate b' },
    ],
  });
  const phases = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
  assert.deepEqual(phases, ['Inventory', 'Contract', 'Wave-1', 'Wave-2', 'Wave-3 + Verify']);

  const parallelCalls = calls.filter((c) => c.primitive === 'parallel');
  assert.ok(parallelCalls.some((c) => c.count === 2), 'parallel() must fan out for Inventory (2 lanes)');
  assert.ok(parallelCalls.some((c) => c.count === 2), 'parallel() must fan out for Wave-2 (>=2 modules)');

  const wave2Agents = agentCallsByLabel(calls, /^wave2:/);
  assert.ok(wave2Agents.length >= 2, 'Wave-2 must dispatch at least 2 module lanes');
  for (const call of wave2Agents) {
    assert.equal(call.isolation, 'worktree', 'Wave-2 lanes must run in isolated worktrees');
    assert.equal(call.subagentType, 'todd', 'Wave-2 lanes must route to todd (implementer)');
    assert.equal(call.model, 'sonnet', 'Wave-2 lanes default to sonnet');
  }

  const wave1Agents = agentCallsByLabel(calls, 'wave1:interface');
  assert.equal(wave1Agents.length, 1, 'Wave-1 must dispatch exactly 1 interface-owner lane');
  assert.equal(wave1Agents[0].isolation, 'worktree', 'Wave-1 lane must run in an isolated worktree');
  assert.equal(wave1Agents[0].subagentType, 'todd', 'Wave-1 lane must route to todd (implementer)');
  assert.equal(wave1Agents[0].model, 'sonnet', 'Wave-1 lane defaults to sonnet');

  const cleanupAgents = agentCallsByLabel(calls, 'wave3:cleanup');
  assert.equal(cleanupAgents.length, 1, 'Wave-3 cleanup must dispatch exactly 1 lane');
  assert.equal(cleanupAgents[0].subagentType, 'todd', 'Wave-3 cleanup must route to todd (implementer)');
  assert.equal(cleanupAgents[0].model, 'sonnet', 'Wave-3 cleanup defaults to sonnet');

  const finalVerifiers = agentCallsByLabel(calls, 'verification:final');
  assert.equal(finalVerifiers.length, 1, 'final verifier must dispatch exactly 1 lane');
  assert.equal(finalVerifiers[0].subagentType, 'linda', 'final verifier must route to linda (adversarial)');
  assert.equal(finalVerifiers[0].model, 'opus', 'final verifier escalates to opus');
});

test('bizar-migrate: contract author + contract auditor escalate to opus', async () => {
  const { calls } = await runWorkflow({ from: 'js', to: 'ts' });
  const authors = agentCallsByLabel(calls, 'contract:author');
  const auditors = agentCallsByLabel(calls, 'contract:audit');
  assert.equal(authors.length, 1, 'contract author must dispatch exactly 1 lane');
  assert.equal(auditors.length, 1, 'contract auditor must dispatch exactly 1 lane');
  assert.equal(authors[0].subagentType, 'paul', 'contract author must route to paul (architect)');
  assert.equal(auditors[0].subagentType, 'linda', 'contract auditor must route to linda (adversarial)');
  assert.equal(authors[0].model, 'opus', 'contract author escalates to opus');
  assert.equal(auditors[0].model, 'opus', 'contract auditor escalates to opus');
});

test('bizar-migrate: every Agent call resolves to a known Bizar agent role', async () => {
  const { calls } = await runWorkflow({ from: 'js', to: 'ts' });
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  for (const call of agentCalls) {
    assert.ok(
      /^(greg|paul|todd|linda)$/.test(call.subagentType),
      `every Agent call must route to a known Bizar agent role (saw ${call.subagentType})`,
    );
  }
});

test('bizar-migrate: pipeline() is never invoked at runtime', async () => {
  const { calls } = await runWorkflow({ from: 'js', to: 'ts' });
  const pipelineCalls = calls.filter((c) => c.primitive === 'pipeline');
  assert.equal(pipelineCalls.length, 0, 'bizar-migrate.js must not invoke pipeline() at runtime');
});
