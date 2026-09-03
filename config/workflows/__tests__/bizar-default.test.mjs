import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');

const SCRIPTS = [
  { name: 'bizar-research', file: 'bizar-research.js', args: { topic: 'stub-topic' } },
  { name: 'bizar-implement', file: 'bizar-implement.js', args: { topic: 'stub-topic', scope: ['a', 'b'] }, minPhases: 4 },
  { name: 'bizar-debug', file: 'bizar-debug.js', args: { bug_id: 'BUG-1' } },
  { name: 'ultracode', file: 'ultracode.js', args: { task: 'stub-task' } },
  { name: 'ultracode-research', file: 'ultracode-research.js', args: { question: 'stub-question' } },
  { name: 'ultracode-review', file: 'ultracode-review.js', args: { target: 'stub-target' }, minPhases: 1 },
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

/**
 * Strip `export const meta = { ... };` (including any leading `import`
 * statements) from the workflow source. Static `import` is not valid in
 * `new Function`, so we replace it with `await import(...)` calls inside
 * the evaluated async IIFE. Returns `{ imports, body }` so the caller can
 * resolve imports relative to the workflow file's directory.
 */
function extractBody(source) {
  const importRegex = /^\s*import\s+(?:\{([^}]+)\}|([^\s{]+))\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
  const imports = [];
  for (const match of source.matchAll(importRegex)) {
    const names = match[1]
      ? match[1].split(',').map((n) => n.trim()).filter(Boolean)
      : [match[2].trim()].filter(Boolean);
    imports.push({ names, source: match[3] });
  }

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

  // Body: everything after the meta export. Static imports were already
  // captured into `imports`; here we strip them from the body so the
  // `new Function` body is plain code. We then prepend the dynamic
  // equivalents (resolved at runtime by the caller).
  const metaEnd = end + 1;
  let body = source.slice(metaEnd);
  body = body.replace(importRegex, '').trim();

  // Rewrite static imports to dynamic imports so they are valid inside
  // `new Function`. The caller passes the resolved bindings as runtime
  // parameters (already pre-resolved by `resolveImports`); these `const`
  // lines remain in the body for when the workflow script is run via a
  // real `import()` (e.g. the production runtime or the capture test).
  const dynamicImportLines = imports.map(({ names, source: importSource }) => {
    const namesList = names.join(', ');
    return `const { ${namesList} } = await import(${JSON.stringify(importSource)});`;
  });

  return { imports, body };
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
    if (label === 'repository' || label === 'documentation' || label === 'architecture' || label === 'completeness-critic') {
      return {
        claims: [{ claim: 'stub claim', source: 'stub/source', confidence: 'medium' }],
        gaps: ['stub gap'],
      };
    }
    if (label === 'synthesis') {
      return { brief: 'stub synthesis brief', summary: 'stub summary' };
    }
    return { stub: true, label, prompt };
  }

  const agent = async (prompt, opts) => {
    const header = typeof prompt === 'string' ? prompt.match(/^\[Bizar dispatch \d+: [^;]+; role=([^;]+); phase=([^;]+); label=([^\]]+)\]/) : null;
    const dispatchMeta = { role: header?.[1], phase: header?.[2], label: header?.[3] };
    calls.push({ primitive: 'agent', ...dispatchMeta, model: opts?.model, isolation: opts?.isolation });
    return buildStub(dispatchMeta, prompt);
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

/**
 * Resolve all static `import` statements to their actual bindings.
 * Returns a map of `{ localName: importedValue }`. Imports resolve
 * relative to `workflowsDir`, NOT to the test runner, because the
 * import paths in the workflow source are written relative to
 * `config/workflows/`.
 */
async function resolveImports(imports) {
  const resolved = {};
  const baseUrl = pathToFileURL(workflowsDir + '/').href;
  for (const { names, source } of imports) {
    const url = new URL(source, baseUrl).href;
    const mod = await import(url);
    for (const name of names) resolved[name] = mod[name];
  }
  return resolved;
}

async function runWorkflow(file, args) {
  const source = loadSource(file);
  const { imports, body } = extractBody(source);
  const bindings = await resolveImports(imports);
  const routedArgs = {
    ...(args && typeof args === 'object' ? args : {}),
    routing: {
      default: 'provider/default', medium: 'provider/mid', high: 'provider/high',
      nativeAliases: { sonnet: 'provider/default', opus: 'provider/mid', haiku: 'provider/high', fable: 'provider/default' },
    },
  };
  const runtime = makeRuntime(routedArgs);
  const fn = new Function(
    'args', 'agent', 'pipeline', 'parallel', 'phase', 'log',
    ...Object.keys(bindings),
    `return (async () => { ${body} })();`,
  );
  const result = await fn(
    runtime.args, runtime.agent, runtime.pipeline, runtime.parallel, runtime.phase, runtime.log,
    ...Object.values(bindings),
  );
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
    const minPhases = script.minPhases ?? 3;
    assert.ok(meta.phases.length >= minPhases, `phases must list >=${minPhases} stages (saw ${meta.phases.length})`);
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

test('bizar-implement: visible scope, plan, implementation, and review phases', async () => {
  const source = loadSource('bizar-implement.js');
  assert.ok(!/\bpipeline\s*\(/.test(source.replace(/pipeline\(/g, '')),
    'bizar-implement.js must not contain pipeline(');

  const { result, calls } = await runWorkflow('bizar-implement.js', { topic: 'stub-topic', scope: ['a', 'b'] });
  assert.equal(result.status, 'ready-for-integration');
  assert.equal(result.topic, 'stub-topic');
  assert.ok(result.lanes.length >= 1);
  assert.equal(result.implementations.length, result.lanes.length);
  assert.equal(result.reviews.length, result.implementations.length);

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 5, 'scope, plan, writer, and review must use separate workers');
  const writers = agentCalls.filter((call) => String(call.label || '').startsWith('implement:'));
  assert.equal(writers.length, result.implementations.length);
  assert.ok(writers.every((call) => call.model === 'provider/mid' && call.isolation === 'worktree'));
  const parallelCalls = calls.filter((c) => c.primitive === 'parallel');
  assert.ok(parallelCalls.some((call) => call.count === 2), 'independent scope checks must run concurrently');
  const phases = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
  assert.deepEqual(phases, ['Scope', 'Plan', 'Implement', 'Review']);
  const pipelineCalls = calls.filter((c) => c.primitive === 'pipeline');
  assert.equal(pipelineCalls.length, 0, 'bizar-implement.js must not invoke pipeline() at runtime');
});

test('bizar-implement: explicit disjoint lanes run concurrently', async () => {
  const lanes = [
    { name: 'a', scope: ['a/**'], task: 'change a' },
    { name: 'b', scope: ['b/**'], task: 'change b' },
  ];
  const { result, calls } = await runWorkflow('bizar-implement.js', { topic: 'stub-topic', lanes });
  assert.equal(result.lanes.length, 2);
  assert.equal(result.implementations.length, 2);
  assert.ok(calls.some((call) => call.primitive === 'parallel' && call.count === 2));
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
    const minPhases = script.minPhases ?? 3;
    assert.ok(phases.length >= minPhases, `${script.name}: expected >=${minPhases} phase() calls, saw ${phases.length}`);
    const agentCalls = calls.filter((call) => call.primitive === 'agent');
    assert.ok(agentCalls.every((call) => ['provider/mid', 'provider/high'].includes(call.model)), `${script.name}: every Agent call needs an explicit routed model`);
  }
});
