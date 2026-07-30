import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  detectState,
  printStatus,
  install,
  update,
  doctor,
} = await import('./agent-browser-update.mjs');

describe('agent-browser update integration', () => {
  it('exports the supported lifecycle API', () => {
    assert.equal(typeof detectState, 'function');
    assert.equal(typeof printStatus, 'function');
    assert.equal(typeof install, 'function');
    assert.equal(typeof update, 'function');
    assert.equal(typeof doctor, 'function');
  });

  it('returns a minimal structured state', () => {
    const state = detectState();
    assert.equal(typeof state.installed, 'boolean');
    assert.ok('version' in state);
    assert.ok('bin' in state);
    if (state.installed) {
      assert.equal(typeof state.version, 'string');
      assert.equal(typeof state.bin, 'string');
    } else {
      assert.equal(state.version, null);
    }
  });

  it('prints status without requiring an installation', () => {
    const original = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(' '));
    try {
      printStatus();
    } finally {
      console.log = original;
    }
    assert.ok(output.some((line) => line.includes('agent-browser')));
  });

  it('install dry-run is side-effect free', () => {
    const before = detectState();
    const after = install({ dryRun: true, silent: true });
    assert.deepEqual(after, before);
  });

  it('update dry-run is side-effect free', () => {
    const before = detectState();
    const after = update({ dryRun: true, silent: true });
    assert.deepEqual(after, before);
  });

  it('doctor reports a missing binary without throwing', () => {
    const original = process.env.AGENT_BROWSER_BIN;
    process.env.AGENT_BROWSER_BIN = '/definitely/not/agent-browser';
    try {
      const result = doctor({ silent: true });
      assert.equal(typeof result.ok, 'boolean');
      assert.equal(typeof result.message, 'string');
    } finally {
      if (original === undefined) delete process.env.AGENT_BROWSER_BIN;
      else process.env.AGENT_BROWSER_BIN = original;
    }
  });
});
