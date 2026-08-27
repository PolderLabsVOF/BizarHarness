/**
 * scripts/__tests__/autonomy-contract-workflow.test.mjs —
 * Drift guard for IMP-014 / F-189.
 *
 * Fails CI if any `config/workflows/*.js` re-introduces a bare
 * `agent(` call without routing it through `dispatchAgent`. The
 * acceptance gate is "Captured nested Agent payloads contain expected
 * models", and that contract is only verifiable if every Agent payload
 * carries `model` + `routingDecisionId` from the F-188 selector.
 *
 * Allowlist:
 *   1. The dispatch helper itself (`config/workflows/lib/dispatch.js`)
 *      calls the runtime's `agentFn(prompt, ...)` inside `dispatchAgent`.
 *   2. Test helpers under `__tests__/` may construct fakes for tests.
 *   3. A trailing `// dispatch-bypass: <reason>` comment immediately
 *      before a bare `agent(` call exempts that single occurrence.
 *
 * The drift guard runs in O(n) over workflow source files. The captured
 * payload test (`workflow-payload-capture.test.mjs`) is the runtime
 * proof; this test is the static-source proof.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const workflowsDir = resolve(repoRoot, 'config', 'workflows');

function listWorkflowScripts() {
  const out = [];
  for (const entry of readdirSync(workflowsDir)) {
    if (entry === 'lib' || entry === '__tests__') continue;
    const abs = join(workflowsDir, entry);
    if (!statSync(abs).isFile()) continue;
    if (!entry.endsWith('.js')) continue;
    out.push(entry);
  }
  return out.sort();
}

/**
 * Strip block + line comments and template strings so we don't false-
 * positive on `agent` mentions in comments or example prompts.
 */
function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  let inString = null;
  let escape = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (escape) { out += ch; escape = false; i++; continue; }
    if (inString) {
      if (ch === '\\') { out += ch; escape = true; i++; continue; }
      if (ch === inString) inString = null;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; out += ch; i++; continue; }
    out += ch;
    i++;
  }
  return out;
}

function findBareAgentCalls(stripped) {
  // Match every `agent(` that is NOT preceded by `dispatchAgent(` or
  // other safe call-site prefixes. Whitelist prefixes:
  //   - `dispatchAgent(` (the wrapper)
  //   - `fakeAgent(`, `mockAgent(`, `stubAgent(` (test fakes, ignored
  //     here because we only scan production scripts in config/workflows/)
  const hits = [];
  const regex = /\bagent\s*\(/g;
  let m;
  while ((m = regex.exec(stripped)) !== null) {
    const before = stripped.slice(Math.max(0, m.index - 30), m.index);
    if (/dispatchAgent\s*$/.test(before)) continue;
    if (/dispatchCaptured\s*$/.test(before)) continue;
    hits.push(m.index);
  }
  return hits;
}

function findBypassComments(source) {
  const out = new Set();
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/\/\/\s*dispatch-bypass:/.test(lines[i])) out.add(offset);
    offset += lines[i].length + 1;
  }
  return out;
}

test('autonomy-contract-workflow: every workflow script routes agent() through dispatchAgent', () => {
  const scripts = listWorkflowScripts();
  assert.ok(scripts.length > 0, 'workflow scripts directory must contain >=1 .js file');
  const failures = [];
  for (const script of scripts) {
    const source = readFileSync(join(workflowsDir, script), 'utf8');
    const stripped = stripCommentsAndStrings(source);
    const hits = findBareAgentCalls(stripped);
    const bypassOffsets = findBypassComments(source);
    for (const hit of hits) {
      // A bypass comment within 200 chars before the hit exempts it.
      let exempt = false;
      for (const offset of bypassOffsets) {
        if (offset <= hit && hit - offset <= 200) { exempt = true; break; }
      }
      if (!exempt) failures.push(`${script}: bare agent() at offset ${hit}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('autonomy-contract-workflow: every workflow script imports dispatchAgent from lib/dispatch.js', () => {
  const scripts = listWorkflowScripts();
  const failures = [];
  for (const script of scripts) {
    const source = readFileSync(join(workflowsDir, script), 'utf8');
    if (!/import\s*\{[^}]*\bdispatchAgent\b[^}]*\}\s*from\s*['"]\.\/lib\/dispatch\.js['"]/.test(source)) {
      failures.push(`${script}: must import dispatchAgent from './lib/dispatch.js'`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('autonomy-contract-workflow: drift probe — injecting a bare agent() call fails CI', () => {
  // Sanity check: programmatically inject a bare `agent(` into a
  // workflow script (in-memory only) and verify the drift guard flags it.
  // This proves the guard is not silently passing.
  const scripts = listWorkflowScripts();
  const target = scripts[0];
  const source = readFileSync(join(workflowsDir, target), 'utf8');
  // Strip the meta export and append a bare call as a synthetic test.
  const metaStart = source.search(/export\s+const\s+meta\s*=\s*\{/);
  const open = source.indexOf('{', metaStart);
  let depth = 0, inString = null, escape = false, end = -1;
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
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const tampered = source.slice(0, end + 1) + '\nawait agent("bare injection", { label: "drift-probe" })\n';
  const stripped = stripCommentsAndStrings(tampered);
  const hits = findBareAgentCalls(stripped);
  // The probe call must be detected.
  assert.ok(
    hits.length >= 1,
    `drift probe: bare agent() injection in ${target} must be detected (saw ${hits.length} hits)`,
  );
});