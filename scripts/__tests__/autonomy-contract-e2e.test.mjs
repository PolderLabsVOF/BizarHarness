/**
 * scripts/__tests__/autonomy-contract-e2e.test.mjs —
 * Drift guard for IMP-022 / F-192 (E2E fixtures contract).
 *
 * Fails CI if:
 *   1. Any production code under `packages/sdk/src/` imports one of
 *      the E2E fixture modules (`agent-tool-stub.mjs`,
 *      `provider-stub.mjs`, `team-spawn-stub.mjs`, `evidence-store-stub.mjs`,
 *      `dispatch-context.mjs`). These are TEST FIXTURES — production
 *      code MUST use the real implementation surface (`Agent` tool,
 *      provider client, team-spawn runtime, F-191 `EvidenceStore`,
 *      `dispatchAgent`).
 *   2. Any of the three stub factories lose a documented method or
 *      change shape in a way that breaks the documented Agent-tool /
 *      provider / team-spawn interface.
 *   3. A drift-probe that injects a stub import into a production file
 *      fails CI (proves the guard actually fires).
 *
 * The drift guard is the static-source counterpart to the runtime
 * `direct-selection` / `workflow-selection` / `team-selection` /
 * `matrix` tests. Together they prove the E2E matrix is a closed
 * boundary.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const sdkSrc = resolve(repoRoot, 'packages/sdk/src');
const e2eFixturesDir = resolve(repoRoot, 'packages/sdk/tests/e2e/_fixtures');

const STUB_FIXTURES = [
  'agent-tool-stub.mjs',
  'provider-stub.mjs',
  'team-spawn-stub.mjs',
  'evidence-store-stub.mjs',
  'dispatch-context.mjs',
];

function listProductionFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) out.push(...listProductionFiles(abs));
    else if (/\.ts$/.test(entry)) out.push(abs);
  }
  return out.sort();
}

/**
 * Strip comments + string literals so we don't false-positive on
 * fixture path mentions in JSDoc / docs.
 */
function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  let inString = null;
  let escape = false;
  while (i < source.length) {
    const ch = source[i];
    if (escape) { out += ch; escape = false; i++; continue; }
    if (inString) {
      if (ch === '\\') { out += ch; escape = true; i++; continue; }
      if (ch === inString) inString = null;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
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

test('autonomy-contract-e2e: no production code under packages/sdk/src/ imports the E2E fixtures', () => {
  const files = listProductionFiles(sdkSrc);
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const stripped = stripCommentsAndStrings(source);
    for (const fixture of STUB_FIXTURES) {
      // Match import statements that target the fixture (any relative path).
      const re = new RegExp(`from\\s+['"][^'"]*${fixture.replace(/\./g, '\\.')}['"]`);
      if (re.test(stripped)) {
        violations.push(`${file}: imports E2E fixture ${fixture}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `production code MUST NOT import E2E fixtures\n${violations.join('\n')}`,
  );
});

test('autonomy-contract-e2e: agent-tool-stub exposes the documented interface (captured/reset/invoke/install/restore)', async () => {
  const path = join(e2eFixturesDir, 'agent-tool-stub.mjs');
  const mod = await import(path);
  const stub = mod.createAgentToolStub();
  for (const key of ['captured', 'reset', 'invoke', 'install', 'restore']) {
    assert.ok(key in stub, `agent-tool-stub must expose \`${key}\``);
  }
  // Invoke records the augmented payload.
  await stub.invoke({ prompt: 'p', payload: { model: 'm', routingDecisionId: 'd' } });
  assert.equal(stub.captured.length, 1);
  assert.equal(stub.captured[0].payload.model, 'm');
  assert.equal(stub.captured[0].payload.routingDecisionId, 'd');
});

test('autonomy-contract-e2e: provider-stub exposes the documented interface (mode/requests/call/reset) and honors substitution + transport errors', async () => {
  const path = join(e2eFixturesDir, 'provider-stub.mjs');
  const mod = await import(path);

  // agree mode
  const agree = mod.createProviderStub({ mode: 'agree' });
  const r = await agree.call({ requestedModel: 'm', decisionId: 'd' });
  assert.equal(r.resolvedModel, 'm');
  assert.equal(r.substitution, false);

  // substitute mode
  const sub = mod.createProviderStub({ mode: 'substitute', substitutionMap: { 'm': 'substituted' } });
  const r2 = await sub.call({ requestedModel: 'm', decisionId: 'd' });
  assert.equal(r2.resolvedModel, 'substituted');
  assert.equal(r2.substitution, true);

  // fail mode raises typed transport error
  const fail = mod.createProviderStub({ mode: 'fail' });
  await assert.rejects(fail.call({ requestedModel: 'm', decisionId: 'd' }), (err) => err?.code === 'transport');

  // auth mode raises typed auth error
  const auth = mod.createProviderStub({ mode: 'auth' });
  await assert.rejects(auth.call({ requestedModel: 'm', decisionId: 'd' }), (err) => err?.code === 'auth');
});

test('autonomy-contract-e2e: team-spawn-stub exposes the documented interface (members/spawn/join/reset) and per-spawn uniqueness', async () => {
  const path = join(e2eFixturesDir, 'team-spawn-stub.mjs');
  const mod = await import(path);
  const stub = mod.createTeamSpawnStub();
  for (const key of ['members', 'spawn', 'join', 'reset']) {
    assert.ok(key in stub, `team-spawn-stub must expose \`${key}\``);
  }
  const m1 = await stub.spawn('implementer', { routingDecisionId: 'd1' });
  const m2 = await stub.spawn('implementer', { routingDecisionId: 'd2' });
  assert.equal(stub.members.length, 2);
  assert.equal(m1.dispatchId, 'd1');
  assert.equal(m2.dispatchId, 'd2');
  assert.notEqual(m1.dispatchId, m2.dispatchId);
});

test('autonomy-contract-e2e: drift probe — injecting a stub import into packages/sdk/src/ fails CI', () => {
  // Probe: any `.ts` file under packages/sdk/src/ that gets a
  // bare `from '../tests/e2e/_fixtures/agent-tool-stub.mjs'` import
  // must be detected. We pick a representative target — the SDK
  // router index — and assert the probe regex detects the injected
  // fixture import.
  const target = resolve(repoRoot, 'packages/sdk/src/router/index.ts');
  const source = readFileSync(target, 'utf8');
  const stripped = stripCommentsAndStrings(source);
  const probe = `import { createAgentToolStub } from '../tests/e2e/_fixtures/agent-tool-stub.mjs';\n` + source;
  const strippedProbe = stripCommentsAndStrings(probe);

  let detected = false;
  for (const fixture of STUB_FIXTURES) {
    const re = new RegExp(`from\\s+['"][^'"]*${fixture.replace(/\./g, '\\.')}['"]`);
    if (re.test(strippedProbe)) {
      detected = true;
      break;
    }
  }
  assert.ok(detected, 'drift probe: injecting a stub import must be detected');
  // And the original production file does NOT currently have the import.
  for (const fixture of STUB_FIXTURES) {
    const re = new RegExp(`from\\s+['"][^'"]*${fixture.replace(/\./g, '\\.')}['"]`);
    assert.ok(!re.test(stripped), `production file ${target} must not import ${fixture}`);
  }
});