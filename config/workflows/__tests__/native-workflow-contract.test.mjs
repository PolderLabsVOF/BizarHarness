import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  inspectNativeWorkflowSource,
  validateNativeWorkflowDirectory,
} from '../lib/native-contract.mjs';

const workflowsDir = resolve(import.meta.dirname, '..');

test('every shipped workflow satisfies Claude native discovery grammar', () => {
  const result = validateNativeWorkflowDirectory(workflowsDir);
  assert.equal(result.count, 6);
  assert.deepEqual(result.names.sort(), [
    'bizar-debug',
    'bizar-implement',
    'bizar-research',
    'ultracode',
    'ultracode-research',
    'ultracode-review',
  ]);
});

test('native grammar rejects an import before metadata with Claude-compatible guidance', () => {
  const source = readFileSync(resolve(workflowsDir, 'bizar-research.js'), 'utf8');
  assert.throws(
    () => inspectNativeWorkflowSource(`import './setup.js'\n${source}`),
    /must be the FIRST statement/,
  );
});

test('native grammar rejects imports after metadata and invalid workflow bodies', () => {
  const meta = "export const meta = { name: 'probe', description: 'x', phases: [] }\n";
  assert.throws(() => inspectNativeWorkflowSource(`${meta}import 'node:fs'`), /imports are unavailable/);
  assert.throws(() => inspectNativeWorkflowSource(`${meta}const = broken`), /does not compile/);
});

test('native grammar rejects filename and literal metadata drift', () => {
  assert.throws(
    () => inspectNativeWorkflowSource("export const meta = { name: 'wrong', description: 'x', phases: [] }", { expectedName: 'expected' }),
    /does not match filename/,
  );
  assert.throws(
    () => inspectNativeWorkflowSource("export const meta = { name: 'expected', phases: [] }"),
    /meta\.description/,
  );
});
