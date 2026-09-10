import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  FALLBACK_MODELS,
  fetchGatewayModels,
  fetchModelsDev,
  runOrchestrator,
  mergeModelSources,
  parseOrchestratorArgs,
  toggleSelection,
  updateOrchestratorSettings,
  validateOrchestratorSettings,
} from './orchestrator.mjs';

const originalFetch = globalThis.fetch;
const temporaryDirectories = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('parseOrchestratorArgs defaults to pick and both sources', () => {
  assert.deepEqual(parseOrchestratorArgs([]), {
    subcommand: 'pick', help: false, list: false, json: false, yes: false,
    source: 'both', provider: null,
  });
});

test('parseOrchestratorArgs parses every subcommand', () => {
  for (const subcommand of ['pick', 'show', 'clear', 'validate']) {
    assert.equal(parseOrchestratorArgs([subcommand]).subcommand, subcommand);
  }
});

test('parseOrchestratorArgs parses source provider and output flags', () => {
  assert.deepEqual(parseOrchestratorArgs([
    'pick', '--source', 'models.dev', '--provider', 'anthropic', '--list', '--json', '--yes',
  ]), {
    subcommand: 'pick', help: false, list: true, json: true, yes: true,
    source: 'models.dev', provider: 'anthropic',
  });
});

test('updateOrchestratorSettings appends entries without overwriting existing entries', () => {
  const current = { modelPicker: [{ id: 'a' }] };
  const next = updateOrchestratorSettings(current, {
    pick: [{ id: 'b', label: 'B', description: 'd', capabilities: [] }],
  });
  assert.deepEqual(next.modelPicker, [
    { id: 'a' }, { id: 'b', label: 'B', description: 'd', capabilities: [] },
  ]);
  assert.deepEqual(current, { modelPicker: [{ id: 'a' }] });
});

test('updateOrchestratorSettings clear deletes the modelPicker array', () => {
  assert.deepEqual(updateOrchestratorSettings({ modelPicker: [{ id: 'a' }] }, { clear: true }), {});
});

test('updateOrchestratorSettings preserves unrelated environment settings', () => {
  const next = updateOrchestratorSettings({ env: { X: 'y' } }, {
    pick: [{ id: 'a', label: 'A', description: 'd', capabilities: [] }],
  });
  assert.equal(next.env.X, 'y');
});

test('mergeModelSources deduplicates with gateway presentation and models.dev capabilities', () => {
  const merged = mergeModelSources(
    [{ id: 'same', label: 'Models', description: 'models', capabilities: ['reasoning'], source: 'models.dev', provider: 'anthropic' }],
    [{ id: 'same', label: 'Gateway', description: 'gateway', capabilities: [], source: 'gateway' }, { id: 'gateway-only', label: 'G', description: 'g', capabilities: [], source: 'gateway' }],
    [],
  );
  assert.deepEqual(merged, [
    { id: 'same', label: 'Gateway', description: 'gateway', capabilities: ['reasoning'], source: 'models.dev', provider: 'anthropic' },
    { id: 'gateway-only', label: 'G', description: 'g', capabilities: [], source: 'gateway' },
  ]);
});

test('mergeModelSources returns fallback when both lists are empty', () => {
  assert.deepEqual(mergeModelSources([], [], FALLBACK_MODELS), FALLBACK_MODELS);
});

test('validateOrchestratorSettings accepts known unique ids', () => {
  assert.equal(validateOrchestratorSettings({ modelPicker: [{ id: 'a' }] }, [{ id: 'a' }]).ok, true);
  assert.deepEqual(validateOrchestratorSettings({ modelPicker: [{ id: 'a' }] }, [{ id: 'a' }]).unknown, []);
});

test('validateOrchestratorSettings reports unknown ids', () => {
  const result = validateOrchestratorSettings({ modelPicker: [{ id: 'missing' }] }, [{ id: 'a' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknown, ['missing']);
});

test('validateOrchestratorSettings reports duplicate ids', () => {
  const result = validateOrchestratorSettings({ modelPicker: [{ id: 'a' }, { id: 'a' }] }, [{ id: 'a' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicates, ['a']);
});

test('fetchModelsDev normalizes provider model metadata and capability flags', async () => {
  const cachePath = `${mkdtempSync(`${tmpdir()}/bizar-orchestrator-`)}/cache.json`;
  temporaryDirectories.push(cachePath.slice(0, cachePath.lastIndexOf('/')));
  globalThis.fetch = async () => new Response(JSON.stringify({
    anthropic: { models: {
      'claude-test': {
        name: 'Test', attachment: true, reasoning: true, tool_call: false,
        structured_output: true,
      },
    } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const models = await fetchModelsDev({ cachePath, force: true });
  assert.deepEqual(models[0], {
    id: 'claude-test', label: 'Test', description: 'From models.dev',
    capabilities: ['reasoning', 'structured_output', 'attachment'],
    source: 'models.dev', provider: 'anthropic',
  });
});

test('fetchGatewayModels normalizes data and models response shapes', async () => {
  for (const payload of [{ data: [{ id: 'a', display_name: 'A', description: 'D' }] }, { models: [{ id: 'b' }] }]) {
    globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
    const models = await fetchGatewayModels('https://gateway.example', 'token');
    assert.equal(models.length, 1);
    assert.equal(models[0].id, payload.data?.[0]?.id ?? payload.models[0].id);
    assert.equal(models[0].source, 'gateway');
  }
});

test('toggleSelection returns a new set with the id toggled', () => {
  const selected = new Set(['a']);
  assert.deepEqual(toggleSelection(selected, 'a'), new Set());
  assert.deepEqual(toggleSelection(selected, 'b'), new Set(['a', 'b']));
});

test('orchestrator refuses agent-context operations', () => {
  const configDir = mkdtempSync(`${tmpdir()}/bizar-orchestrator-config-`);
  temporaryDirectories.push(configDir);
  const bin = fileURLToPath(new URL('../bin.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [bin, 'orchestrator', 'show', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, BIZAR_AGENT: '1', CLAUDE_CONFIG_DIR: configDir },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /operator-only|agent context/i);
});

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    rmSync(directory, { recursive: true, force: true });
  }
});
