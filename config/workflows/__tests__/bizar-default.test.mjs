import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');

const SCRIPTS = [
  { name: 'bizar-research', file: 'bizar-research.js', args: { topic: 'stub-topic' } },
  { name: 'bizar-implement', file: 'bizar-implement.js', args: { topic: 'stub-topic', scope: ['a', 'b'] } },
  { name: 'bizar-debug', file: 'bizar-debug.js', args: { bug_id: 'BUG-1' } },
];

function loadSource(file) {
  return readFileSync(resolve(workflowsDir, file), 'utf8');
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
  if (end < 0) throw new Error('meta braces unbalanced');
  const after = source.slice(end + 1);
  const newlineIdx = after.indexOf('\n');
  return after.slice(newlineIdx >= 0 ? newlineIdx + 1 : 0).trim();
}

function makeRuntime(args) {
  const calls = [];
  const phase = (name) => calls.push({ primitive: 'phase', name });
  const log = (...rest) => calls.push({ primitive: 'log', args: rest });

  function buildStub(opts, prompt) {
    const label = opts?.label || '';
    if (label.startsWith('implement:')) return { stub: true, label, files: ['changed.ts'], summary: 'lane complete' };
    if (label === 'plan' || label === 'plan-audit') {
      return {
        approach: 'stub approach',
        lanes: [
          { name: 'lane-a', scope: ['a/**'], task: 'stub' },
          { name: 'lane-b', scope: ['b/**'], task: 'stub' },
        ],
        gates: ['stub-gate'],
      };
    }
    if (label === 'scope-extract') {
      return {
        lanes: [
          { name: 'lane-a', scope: ['a/**'], task: 'stub' },
          { name: 'lane-b', scope: ['b/**'], task: 'stub' },
        ],
      };
    }
    if (label === 'hypothesis:initial' || label.startsWith('refine:')) {
      return { cause: 'stub cause', experiment: 'stub experiment', predictedOutcome: 'stub outcome' };
    }
    if (label === 'barrier-merge' || label === 'barrier-verify' || label === 'integration-report' || label === 'final-verification') {
      return { plan: 'stub merge plan', order: ['lane-a', 'lane-b'] };
    }
    if (label === 'fix') {
      return { files: ['fix.ts'], regressionTest: 'fix.test.ts', summary: 'stub fix' };
    }
    if (label === 'fix-verify') {
      return { ok: true, summary: 'stub fix verified' };
    }
    if (label.startsWith('verify:')) {
      return { confirmed: true, reason: 'stub confirmed' };
    }
    if (label.startsWith('review:') || label.startsWith('repository-map') || label.startsWith('official-docs')) {
      return {
        summary: 'stub review/research summary',
        files: ['stub/file.ts'],
        risks: ['stub risk'],
        verification: ['stub verification'],
      };
    }
    return { stub: true, label, prompt };
  }

  const agent = async (prompt, opts) => {
    calls.push({ primitive: 'agent', label: opts?.label, phase: opts?.phase });
    return buildStub(opts || {}, prompt);
  };
  const parallel = async (fns) => {
    calls.push({ primitive: 'parallel', count: Array.isArray(fns) ? fns.length : 0 });
    return Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  };
  const pipeline = async (items, fn) => {
    calls.push({ primitive: 'pipeline', count: Array.isArray(items) ? items.length : 0 });
    if (typeof fn !== 'function') return items;
    const original = items;
    const out = [];
    for (let i = 0; i < original.length; i++) {
      out.push(await fn(original[i], original, i));
    }
    return out;
  };
  return { calls, agent, parallel, pipeline, phase, log, args };
}

async function runWorkflow(file, args) {
  const source = loadSource(file);
  const body = extractBody(source);
  const runtime = makeRuntime(args);
  const fn = new Function(
    'args', 'agent', 'pipeline', 'parallel', 'phase', 'log',
    `return (async () => { ${body} })();`,
  );
  const result = await fn(runtime.args, runtime.agent, runtime.pipeline, runtime.parallel, runtime.phase, runtime.log);
  return { result, calls: runtime.calls };
}

