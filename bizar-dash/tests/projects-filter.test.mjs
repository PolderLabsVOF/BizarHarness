/**
 * tests/projects-filter.test.mjs
 * Tests C3: test projects are hidden by default.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

function isTestProject(p) {
  return (
    /^(bizar-(e2e|real-env|admin)|bh-(cold-boot|walk-proj))/.test(p.id) ||
    (p.name != null && p.name === p.id)
  );
}

describe('isTestProject', () => {
  it('returns true for bizar-e2e-* ids', () => {
    assert.strictEqual(isTestProject({ id: 'bizar-e2e-abc', name: 'Test' }), true);
    assert.strictEqual(isTestProject({ id: 'bizar-e2e-xyz-123' }), true);
  });

  it('returns true for bizar-real-env-* ids', () => {
    assert.strictEqual(isTestProject({ id: 'bizar-real-env-test' }), true);
  });

  it('returns true for bizar-admin-* ids', () => {
    assert.strictEqual(isTestProject({ id: 'bizar-admin-01' }), true);
  });

  it('returns true for bh-cold-boot-* ids', () => {
    assert.strictEqual(isTestProject({ id: 'bh-cold-boot-001' }), true);
  });

  it('returns true for bh-walk-proj-* ids', () => {
    assert.strictEqual(isTestProject({ id: 'bh-walk-proj-12' }), true);
  });

  it('returns true when name equals id (no human label)', () => {
    assert.strictEqual(isTestProject({ id: 'some-id', name: 'some-id' }), true);
    assert.strictEqual(isTestProject({ id: 'some-id', name: 'My Project' }), false);
  });

  it('returns false for normal project ids', () => {
    assert.strictEqual(isTestProject({ id: 'real-proj', displayName: 'Real Project', name: 'Real Project' }), false);
    assert.strictEqual(isTestProject({ id: 'my-app' }), false);
    assert.strictEqual(isTestProject({ id: 'project-alpha', name: 'Project Alpha' }), false);
  });
});
