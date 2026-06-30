/**
 * tests/memory-lightrag.test.mjs
 *
 * v4.1.0 — Tests for the LightRAG orchestrator.
 *
 * Skips entirely if `lightrag-server` is not installed (the user can
 * install it with `uv tool install "lightrag-hku[api]"`).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname || join(__filename, '..');

const {
  findLightragBinary,
  isInstalled,
  resolveLightRAGConfig,
  reindexVault,
  query,
  isRunning,
} = await import('../src/server/memory-lightrag.mjs');

const lightragAvailable = findLightragBinary() !== null;

describe('memory-lightrag — preflight', { skip: !lightragAvailable }, () => {
  test('findLightragBinary returns a path', () => {
    const bin = findLightragBinary();
    assert.ok(bin, 'expected binary path');
    assert.ok(existsSync(bin), `expected ${bin} to exist`);
  });

  test('isInstalled returns true', async () => {
    const ok = await isInstalled();
    assert.equal(ok, true);
  });
});

describe('memory-lightrag — config', { skip: !lightragAvailable }, () => {
  test('resolveLightRAGConfig returns defaults when no memory.json', () => {
    const fakeRoot = join(tmpdir(), 'bizar-memlight-test-no-config-' + Date.now());
    mkdirSync(fakeRoot, { recursive: true });
    try {
      const cfg = resolveLightRAGConfig(fakeRoot);
      assert.equal(cfg.enabled, true);
      assert.equal(cfg.host, '127.0.0.1');
      assert.equal(cfg.port, 9621);
      assert.ok(cfg.workingDir.includes('.bizar/lightrag'));
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  test('resolveLightRAGConfig reads user memory.json', () => {
    const fakeRoot = join(tmpdir(), 'bizar-memlight-test-cfg-' + Date.now());
    mkdirSync(join(fakeRoot, '.bizar'), { recursive: true });
    writeFileSync(join(fakeRoot, '.bizar', 'memory.json'), JSON.stringify({
      lightrag: { enabled: false, port: 9999, host: '0.0.0.0' },
    }));
    try {
      const cfg = resolveLightRAGConfig(fakeRoot);
      assert.equal(cfg.enabled, false);
      assert.equal(cfg.port, 9999);
      assert.equal(cfg.host, '0.0.0.0');
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});

describe('memory-lightrag — reindex (live)', { skip: !lightragAvailable }, () => {
  let tmpRoot;
  let noteCount = 0;

  before(async () => {
    tmpRoot = join(tmpdir(), 'bizar-memlight-test-' + Date.now());
    const bizarDir = join(tmpRoot, '.bizar');
    mkdirSync(join(bizarDir, 'memory'), { recursive: true });
    mkdirSync(join(bizarDir, 'memory', 'projects', 'testproj'), { recursive: true });

    // Write a minimal memory.json (managed mode).
    writeFileSync(join(bizarDir, 'memory.json'), JSON.stringify({
      version: 1,
      backend: 'bizar-local',
      projectId: 'testproj',
      memoryRepo: {
        mode: 'managed',
        path: join(bizarDir, 'memory'),
        remote: null,
        branch: 'main',
        namespace: 'projects/testproj',
      },
      namespaces: {
        project: 'projects/testproj',
        global: 'global/bizar',
        user: 'users/local',
      },
      lightrag: {
        enabled: true,
        host: '127.0.0.1',
        port: 9621,
        workingDir: join(bizarDir, 'lightrag'),
      },
    }));

    // Write a couple of test notes.
    const noteA = `---
memory_id: mem_test_a
type: architecture_decision
project_id: testproj
status: active
confidence: verified
created: 2026-06-29T00:00:00Z
updated: 2026-06-29T00:00:00Z
tags: [test]
---

# Test decision A

LightRAG should be reachable.`;
    writeFileSync(join(bizarDir, 'memory', 'projects', 'testproj', 'a.md'), noteA);
    noteCount = 1;
  });

  test('reindexVault writes a marker file', async () => {
    const result = await reindexVault(tmpRoot, {});
    // LightRAG server may not start if no LLM creds are present (default
    // binding is ollama). We assert the orchestrator produced a result
    // and wrote a marker file regardless of insert success.
    assert.ok(result, 'reindexVault returned a result');
    assert.ok(result.noteCount >= 1, `should report at least one note, got ${result.noteCount}`);
    assert.ok(result.markerPath, 'markerPath must be set');
    assert.ok(existsSync(result.markerPath), 'marker file must exist on disk');
    const marker = JSON.parse(readFileSync(result.markerPath, 'utf8'));
    assert.ok(marker.attemptedAt, 'marker has attemptedAt');
    assert.equal(marker.noteCount, noteCount, 'marker counts all notes');
    assert.equal(typeof marker.durationMs, 'number');
    assert.equal(typeof marker.inserted, 'number');
    assert.equal(typeof marker.failed, 'number');
  }, { timeout: 60_000 });

  test('isRunning reports server health', async () => {
    const cfg = resolveLightRAGConfig(tmpRoot);
    const running = await isRunning(cfg);
    // We don't assert running=true — the server may not be up in CI.
    assert.equal(typeof running, 'boolean');
  });
});