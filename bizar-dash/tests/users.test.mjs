/**
 * tests/users.test.mjs
 *
 * v5.0.0 — Tests for the users route handlers.
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mkdirSync,
  rmSync,
} from 'node:fs';

// These are tested via the REST API in workspaces.test.mjs (user-related functions)
// This file tests the users store functions directly.

const TEST_ID = `bizar-user-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEST_HOME = join(tmpdir(), TEST_ID);
const BIZAR_LOCAL = join(TEST_HOME, '.local', 'share', 'bizar');
const WORKSPACES_ROOT = join(BIZAR_LOCAL, 'workspaces');

const originalHomedir = process.env.HOME;
process.env.HOME = TEST_HOME;

describe('users', () => {
  let cleanupDirs = [];

  beforeEach(() => {
    mkdirSync(BIZAR_LOCAL, { recursive: true });
    cleanupDirs.push(TEST_HOME);
  });

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanupDirs = [];
  });

  after(() => {
    process.env.HOME = originalHomedir;
  });

  // Users are managed through the workspaces module (index.json users array)
  // This test verifies user CRUD through workspaces

  describe('user CRUD via workspaces module', () => {
    it('getOrCreateUser creates user and persists to index', async () => {
      const ws = await import('../src/server/workspaces.mjs');
      const { user, created } = await ws.getOrCreateUser('test@example.com', 'Test User');

      assert.ok(created);
      assert.ok(user.id.startsWith('usr_'));
      assert.strictEqual(user.email, 'test@example.com');
      assert.strictEqual(user.name, 'Test User');

      // Verify persisted
      const found = await ws.getUser(user.id);
      assert.ok(found);
      assert.strictEqual(found.email, 'test@example.com');
    });

    it('getUser returns user by id', async () => {
      const ws = await import('../src/server/workspaces.mjs');
      const { user } = await ws.getOrCreateUser('findme@example.com', 'Find Me');

      const found = await ws.getUser(user.id);
      assert.ok(found);
      assert.strictEqual(found.id, user.id);
      assert.strictEqual(found.name, 'Find Me');
    });

    it('getUser returns null for non-existent user', async () => {
      const ws = await import('../src/server/workspaces.mjs');
      const found = await ws.getUser('usr_nonexistent');
      assert.strictEqual(found, null);
    });

    it('updateUser updates name and email', async () => {
      const ws = await import('../src/server/workspaces.mjs');
      const { user } = await ws.getOrCreateUser('original@example.com', 'Original Name');

      const updated = await ws.updateUser(user.id, {
        name: 'Updated Name',
        email: 'updated@example.com',
      });

      assert.strictEqual(updated.name, 'Updated Name');
      assert.strictEqual(updated.email, 'updated@example.com');

      // Verify persisted
      const found = await ws.getUser(user.id);
      assert.strictEqual(found.name, 'Updated Name');
      assert.strictEqual(found.email, 'updated@example.com');
    });

    it('email matching is case-insensitive', async () => {
      const ws = await import('../src/server/workspaces.mjs');
      const { user } = await ws.getOrCreateUser('case@test.com', 'Case Test');

      // Try to get or create with different case
      const found = await ws.getOrCreateUser('CASE@TEST.COM', 'Different Case');
      assert.strictEqual(found.created, false);
      assert.strictEqual(found.user.id, user.id);
    });
  });
});
