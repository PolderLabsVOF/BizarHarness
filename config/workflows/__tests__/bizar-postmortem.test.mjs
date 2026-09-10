/**
 * config/workflows/__tests__/bizar-postmortem.test.mjs
 *
 * Contract fence for `config/workflows/bizar-postmortem.js`.
 *
 * What this test proves:
 *   1. The workflow returns `status: 'ready-for-integration'` and the
 *      final return shape matches the F-189 contract.
 *   2. The body dispatches >= 5 distinct `agent()` calls spanning the
 *      six defined lanes (triage, rca-delegate, fix-and-test, runbook,
 *      postmortem, verify) and each lands in the matching phase.
 *   3. Every dispatched payload carries the static alias `model`
 *      (`haiku`/`sonnet`/`opus`/`fable`) plus a forwarded
 *      `routingDecisionId` from the workflow-level `args`.
 *   4. The dispatcher wrapper honors the static alias policy
 *      (triage/verify = `opus`; rca/fix/runbook/postmortem = `sonnet`).
 *   5. Phase markers fire in declared order: Triage, RCA, Fix+Test,
 *      Runbook-Update, Postmortem, Verify.
 *   6. The fix-and-test lane is dispatched with `isolation: 'worktree'`
 *      and does NOT use `pipeline()` (which is sequential, not parallel).
 *
 * Run with `node --test config/workflows/__tests__/bizar-postmortem.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');
const workflowPath = resolve(workflowsDir, 'bizar-postmortem.js');

const loadSource = () => readFileSync(workflowPath, 'utf8');

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
      if (ch === '\\') { escape = false; continue; }
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
      if (ch === '\\') { escape = false; continue; }
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
  return source.slice(end + 1).trim();
}

function makeRuntime(args) {
  const calls = [];
  const phase = (name) => calls.push({ primitive: 'phase', name });
  const log = (...rest) => calls.push({ primitive: 'log', args: rest });

  function buildStub(dispatchMeta, prompt) {
    const label = dispatchMeta.label || '';
    if (label === 'triage') {
      return {
        incident: {
          id: 'INC-42',
          severity: 'SEV2',
          scope: ['checkout-api'],
          summary: 'checkout latency spike',
        },
      };
    }
    if (label === 'rca') {
      return {
        status: 'dry',
        bug_id: 'INC-42',
        hypothesis: { cause: 'connection pool exhaustion' },
        fix: { files: ['src/db/pool.ts'], regressionTest: 'src/db/pool.test.ts' },
        verification: { ok: true, summary: 'verified' },
      };
    }
    if (label === 'fix-and-test') {
      return {
        files: ['src/db/pool.ts'],
        regressionTest: 'src/db/pool.test.ts',
        canary: { command: 'pnpm smoke', ok: true },
        summary: 'fix landed in worktree',
      };
    }
    if (label === 'runbook') {
      return { runbook: { path: 'docs/runbooks/checkout-api.md' } };
    }
    if (label === 'postmortem') {
      return {
        postmortem: { path: 'docs/postmortems/2026-09-10-inc-42.md', actionItemCount: 3 },
        actionItems: [
          { id: 'OK-A-1', title: 'add pool gauge' },
          { id: 'OK-A-2', title: 'tune pool ceiling' },
          { id: 'OK-A-3', title: 'rehearse failover' },
        ],
      };
    }
    if (label === 'verify') {
      return { ok: true, summary: 'postmortem verified' };
    }
    return { stub: true, label, prompt };
  }

  const agent = async (prompt, opts) => {
    const header = typeof prompt === 'string'
      ? prompt.match(/^\[Bizar dispatch \d+: [^;]+; role=([^;]+); phase=([^;]+); label=([^;]+); routing=([^\]]+)\]/)
      : null;
    const dispatchMeta = {
      role: header?.[1],
      phase: header?.[2],
      label: header?.[3],
      routingId: header?.[4],
    };
    calls.push({
      primitive: 'agent',
      ...dispatchMeta,
      subagentType: opts?.subagent_type,
      model: opts?.model,
      routingDecisionId: opts?.routingDecisionId,
      isolation: opts?.isolation,
    });
    return buildStub(dispatchMeta, prompt);
  };

  const parallel = async (fns) => {
    calls.push({ primitive: 'parallel', count: Array.isArray(fns) ? fns.length : 0 });
    return Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  };
  const pipeline = async (items, fn) => {
    calls.push({ primitive: 'pipeline', count: Array.isArray(items) ? items.length : 0 });
    if (typeof fn !== 'function') return items;
    const out = [];
    for (let i = 0; i < items.length; i++) {
      out.push(await fn(items[i], items, i));
    }
    return out;
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

const ROUTING = 'routing-decision-1234';
const ARGS = { incident_id: 'INC-42', routingDecisionId: ROUTING };
const ALLOWED_ALIASES = new Set(['haiku', 'sonnet', 'opus', 'fable']);
const VERIFIER_LANES = new Set(['triage', 'verify']);

test('bizar-postmortem: meta export shape', () => {
  const meta = extractMeta(loadSource());
  assert.equal(meta.name, 'bizar-postmortem');
  assert.equal(typeof meta.description, 'string');
  assert.ok(meta.description.length > 0, 'description must be non-empty');
  assert.equal(typeof meta.whenToUse, 'string');
  assert.ok(meta.whenToUse.length > 0, 'whenToUse must be non-empty');
  assert.ok(Array.isArray(meta.phases));
  assert.equal(meta.phases.length, 6, 'bizar-postmortem must declare exactly 6 phases');
  const titles = meta.phases.map((p) => p.title);
  assert.deepEqual(titles, ['Triage', 'RCA', 'Fix+Test', 'Runbook-Update', 'Postmortem', 'Verify']);
  for (const ph of meta.phases) {
    assert.equal(typeof ph.title, 'string');
    assert.equal(typeof ph.detail, 'string');
  }
});

test('bizar-postmortem: self-contained (no static imports)', () => {
  const source = loadSource();
  assert.ok(!/^\s*import\s/m.test(source), 'bizar-postmortem.js must contain no static imports');
  assert.ok(!/\bimport\s*\(/m.test(source), 'bizar-postmortem.js must contain no dynamic imports');
});

test('bizar-postmortem: body compiles and returns ready-for-integration', async () => {
  const { result, calls } = await runWorkflow(ARGS);
  assert.equal(result.status, 'ready-for-integration');
  for (const key of ['incident', 'rca', 'fix', 'runbook', 'postmortem', 'actionItems']) {
    assert.ok(key in result, `return shape must include ${key}`);
  }
  assert.ok(result.incident);
  assert.equal(result.incident.id, 'INC-42');
  assert.ok(Array.isArray(result.actionItems));
  assert.ok(result.actionItems.length >= 1, 'actionItems must surface filed OpenKan tasks');
  assert.equal(calls.some((c) => c.primitive === 'pipeline'), false, 'bizar-postmortem must not use pipeline()');
});

test('bizar-postmortem: >= 5 distinct agent() calls across the six phases', async () => {
  const { calls } = await runWorkflow(ARGS);
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 5, `expected >=5 agent() calls, saw ${agentCalls.length}`);
  const labels = new Set(agentCalls.map((c) => c.label));
  for (const required of ['triage', 'rca', 'fix-and-test', 'runbook', 'postmortem', 'verify']) {
    assert.ok(labels.has(required), `agent() dispatch must include lane "${required}"`);
  }
});

test('bizar-postmortem: phases fire in declared order', async () => {
  const { calls } = await runWorkflow(ARGS);
  const phases = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
  assert.deepEqual(phases, ['Triage', 'RCA', 'Fix+Test', 'Runbook-Update', 'Postmortem', 'Verify']);
});

test('bizar-postmortem: every agent() payload forwards the static alias model + routingDecisionId', async () => {
  const { calls } = await runWorkflow(ARGS);
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  for (const call of agentCalls) {
    assert.ok(ALLOWED_ALIASES.has(call.model), `model "${call.model}" must be a static alias (haiku/sonnet/opus/fable)`);
    assert.equal(call.routingDecisionId, ROUTING, 'routingDecisionId must be forwarded from args into every dispatch');
    assert.ok(call.routingId === ROUTING, 'prefix routing= must echo args.routingDecisionId');
    assert.match(call.subagentType, /^(greg|paul|todd|linda)$/, 'subagent_type must be a stable Bizar agent');
  }
});

test('bizar-postmortem: static alias policy — triage + verify = opus; rca/fix/runbook/postmortem = sonnet', async () => {
  const { calls } = await runWorkflow(ARGS);
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  for (const call of agentCalls) {
    const expected = VERIFIER_LANES.has(call.label) ? 'opus' : 'sonnet';
    assert.equal(call.model, expected, `lane "${call.label}" must use ${expected}`);
  }
});

test('bizar-postmortem: fix-and-test lane is worktree-isolated and runs in Fix+Test phase', async () => {
  const { calls } = await runWorkflow(ARGS);
  const fix = calls.find((c) => c.primitive === 'agent' && c.label === 'fix-and-test');
  assert.ok(fix, 'fix-and-test lane must dispatch exactly once');
  assert.equal(fix.phase, 'Fix+Test');
  assert.equal(fix.isolation, 'worktree', 'fix-and-test must run in an isolated worktree');
  assert.equal(fix.subagentType, 'todd', 'fix-and-test routes to todd via implementer role');
});

test('bizar-postmortem: nested bizar-debug RCA delegation composes via single rca-delegate dispatch', async () => {
  const { calls } = await runWorkflow(ARGS);
  const rcaCalls = calls.filter((c) => c.primitive === 'agent' && c.label === 'rca');
  assert.equal(rcaCalls.length, 1, 'RCA phase must compose the bizar-debug workflow via exactly one rca-delegate dispatch');
  assert.equal(rcaCalls[0].subagentType, 'greg', 'rca-delegate routes to greg via research-analyst role');
  assert.equal(rcaCalls[0].phase, 'RCA');
});
