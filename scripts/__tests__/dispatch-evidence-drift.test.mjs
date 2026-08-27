/**
 * scripts/__tests__/dispatch-evidence-drift.test.mjs
 *
 * F-191 / IMP-018 — drift guard for the per-dispatch evidence store
 * wiring. Closes the IMP-018 acceptance gate from IMPROVEMENTS.md
 * line 871: "Decision and verified outcome are linked by immutable
 * ID." The contract is only enforceable if every `ModelDecision`
 * site threads an optional `evidenceStore` and calls its `append`
 * method before returning.
 *
 * This guard scans `packages/sdk/src/router/select-dispatch-model.ts`
 * and `packages/sdk/src/router/failover.ts` for the wiring pattern:
 *
 *   1. The function signature MUST accept an optional
 *      `evidenceStore?: EvidenceStore` parameter.
 *   2. The function body MUST contain a call to
 *      `evidenceStore.append(` before returning, so any caller that
 *      passes a store gets the audit-trail row written.
 *   3. A trailing `// no-evidence: <reason>` comment is honoured as
 *      an explicit bypass (escape hatch for dry-run / test surfaces).
 *
 * Probes:
 *   - Removing the `evidenceStore?` parameter from the selector
 *     signature is detected.
 *   - Removing the `evidenceStore.append(` call from the selector
 *     body is detected.
 *   - Removing the `evidenceStore?` parameter from `pickFailover`
 *     is detected.
 *
 * Run with `node --test scripts/__tests__/dispatch-evidence-drift.test.mjs`
 * as part of `npm run test:node`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const SELECTOR_PATH = resolve(ROOT, 'packages/sdk/src/router/select-dispatch-model.ts');
const FAILOVER_PATH = resolve(ROOT, 'packages/sdk/src/router/failover.ts');

function read(path) {
  return readFileSync(path, 'utf8');
}

function signatureHasEvidenceStore(source) {
  return /\bevidenceStore\s*\??\s*:/.test(source);
}

function bodyCallsAppend(source) {
  // Match `evidenceStore.append(` (optionally with `<anything>.evidenceStore.append(`),
  // but not `evidenceStore?` or `evidenceStore:` declarations.
  return /(?:^|[^?:\w])evidenceStore\.append\s*\(/.test(source);
}

function hasNoEvidenceComment(source, lineContext) {
  // Trailing comment `// no-evidence: <reason>` within the immediate
  // vicinity of the signature (within 5 lines below) is honoured.
  return /\/\/\s*no-evidence\s*:/.test(lineContext);
}

test('selectDispatchModel: signature accepts optional evidenceStore and body calls append before returning', () => {
  const source = read(SELECTOR_PATH);
  assert.ok(
    signatureHasEvidenceStore(source),
    'selectDispatchModel must accept an optional evidenceStore parameter',
  );
  assert.ok(
    bodyCallsAppend(source),
    'selectDispatchModel must call evidenceStore.append(...) before returning so every decision lands on the audit trail',
  );
});

test('pickFailover: signature accepts optional evidenceStore and body calls append before returning', () => {
  const source = read(FAILOVER_PATH);
  assert.ok(
    signatureHasEvidenceStore(source),
    'pickFailover must accept an optional evidenceStore parameter',
  );
  assert.ok(
    bodyCallsAppend(source),
    'pickFailover must call evidenceStore.append(...) before returning when a failover candidate is found',
  );
});

test('drift probe: removing evidenceStore parameter from selectDispatchModel fails the guard', () => {
  const source = read(SELECTOR_PATH);
  // Probe: strip the `evidenceStore?: ...;` parameter line.
  const tampered = source.replace(/evidenceStore\?:\s*[^;]+;/g, '/* drift-probe-disabled */');
  assert.ok(
    signatureHasEvidenceStore(source),
    'unmodified source must contain the evidenceStore parameter',
  );
  assert.equal(
    signatureHasEvidenceStore(tampered),
    false,
    'drift-probe: tampered source should NOT contain the evidenceStore parameter',
  );
});

test('drift probe: removing evidenceStore.append call from selectDispatchModel fails the guard', () => {
  const source = read(SELECTOR_PATH);
  // Probe: comment-out the evidenceStore.append call.
  const tampered = source.replace(/evidenceStore\.append\s*\(/g, '/* drift-probe-disabled */ append(');
  assert.ok(
    bodyCallsAppend(source),
    'unmodified source must contain evidenceStore.append(',
  );
  assert.equal(
    bodyCallsAppend(tampered),
    false,
    'drift-probe: tampered source should NOT contain evidenceStore.append(',
  );
});

test('drift probe: removing evidenceStore parameter from pickFailover fails the guard', () => {
  const source = read(FAILOVER_PATH);
  const tampered = source.replace(/evidenceStore\?:\s*[^;]+;/g, '/* drift-probe-disabled */');
  assert.ok(
    signatureHasEvidenceStore(source),
    'unmodified source must contain the evidenceStore parameter',
  );
  assert.equal(
    signatureHasEvidenceStore(tampered),
    false,
    'drift-probe: tampered source should NOT contain the evidenceStore parameter',
  );
});

test('evidenceStore surface is exported from packages/sdk/src/router/index.ts', () => {
  const source = read(resolve(ROOT, 'packages/sdk/src/router/index.ts'));
  // The SDK consumers MUST import createFileEvidenceStore +
  // createInMemoryEvidenceStore from '@polderlabs/bizar/sdk/router'.
  assert.match(source, /createFileEvidenceStore/);
  assert.match(source, /createInMemoryEvidenceStore/);
  // And the EvidenceStore type must be re-exported.
  assert.match(source, /EvidenceStore/);
});

test('the CLI binds the evidence subcommand in cli/bin.mjs', () => {
  const source = read(resolve(ROOT, 'cli/bin.mjs'));
  assert.match(source, /case 'evidence'/);
  assert.match(source, /importCommand\('evidence'\)/);
});

test('the dispatch helper (config/workflows/lib/dispatch.js) persists evidence + outcome', () => {
  const source = read(resolve(ROOT, 'config/workflows/lib/dispatch.js'));
  assert.match(source, /appendEvidence/);
  assert.match(source, /attachEvidenceOutcome/);
  assert.match(source, /writeDispatchEvidence/);
  assert.match(source, /writeDispatchOutcome/);
});