for (const script of SCRIPTS) {
  test(`${script.name}: meta export shape`, () => {
    const meta = extractMeta(loadSource(script.file));
    assert.equal(meta.name, script.name);
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.description.length > 0, 'description must be non-empty');
    assert.equal(typeof meta.whenToUse, 'string');
    assert.ok(Array.isArray(meta.phases));
    assert.ok(meta.phases.length >= 3, 'phases must list >=3 stages');
    for (const phase of meta.phases) {
      assert.equal(typeof phase.title, 'string');
      assert.equal(typeof phase.detail, 'string');
    }
  });
}

test('bizar-research: pipeline + parallel fan-out with sequential verify', async () => {
  const { result, calls } = await runWorkflow('bizar-research.js', { topic: 'stub-topic' });
  assert.equal(result.status, 'ready-for-integration');
  assert.equal(result.topic, 'stub-topic');
  assert.ok(Array.isArray(result.research));
  assert.ok(result.research.length >= 1);
  assert.ok(result.plan && Array.isArray(result.plan.lanes));
  assert.ok(Array.isArray(result.implementation));
  assert.ok(Array.isArray(result.reviews));
  assert.ok(result.final);

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 2, `expected >=2 agent() calls, saw ${agentCalls.length}`);
  const parallelCalls = calls.filter((c) => c.primitive === 'parallel');
  assert.ok(parallelCalls.some((c) => c.count >= 2), 'parallel() must fan out >=2 items');
  const pipelineCalls = calls.filter((c) => c.primitive === 'pipeline');
  assert.ok(pipelineCalls.length >= 1, 'bizar-research.js must use pipeline()');
});

test('bizar-implement: parallel-only barrier + synthesis (no pipeline)', async () => {
  const source = loadSource('bizar-implement.js');
  assert.ok(!/\bpipeline\s*\(/.test(source.replace(/pipeline\(/g, '')),
    'bizar-implement.js must not contain pipeline(');

  const { result, calls } = await runWorkflow('bizar-implement.js', { topic: 'stub-topic', scope: ['a', 'b'] });
  assert.equal(result.status, 'ready-for-integration');
  assert.equal(result.topic, 'stub-topic');
  assert.ok(Array.isArray(result.lanes) && result.lanes.length >= 1);
  assert.ok(Array.isArray(result.implementations));
  assert.ok(result.barrier);
  assert.ok(result.verify);
  assert.ok(result.synthesis);

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 2, `expected >=2 agent() calls, saw ${agentCalls.length}`);
  const parallelCalls = calls.filter((c) => c.primitive === 'parallel');
  assert.ok(parallelCalls.some((c) => c.count >= 1), 'bizar-implement.js must use parallel()');
  const pipelineCalls = calls.filter((c) => c.primitive === 'pipeline');
  assert.equal(pipelineCalls.length, 0, 'bizar-implement.js must not invoke pipeline() at runtime');
});

test('bizar-debug: bounded loop-until-dry (no pipeline)', async () => {
  const source = loadSource('bizar-debug.js');
  assert.ok(!/\bpipeline\s*\(/.test(source.replace(/pipeline\(/g, '')),
    'bizar-debug.js must not contain pipeline(');

  const { result, calls } = await runWorkflow('bizar-debug.js', { bug_id: 'BUG-1' });
  assert.ok(['dry', 'budget-exhausted'].includes(result.status));
  assert.equal(result.bug_id, 'BUG-1');

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 2, `expected >=2 agent() calls, saw ${agentCalls.length}`);
  const phases = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
  assert.ok(phases.includes('Hypothesis'));
  const pipelineCalls = calls.filter((c) => c.primitive === 'pipeline');
  assert.equal(pipelineCalls.length, 0, 'bizar-debug.js must not invoke pipeline() at runtime');
});

test('all workflows: phase() calls fire in declared order', async () => {
  for (const script of SCRIPTS) {
    const { calls } = await runWorkflow(script.file, script.args);
    const phases = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
    assert.ok(phases.length >= 3, `${script.name}: expected >=3 phase() calls, saw ${phases.length}`);
  }
});