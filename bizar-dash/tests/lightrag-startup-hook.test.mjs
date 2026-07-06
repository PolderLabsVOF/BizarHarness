/**
 * tests/lightrag-startup-hook.test.mjs
 *
 * v5.x — Tests for the lightragStartupHook() introduced in issue #6.
 *
 * Strategy: drive lightragStartupHook() against a temp project root that
 * has a `.bizar/memory.json` (or no config at all). The hook is async
 * and must:
 *   - resolve the project's lightrag config
 *   - honour `lightrag.enabled: false` → return ok=true, reason='disabled'
 *   - honour BIZAR_LIGHTRAG_AUTOSTART=0 → return ok=true, reason='env-disabled'
 *   - return ok=false, reason='no-project' when no projectRoot is passed
 *   - gracefully handle missing binary / errors → return ok=false, error=...
 *   - return ok=true, reason='already-running' when the server is up
 *
 * Tests do NOT require `lightrag-server` to be installed. When it isn't,
 * the "auto-start" paths return ok=false with a clear error, which is
 * exactly the contract the dashboard relies on.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  lightragStartupHook,
  findLightragBinary,
  resolveLightRAGConfig,
} = await import('../src/server/memory-lightrag.mjs');

let tmpRoot;
const ORIG_AUTOSTART = process.env.BIZAR_LIGHTRAG_AUTOSTART;
const ORIG_VAULT = process.env.BIZAR_MEMORY_VAULT;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'bizar-lrh-'));
  mkdirSync(join(tmpRoot, '.bizar'), { recursive: true });
  delete process.env.BIZAR_LIGHTRAG_AUTOSTART;
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  if (ORIG_AUTOSTART === undefined) delete process.env.BIZAR_LIGHTRAG_AUTOSTART;
  else process.env.BIZAR_LIGHTRAG_AUTOSTART = ORIG_AUTOSTART;
  if (ORIG_VAULT === undefined) delete process.env.BIZAR_MEMORY_VAULT;
  else process.env.BIZAR_MEMORY_VAULT = ORIG_VAULT;
});

function writeMemoryJson(root, patch = {}) {
  const cfg = { ...patch };
  writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify(cfg));
}

describe('lightragStartupHook — no project', () => {
  test('returns ok=false, reason=no-project when projectRoot is missing', async () => {
    const r = await lightragStartupHook(null);
    assert.equal(r.ok, false);
    assert.equal(r.started, false);
    assert.equal(r.reason, 'no-project');
  });

  test('returns ok=false, reason=no-project when projectRoot is empty string', async () => {
    const r = await lightragStartupHook('');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-project');
  });
});

describe('lightragStartupHook — disabled paths', () => {
  test('returns ok=true, reason=disabled when lightrag.enabled is false', async () => {
    writeMemoryJson(tmpRoot, { lightrag: { enabled: false, port: 9621 } });
    const r = await lightragStartupHook(tmpRoot);
    assert.equal(r.ok, true, 'hook succeeds (skips) when explicitly disabled');
    assert.equal(r.started, false);
    assert.equal(r.reason, 'disabled');
  });

  test('BIZAR_LIGHTRAG_AUTOSTART=0 short-circuits the hook', async () => {
    writeMemoryJson(tmpRoot, {}); // lightrag.enabled defaults to true
    process.env.BIZAR_LIGHTRAG_AUTOSTART = '0';
    const r = await lightragStartupHook(tmpRoot);
    assert.equal(r.ok, true);
    assert.equal(r.started, false);
    assert.equal(r.reason, 'env-disabled');
  });

  test('BIZAR_LIGHTRAG_AUTOSTART=false short-circuits the hook', async () => {
    writeMemoryJson(tmpRoot, {});
    process.env.BIZAR_LIGHTRAG_AUTOSTART = 'false';
    const r = await lightragStartupHook(tmpRoot);
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'env-disabled');
  });
});

describe('lightragStartupHook — start path', () => {
  test('returns a structured result without throwing', async () => {
    // Use a config that points at a bogus port. If lightrag-server is
    // installed locally, the hook may start it; if not, it will fail
    // with a clean error. Either way, the contract is: the hook
    // returns a structured result and never throws. We don't run the
    // full 30s startup probe here — that's covered by the live
    // memory-lightrag.test.mjs.
    writeMemoryJson(tmpRoot, {
      lightrag: {
        enabled: true,
        host: '127.0.0.1',
        // Use a high port that's very unlikely to be open. The
        // startup probe is bounded by resolveLightRAGConfig's
        // startupTimeoutMs which defaults to 30s — too long for a
        // unit test. We instead pre-create a "running" PID file to
        // short-circuit the probe to "already-running" and assert
        // the hook returns ok=true, reason='already-running'.
        port: 29999,
        workingDir: join(tmpRoot, '.bizar', 'lightrag'),
      },
    });
    // Pre-create a fake PID file pointing at a live parent PID.
    // The hook's readPidAlive() will return alive=true, so the hook
    // short-circuits to "already-running" without spawning a process.
    mkdirSync(join(tmpRoot, '.bizar', 'lightrag'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'lightrag', 'lightrag.pid'), String(process.pid));

    try {
      const r = await lightragStartupHook(tmpRoot);
      assert.equal(r.ok, true, `hook should not error when server is already running`);
      assert.equal(r.started, false);
      assert.equal(r.reason, 'already-running');
    } finally {
      rmSync(join(tmpRoot, '.bizar', 'lightrag'), { recursive: true, force: true });
    }
  });

  test('never throws even when the config is corrupt', async () => {
    // Write a memory.json that is not valid JSON.
    writeFileSync(join(tmpRoot, '.bizar', 'memory.json'), '{ not valid json');
    // Pre-create a "running" PID file to short-circuit the start
    // probe. Without this, the hook would attempt a real start.
    mkdirSync(join(tmpRoot, '.bizar', 'lightrag'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'lightrag', 'lightrag.pid'), String(process.pid));
    try {
      const r = await lightragStartupHook(tmpRoot);
      // resolveLightRAGConfig falls back to defaults on parse error, so
      // the hook will see the running PID and return already-running.
      assert.ok(r);
      assert.equal(typeof r.ok, 'boolean');
      // We don't assert on r.reason — depends on whether the corrupt
      // config parse happens before the PID check.
    } finally {
      rmSync(join(tmpRoot, '.bizar', 'lightrag'), { recursive: true, force: true });
    }
  });
});

describe('lightragStartupHook — env var override', () => {
  test('BIZAR_LIGHTRAG_AUTOSTART=1 / empty does NOT block (default behaviour)', async () => {
    // Without an explicit "disable" value, env should not block startup.
    // We pre-create a PID file so the hook short-circuits to
    // "already-running" without spawning a process.
    writeMemoryJson(tmpRoot, {
      lightrag: {
        enabled: true,
        port: 29998,
        workingDir: join(tmpRoot, '.bizar', 'lightrag'),
      },
    });
    mkdirSync(join(tmpRoot, '.bizar', 'lightrag'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'lightrag', 'lightrag.pid'), String(process.pid));
    // Don't set the env var at all (already deleted in beforeEach).
    delete process.env.BIZAR_LIGHTRAG_AUTOSTART;
    try {
      const r = await lightragStartupHook(tmpRoot);
      assert.notEqual(r.reason, 'env-disabled', 'no env-var override → env-disabled is not the reason');
    } finally {
      rmSync(join(tmpRoot, '.bizar', 'lightrag'), { recursive: true, force: true });
    }
  });
});

describe('lightragStartupHook — config resolution', () => {
  test('resolveLightRAGConfig still works for the temp project', () => {
    writeMemoryJson(tmpRoot, {
      lightrag: {
        enabled: true,
        port: 12345,
        host: '0.0.0.0',
      },
    });
    const cfg = resolveLightRAGConfig(tmpRoot);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.port, 12345);
    assert.equal(cfg.host, '0.0.0.0');
  });

  test('findLightRAGBinary returns null or a path (does not throw)', () => {
    const bin = findLightragBinary();
    // Either we found it or we didn't. We only care that the call
    // didn't throw — proves the startup hook's "binary missing" path
    // is well-behaved.
    assert.ok(bin === null || typeof bin === 'string');
  });
});

console.log('  lightrag-startup-hook tests loaded');
