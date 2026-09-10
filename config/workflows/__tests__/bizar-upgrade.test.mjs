/**
 * config/workflows/__tests__/bizar-upgrade.test.mjs
 *
 * Contract fence for `config/workflows/bizar-upgrade.js`. Drives the
 * workflow through a mocked `agent()` capture stub and asserts:
 *
 *   1. The return shape matches the documented
 *      `{ status: 'ready-for-integration', topic, plan, lanes,
 *        implementations, reviews, evidence }` contract.
 *   2. At least 5 distinct `agent()` calls were dispatched across
 *      Audit, Plan, Implement, Verify, and Finalize.
 *   3. Every captured `agent()` payload carries a static alias
 *      `model` field (haiku / sonnet / opus / fable) and forwards
 *      the supplied `routingDecisionId`.
 *
 * Run with `node --test config/workflows/__tests__/bizar-upgrade.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(here, '..', 'bizar-upgrade.js');
const workflowSource = readFileSync(workflowPath, 'utf8');

const ALLOWED_ALIASES = new Set(['haiku', 'sonnet', 'opus', 'fable']);

function buildRuntime(args) {
  const calls = [];

  const phase = (name) => calls.push({ primitive: 'phase', name });
  const log = (...rest) => calls.push({ primitive: 'log', args: rest });

  const stubFor = (label) => {
    if (label === 'changelog' || label === 'peer-deps') {
      return {
        summary: 'stub audit summary',
        breakingChanges: ['removed deprecated API', 'changed default export'],
        peerDependencies: ['stub-pkg-a', 'stub-pkg-b'],
        currentPins: { 'stub-pkg-a': '1.0.0', 'stub-pkg-b': '2.3.4' },
      };
    }
    if (label === 'upgrade-plan' || label === 'plan-audit') {
      return {
        plan: 'stub upgrade plan',
        codemodSteps: ['stub codemod step'],
        lanes: [
          { name: 'stub-pkg-a', scope: ['stub-pkg-a/**'], task: 'upgrade stub-pkg-a' },
          { name: 'stub-pkg-b', scope: ['stub-pkg-b/**'], task: 'upgrade stub-pkg-b' },
        ],
        rollback: 'stub rollback strategy',
        matrix: ['stub matrix entry'],
      };
    }
    if (typeof label === 'string' && label.startsWith('upgrade:')) {
      return {
        stub: true,
        label,
        files: ['changed.ts'],
        summary: 'lane complete',
      };
    }
    if (label === 'test-suite' || label === 'upgrade-matrix') {
      return {
        pass: true,
        perPackage: { 'stub-pkg-a': 'pass', 'stub-pkg-b': 'pass' },
        summary: `stub ${label} result`,
      };
    }
    if (label === 'finalize') {
      return {
        lockfile: 'updated lockfile content',
        evidence: 'openkan task evidence ref',
      };
    }
    return { stub: true, label };
  };

  const agent = async (prompt, opts) => {
    const header = typeof prompt === 'string'
      ? prompt.match(/^\[Bizar dispatch \d+: [^;]+; role=([^;]+); phase=([^;]+); label=([^\]]+)\]/)
      : null;
    const dispatchMeta = {
      role: header?.[1],
      phase: header?.[2],
      label: header?.[3],
      model: opts?.model,
      routingDecisionId: opts?.routingDecisionId,
      subagentType: opts?.subagent_type,
      isolation: opts?.isolation,
    };
    calls.push({ primitive: 'agent', ...dispatchMeta });
    return stubFor(dispatchMeta.label);
  };

  const parallel = async (fns) => {
    calls.push({ primitive: 'parallel', count: Array.isArray(fns) ? fns.length : 0 });
    return Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  };

  const pipeline = async (items) => items;

  return { args, calls, agent, parallel, phase, log, pipeline };
}

async function runWorkflow(args) {
  const metaMatch = workflowSource.match(/^export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\}/m);
  if (!metaMatch) throw new Error('bizar-upgrade.js: meta export not found');
  const body = workflowSource.slice(metaMatch[0].length).trim();
  const runtime = buildRuntime(args);
  const fn = new Function(
    'args', 'agent', 'parallel', 'phase', 'log', 'pipeline',
    `return (async () => { ${body} })();`,
  );
  const result = await fn(
    runtime.args, runtime.agent, runtime.parallel, runtime.phase, runtime.log, runtime.pipeline,
  );
  return { result, calls: runtime.calls };
}

test('bizar-upgrade: source must begin with a literal meta export (F-189)', () => {
  assert.ok(
    /^export\s+const\s+meta\s*=\s*\{/.test(workflowSource),
    'meta export must be the first non-empty statement',
  );
  assert.ok(
    !/^import\s+/m.test(workflowSource),
    'bizar-upgrade.js must not contain static imports (F-198)',
  );
});

test('bizar-upgrade: meta literal name matches filename and ships required fields', () => {
  const metaMatch = workflowSource.match(/^export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\})/m);
  assert.ok(metaMatch, 'meta object literal not found');
  const metaText = metaMatch[1];
  assert.ok(/name:\s*'bizar-upgrade'/.test(metaText), 'meta.name must be the literal "bizar-upgrade"');
  assert.ok(/description:\s*'/.test(metaText), 'meta.description must be a literal string');
  assert.ok(/whenToUse:\s*'/.test(metaText), 'meta.whenToUse must be a literal string');
  assert.ok(/phases:\s*\[[\s\S]*?\{[\s\S]*?title:[\s\S]*?detail:[\s\S]*?\}/.test(metaText), 'meta.phases must contain at least one {title, detail} entry');
});

test('bizar-upgrade: runs five phases with >=5 distinct agent() calls carrying model alias + routingDecisionId', async () => {
  const args = {
    package: 'stub-pkg',
    targetMajor: 2,
    routingDecisionId: 'rd-upgrade-test-001',
  };
  const { result, calls } = await runWorkflow(args);

  assert.equal(result.status, 'ready-for-integration');
  assert.equal(result.topic, 'stub-pkg@2');

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(
    agentCalls.length >= 5,
    `expected >=5 distinct agent() calls across 5 phases, saw ${agentCalls.length}`,
  );

  const phaseNames = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
  assert.deepEqual(phaseNames, ['Audit', 'Plan', 'Implement', 'Verify', 'Finalize']);

  for (const call of agentCalls) {
    assert.ok(
      ALLOWED_ALIASES.has(call.model),
      `agent() call payload must carry a static alias model (haiku/sonnet/opus/fable); saw ${call.model}`,
    );
    assert.equal(
      call.routingDecisionId,
      args.routingDecisionId,
      'every agent() payload must forward the supplied routingDecisionId',
    );
    assert.ok(
      ['greg', 'paul', 'todd', 'linda'].includes(call.subagentType),
      `agent() payload must route through a Bizar agent role; saw ${call.subagentType}`,
    );
  }

  const labels = new Set(agentCalls.map((c) => c.label));
  assert.ok(labels.has('changelog'), 'Audit must dispatch the changelog lane');
  assert.ok(labels.has('peer-deps'), 'Audit must dispatch the peer-deps lane');
  assert.ok(labels.has('upgrade-plan'), 'Plan must dispatch the upgrade-planner lane');
  assert.ok(labels.has('plan-audit'), 'Plan must dispatch the plan-auditor lane');
  assert.ok(labels.has('test-suite'), 'Verify must dispatch the test-suite lane');
  assert.ok(labels.has('upgrade-matrix'), 'Verify must dispatch the upgrade-matrix lane');
  assert.ok(labels.has('finalize'), 'Finalize must dispatch the finalizer lane');
});

test('bizar-upgrade: return shape matches the documented contract', async () => {
  const args = {
    package: 'stub-pkg',
    targetMajor: 2,
    routingDecisionId: 'rd-upgrade-test-002',
  };
  const { result } = await runWorkflow(args);

  for (const key of ['status', 'topic', 'plan', 'lanes', 'implementations', 'reviews', 'evidence']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, key), `return shape must include ${key}`);
  }
  assert.equal(result.status, 'ready-for-integration');
  assert.equal(typeof result.topic, 'string');
  assert.ok(result.plan && Array.isArray(result.plan.lanes), 'plan.lanes must be an array');
  assert.ok(Array.isArray(result.lanes), 'lanes must be an array');
  assert.ok(result.lanes.length >= 1, 'lanes must list at least one owned package lane');
  assert.ok(Array.isArray(result.implementations), 'implementations must be an array');
  assert.ok(
    result.implementations.length === result.lanes.length,
    'implementations must have one entry per dispatched lane',
  );
  assert.ok(result.reviews && typeof result.reviews === 'object', 'reviews must be an object');
  assert.ok(result.reviews.testSuite, 'reviews.testSuite must be populated');
  assert.ok(result.reviews.upgradeMatrix, 'reviews.upgradeMatrix must be populated');
  assert.ok(result.evidence && (result.evidence.lockfile || result.evidence.evidence), 'evidence must carry finalized artifacts');
});

test('bizar-upgrade: implement lanes run with worktree isolation and bounded fan-out (max 6)', async () => {
  const args = {
    package: 'stub-pkg',
    targetMajor: 2,
    routingDecisionId: 'rd-upgrade-test-003',
    lanes: [
      { name: 'a', scope: ['a/**'], task: 'a' },
      { name: 'b', scope: ['b/**'], task: 'b' },
      { name: 'c', scope: ['c/**'], task: 'c' },
      { name: 'd', scope: ['d/**'], task: 'd' },
      { name: 'e', scope: ['e/**'], task: 'e' },
      { name: 'f', scope: ['f/**'], task: 'f' },
      { name: 'g', scope: ['g/**'], task: 'g' },
      { name: 'h', scope: ['h/**'], task: 'h' },
    ],
  };
  const { result, calls } = await runWorkflow(args);

  const implementers = calls.filter((c) => c.primitive === 'agent' && typeof c.label === 'string' && c.label.startsWith('upgrade:'));
  assert.equal(implementers.length, 6, 'implementation phase must cap at 6 lanes');
  assert.ok(
    implementers.every((c) => c.isolation === 'worktree'),
    'every upgrade lane must run with worktree isolation',
  );
  assert.equal(result.lanes.length, 6, 'lanes must reflect the bounded fan-out');
});
