/**
 * cli/__tests__/workflow-bloat-pin.test.mjs — Phase B (v10.21.0) B.2
 *
 * Pins every barrier prompt in every shipped workflow to <= MAX_BARRIER_BYTES
 * (3072 bytes) — replacing the old structural bloat where 5-lane fan-outs
 * re-inlined ~15-40 KB of JSON.stringify(prior) into every downstream agent.
 *
 * The test runs each workflow's body under the same capture harness as
 * `config/workflows/__tests__/workflow-payload-capture.test.mjs`, but
 * here we measure the BYTES of every `dispatchCaptured` prompt instead
 * of asserting routing metadata. Any barrier prompt that exceeds the
 * budget fails the build.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const here = fileURLToPath(import.meta.url);
const workflowsDir = resolve(here, '..', '..', '..', 'config', 'workflows');
const dispatchPath = resolve(workflowsDir, 'lib', 'dispatch.js');
const dispatch = await import(pathToFileURL(dispatchPath).href);

const { MAX_BARRIER_BYTES, computeDecision, augmentPayload } = dispatch;

// Mirror the capture test's stub fabricator so workflow bodies continue
// past their early-return gates. The shape is the minimum the workflow
// needs to make progress to the next barrier.
function buildStub(label) {
  if (/plan/i.test(label)) return { approach: 'plan stub', lanes: [{ name: 'stub', scope: ['a'], task: 'do thing' }], gates: ['make check'] };
  if (/scope-extract/i.test(label)) return { lanes: [{ name: 'lane-1', scope: ['a'], task: 'do thing' }] };
  if (/implement/i.test(label)) return { summary: 'lane stub', files: ['a.ts'], risks: [], verification: ['make test'] };
  if (/review/i.test(label)) return { verified: true, findings: [] };
  if (/verify/i.test(label)) return { confirmed: true, reason: 'stub confirmed' };
  if (/audit/i.test(label)) return { approach: 'audited plan', lanes: [{ name: 'lane-1', scope: ['a'], task: 'do thing' }], gates: ['make check'] };
  if (/refine/i.test(label) || /hypothesis/i.test(label)) return { cause: 'stub cause', experiment: 'stub exp', predictedOutcome: 'stub out' };
  if (/fix/i.test(label)) return { fix: 'stub fix', files: ['a.ts'] };
  if (/synthesis/i.test(label)) return { brief: 'stub synthesis' };
  if (/critic/i.test(label)) return { claims: [], gaps: [] };
  if (/critique/i.test(label)) return { critique: 'stub critique' };
  if (/verifier/i.test(label)) return { confirmed: true, reason: 'verified' };
  if (/researcher|repo-researcher|docs-researcher|repository-map|official-docs|repository|documentation|architecture/.test(label)) {
    return { summary: 'stub research', files: ['a.ts'], risks: [], verification: ['make check'], claims: [], gaps: [] };
  }
  if (/final/i.test(label)) return { ready: true };
  return { ok: true };
}

function makeCtx() {
  return {
    selectedProfiles: [
      { id: 'provider/cheap', tier: 'budget', profile: { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true }, limits: { contextTokens: 32000, inputTokens: null, outputTokens: null } } },
      { id: 'provider/strong', tier: 'high', profile: { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true }, limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } } },
    ],
    staticProfiles: [],
    activeSessionModel: 'session/inherit',
    budget: {},
    health: {},
    history: undefined,
  };
}

async function runWorkflow(scriptFile, args) {
  const source = readFileSync(resolve(workflowsDir, scriptFile), 'utf8');
  const metaStart = source.search(/export\s+const\s+meta\s*=\s*\{/);
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
  let body = source.slice(end + 1);
  body = body.replace(/^\s*import\s+(?:\{([^}]+)\}|([^\s{]+))\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
  body = body.replace(/dispatchAgent\(/g, 'dispatchCaptured(');

  const captured = [];
  const ctx = makeCtx();
  const dispatchCaptured = async (agentFn, name, prompt, opts = {}) => {
    const decision = computeDecision(name, prompt, opts, ctx);
    captured.push({ name, label: opts.label || name, prompt, phase: opts.phase });
    return buildStub(opts.label || name);
  };
  const fakeAgent = async () => ({});
  const fakeParallel = async (fns) => Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  const fakePipeline = async (items, fn) => {
    if (typeof fn !== 'function') return items;
    const out = [];
    for (let i = 0; i < items.length; i++) out.push(await fn(items[i], items, i));
    return out;
  };
  // Real writeArtifact + barrierRef (uses BIZAR_RUNS_DIR override for isolation).
  const tmpRoot = mkdtempSync(join(tmpdir(), 'bizar-bloat-pin-'));
  process.env.BIZAR_RUNS_DIR = tmpRoot;
  const realWrite = (...a) => dispatch.writeArtifact(...a);
  const realRef = (...a) => dispatch.barrierRef(...a);
  const fn = new Function(
    'args', 'agent', 'pipeline', 'parallel', 'phase', 'log', 'dispatchCaptured', 'randomUUID', 'writeArtifact', 'barrierRef',
    `return (async () => { ${body.trim()} })();`,
  );
  try {
    await fn(args, fakeAgent, fakePipeline, fakeParallel, () => {}, () => {}, dispatchCaptured, randomUUID, realWrite, realRef);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  return captured;
}

const SCRIPTS = [
  { name: 'bizar-debug', file: 'bizar-debug.js', args: { bug_id: 'BUG-1' } },
  { name: 'bizar-implement', file: 'bizar-implement.js', args: { topic: 'stub-topic', scope: ['a', 'b'] } },
  { name: 'bizar-research', file: 'bizar-research.js', args: { topic: 'stub-topic' } },
  { name: 'ultracode', file: 'ultracode.js', args: { task: 'stub-task' } },
  { name: 'ultracode-research', file: 'ultracode-research.js', args: { question: 'stub-question' } },
  { name: 'ultracode-review', file: 'ultracode-review.js', args: { target: 'stub-target' } },
];

describe('workflow-bloat-pin B.2', () => {
  for (const script of SCRIPTS) {
    test(`${script.name}: every dispatch prompt is <= ${MAX_BARRIER_BYTES} bytes`, async () => {
      const captured = await runWorkflow(script.file, script.args);
      assert.ok(captured.length > 0, `${script.name}: must dispatch at least once (saw 0)`);
      const offenders = captured.filter((c) => Buffer.byteLength(c.prompt, 'utf8') > MAX_BARRIER_BYTES);
      if (offenders.length > 0) {
        const sample = offenders.slice(0, 3).map((o) => `${o.label}=${Buffer.byteLength(o.prompt, 'utf8')}`).join(', ');
        assert.fail(`${script.name}: ${offenders.length}/${captured.length} prompts exceed ${MAX_BARRIER_BYTES} bytes — ${sample}`);
      }
    });
  }

  // Sanity: capture and print the largest prompt per workflow so a future
  // reader of the test output can see what was measured. Not a pin.
  test('reports measured max prompt bytes per workflow (advisory)', async () => {
    const report = {};
    for (const script of SCRIPTS) {
      const captured = await runWorkflow(script.file, script.args);
      const max = captured.reduce((m, c) => Math.max(m, Buffer.byteLength(c.prompt, 'utf8')), 0);
      const total = captured.reduce((s, c) => s + Buffer.byteLength(c.prompt, 'utf8'), 0);
      report[script.name] = { max, total, count: captured.length };
    }
    // eslint-disable-next-line no-console
    console.log('  barrier prompt bytes (max, total across N dispatches):', JSON.stringify(report));
  });
});
