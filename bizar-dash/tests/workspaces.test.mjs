/**
 * tests/workspaces.test.mjs
 *
 * v5.0.0 — Tests for the workspaces module.
 */
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';

// Override BIZAR_HOME to use a temp directory
const TEST_ID = `bizar-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEST_HOME = join(tmpdir(), TEST_ID);
const BIZAR_LOCAL = join(TEST_HOME, '.local', 'share', 'bizar');
const WORKSPACES_ROOT = join(BIZAR_LOCAL, 'workspaces');

// Store original HOME and set test HOME before importing
const originalHomedir = process.env.HOME;
process.env.HOME = TEST_HOME;

async function importWorkspaces() {
  // Re-import with our mocked HOME env - use createRequire to handle cache
  const modulePath = `../src/server/workspaces.mjs?ts=${Date.now()}`;
  return import(modulePath);
}

describe('workspaces', () => {
  let cleanupDirs = [];

  beforeEach(() => {
    // Create fresh temp directory
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

  // ── Default workspace creation ───────────────────────────────────────────────

  describe('ensureDefaultWorkspace', () => {
    it('creates a default workspace when none exist', async () => {
      const ws = await importWorkspaces();
      const result = await ws.ensureDefaultWorkspace({
        userId: 'usr_test123',
        email: 'test@example.com',
        name: 'Test User',
      });

      assert.ok(result.workspace);
      assert.strictEqual(result.workspace.name, 'Default Workspace');
      assert.strictEqual(result.workspace.ownerId, 'usr_test123');
      assert.ok(result.workspace.id.startsWith('ws_'));
    });

    it('returns existing workspace if one already exists', async () => {
      const ws = await importWorkspaces();
      const first = await ws.ensureDefaultWorkspace({
        userId: 'usr_test123',
        email: 'test@example.com',
        name: 'Test User',
      });

      const second = await ws.ensureDefaultWorkspace({
        userId: 'usr_test456',
        email: 'other@example.com',
        name: 'Other User',
      });

      assert.strictEqual(first.workspace.id, second.workspace.id);
    });

    it('sets file mode 0700 on workspace directories', async () => {
      const ws = await importWorkspaces();
      await ws.ensureDefaultWorkspace({
        userId: 'usr_test123',
        email: 'test@example.com',
        name: 'Test User',
      });

      const stat = statSync(WORKSPACES_ROOT);
      assert.strictEqual(stat.mode & 0o777, 0o700);
    });
  });

  // ── Workspace CRUD ───────────────────────────────────────────────────────────

  describe('createWorkspace', () => {
    it('creates a new workspace with a unique id', async () => {
      const ws = await importWorkspaces();
      const result = await ws.createWorkspace({
        name: 'My Workspace',
        ownerId: 'usr_owner',
      });

      assert.ok(result.id.startsWith('ws_'));
      assert.strictEqual(result.name, 'My Workspace');
      assert.strictEqual(result.ownerId, 'usr_owner');
      assert.ok(result.createdAt);
    });

    it('persists the workspace to index.json', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Persisted',
        ownerId: 'usr_owner',
      });

      const indexFile = join(WORKSPACES_ROOT, 'index.json');
      assert.ok(existsSync(indexFile));
      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      assert.ok(index.workspaces.some((w) => w.id === created.id));
    });
  });

  describe('getWorkspace', () => {
    it('returns workspace by id', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Find Me',
        ownerId: 'usr_owner',
      });

      const found = await ws.getWorkspace(created.id);
      assert.ok(found);
      assert.strictEqual(found.id, created.id);
      assert.strictEqual(found.name, 'Find Me');
    });

    it('returns null for non-existent workspace', async () => {
      const ws = await importWorkspaces();
      const found = await ws.getWorkspace('ws_nonexistent');
      assert.strictEqual(found, null);
    });
  });

  describe('listWorkspaces', () => {
    it('returns only workspaces the user is a member of', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Member Workspace',
        ownerId: 'usr_owner',
      });

      const list = await ws.listWorkspaces('usr_owner');
      assert.ok(list.some((w) => w.id === created.id));

      // User who is not a member should not see it
      const listOther = await ws.listWorkspaces('usr_stranger');
      assert.ok(!listOther.some((w) => w.id === created.id));
    });
  });

  describe('deleteWorkspace', () => {
    it('removes workspace from index', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'To Delete',
        ownerId: 'usr_owner',
      });

      await ws.deleteWorkspace(created.id);
      const found = await ws.getWorkspace(created.id);
      assert.strictEqual(found, null);
    });

    it('throws 404 for non-existent workspace', async () => {
      const ws = await importWorkspaces();
      await assert.rejects(
        ws.deleteWorkspace('ws_nonexistent'),
        (err) => err.status === 404,
      );
    });
  });

  // ── Member management ────────────────────────────────────────────────────────

  describe('addMember', () => {
    it('adds a member with the specified role', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Team Workspace',
        ownerId: 'usr_owner',
      });

      await ws.addMember(created.id, 'usr_newmember', ws.ROLES.EDITOR);

      const members = await ws.listMembers(created.id);
      const added = members.find((m) => m.userId === 'usr_newmember');
      assert.ok(added);
      assert.strictEqual(added.role, 'editor');
    });

    it('throws on invalid role', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Invalid Role Test',
        ownerId: 'usr_owner',
      });

      await assert.rejects(
        ws.addMember(created.id, 'usr_newmember', 'invalid_role'),
        (err) => err.status === 400,
      );
    });

    it('throws when adding duplicate member', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Duplicate Test',
        ownerId: 'usr_owner',
      });

      await ws.addMember(created.id, 'usr_newmember', ws.ROLES.VIEWER);
      await assert.rejects(
        ws.addMember(created.id, 'usr_newmember', ws.ROLES.EDITOR),
        (err) => err.status === 409,
      );
    });
  });

  describe('removeMember', () => {
    it('removes a member from the workspace', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Remove Test',
        ownerId: 'usr_owner',
      });

      await ws.addMember(created.id, 'usr_toremove', ws.ROLES.VIEWER);
      await ws.removeMember(created.id, 'usr_toremove');

      const members = await ws.listMembers(created.id);
      assert.ok(!members.some((m) => m.userId === 'usr_toremove'));
    });

    it('throws 404 when removing non-member', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Non-member Test',
        ownerId: 'usr_owner',
      });

      await assert.rejects(
        ws.removeMember(created.id, 'usr_notmember'),
        (err) => err.status === 404,
      );
    });
  });

  describe('updateMemberRole', () => {
    it('updates a member role', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Role Update Test',
        ownerId: 'usr_owner',
      });

      await ws.addMember(created.id, 'usr_member', ws.ROLES.VIEWER);
      await ws.updateMemberRole(created.id, 'usr_member', ws.ROLES.EDITOR);

      const members = await ws.listMembers(created.id);
      const updated = members.find((m) => m.userId === 'usr_member');
      assert.strictEqual(updated.role, 'editor');
    });
  });

  // ── Invite system ────────────────────────────────────────────────────────────

  describe('createInvite', () => {
    it('creates an invite with token and URL', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Invite Test',
        ownerId: 'usr_owner',
      });

      const result = await ws.createInvite(created.id, 'guest@example.com', ws.ROLES.EDITOR, 'usr_owner');

      assert.ok(result.token);
      assert.ok(result.token.length > 20);
      assert.ok(result.url.includes(result.token));
    });

    it('throws on invalid role', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Invalid Invite Role',
        ownerId: 'usr_owner',
      });

      await assert.rejects(
        ws.createInvite(created.id, 'guest@example.com', 'invalid', 'usr_owner'),
        (err) => err.status === 400,
      );
    });
  });

  describe('listInvites', () => {
    it('returns non-expired invites', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'List Invites Test',
        ownerId: 'usr_owner',
      });

      await ws.createInvite(created.id, 'a@example.com', ws.ROLES.EDITOR, 'usr_owner');
      await ws.createInvite(created.id, 'b@example.com', ws.ROLES.VIEWER, 'usr_owner');

      const invites = await ws.listInvites(created.id);
      assert.strictEqual(invites.length, 2);
      // Tokens should not be exposed in list
      assert.ok(!invites[0].token);
      assert.ok(!invites[0].url);
    });
  });

  describe('acceptInvite', () => {
    it('accepts invite and adds user as member', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Accept Invite Test',
        ownerId: 'usr_owner',
      });

      const { token } = await ws.createInvite(created.id, 'newuser@example.com', ws.ROLES.EDITOR, 'usr_owner');

      const result = await ws.acceptInvite(token, 'usr_newuser', 'newuser@example.com', 'New User');

      assert.ok(result.workspace);
      assert.strictEqual(result.role, 'editor');

      const members = await ws.listMembers(created.id);
      const added = members.find((m) => m.userId === 'usr_newuser');
      assert.ok(added);
      assert.strictEqual(added.role, 'editor');
    });

    it('throws 404 for invalid token', async () => {
      const ws = await importWorkspaces();
      await assert.rejects(
        ws.acceptInvite('invalid_token_123', 'usr_newuser', 'new@example.com', 'New User'),
        (err) => err.status === 404,
      );
    });

    it('throws 410 for expired invite', async () => {
      const ws = await importWorkspaces();

      // Manually create an expired invite by writing directly to the file
      const created = await ws.createWorkspace({
        name: 'Expired Invite Test',
        ownerId: 'usr_owner',
      });

      const expiredInvite = {
        token: 'expired_token_123',
        email: 'old@example.com',
        role: 'editor',
        invitedBy: 'usr_owner',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // expired 1ms ago
      };

      const invitesFile = join(WORKSPACES_ROOT, created.id, 'invites.json');
      mkdirSync(join(WORKSPACES_ROOT, created.id), { recursive: true });
      writeFileSync(invitesFile, JSON.stringify([expiredInvite]));

      await assert.rejects(
        ws.acceptInvite('expired_token_123', 'usr_user', 'old@example.com', 'Old User'),
        (err) => err.status === 410,
      );
    });
  });

  describe('revokeInvite', () => {
    it('removes invite from workspace', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Revoke Test',
        ownerId: 'usr_owner',
      });

      const { token } = await ws.createInvite(created.id, 'torevoke@example.com', ws.ROLES.VIEWER, 'usr_owner');
      await ws.revokeInvite(created.id, token);

      const invites = await ws.listInvites(created.id);
      assert.strictEqual(invites.length, 0);
    });

    it('throws 404 for non-existent invite', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Non-existent Revoke Test',
        ownerId: 'usr_owner',
      });

      await assert.rejects(
        ws.revokeInvite(created.id, 'nonexistent_token'),
        (err) => err.status === 404,
      );
    });
  });

  // ── Permission checks ────────────────────────────────────────────────────────

  describe('checkPermission', () => {
    it('admin has all permissions', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Permission Test',
        ownerId: 'usr_admin',
      });

      // Owner is already added as admin by createWorkspace
      assert.ok(await ws.checkPermission(created.id, 'usr_admin', ws.ROLES.ADMIN));
      assert.ok(await ws.checkPermission(created.id, 'usr_admin', ws.ROLES.EDITOR));
      assert.ok(await ws.checkPermission(created.id, 'usr_admin', ws.ROLES.VIEWER));
    });

    it('editor has editor and viewer permissions', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Editor Perms Test',
        ownerId: 'usr_admin',
      });

      // Owner is already admin, add a separate editor
      await ws.addMember(created.id, 'usr_editor', ws.ROLES.EDITOR);

      assert.ok(!await ws.checkPermission(created.id, 'usr_editor', ws.ROLES.ADMIN));
      assert.ok(await ws.checkPermission(created.id, 'usr_editor', ws.ROLES.EDITOR));
      assert.ok(await ws.checkPermission(created.id, 'usr_editor', ws.ROLES.VIEWER));
    });

    it('viewer has only viewer permission', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Viewer Perms Test',
        ownerId: 'usr_admin',
      });

      // Owner is already admin, add a separate viewer
      await ws.addMember(created.id, 'usr_viewer', ws.ROLES.VIEWER);

      assert.ok(!await ws.checkPermission(created.id, 'usr_viewer', ws.ROLES.ADMIN));
      assert.ok(!await ws.checkPermission(created.id, 'usr_viewer', ws.ROLES.EDITOR));
      assert.ok(await ws.checkPermission(created.id, 'usr_viewer', ws.ROLES.VIEWER));
    });

    it('non-member has no permissions', async () => {
      const ws = await importWorkspaces();
      const created = await ws.createWorkspace({
        name: 'Non-member Perms Test',
        ownerId: 'usr_admin',
      });

      // Owner is already admin, check stranger has no permissions
      assert.ok(!await ws.checkPermission(created.id, 'usr_stranger', ws.ROLES.VIEWER));
    });
  });

  // ── User management ───────────────────────────────────────────────────────────

  describe('getOrCreateUser', () => {
    it('creates a new user', async () => {
      const ws = await importWorkspaces();
      const { user, created } = await ws.getOrCreateUser('newuser@example.com', 'New User');

      assert.ok(created);
      assert.ok(user.id.startsWith('usr_'));
      assert.strictEqual(user.email, 'newuser@example.com');
      assert.strictEqual(user.name, 'New User');
    });

    it('returns existing user without creating', async () => {
      const ws = await importWorkspaces();
      const first = await ws.getOrCreateUser('existing@example.com', 'Existing');
      const second = await ws.getOrCreateUser('existing@example.com', 'Existing');

      assert.ok(!second.created);
      assert.strictEqual(first.user.id, second.user.id);
    });
  });

  describe('updateUser', () => {
    it('updates user name', async () => {
      const ws = await importWorkspaces();
      const { user } = await ws.getOrCreateUser('update@example.com', 'Old Name');

      const updated = await ws.updateUser(user.id, { name: 'New Name' });
      assert.strictEqual(updated.name, 'New Name');
    });

    it('updates user email', async () => {
      const ws = await importWorkspaces();
      const { user } = await ws.getOrCreateUser('old@example.com', 'User');

      const updated = await ws.updateUser(user.id, { email: 'new@example.com' });
      assert.strictEqual(updated.email, 'new@example.com');
    });

    it('throws 404 for non-existent user', async () => {
      const ws = await importWorkspaces();
      await assert.rejects(
        ws.updateUser('usr_nonexistent', { name: 'Test' }),
        (err) => err.status === 404,
      );
    });
  });
});
