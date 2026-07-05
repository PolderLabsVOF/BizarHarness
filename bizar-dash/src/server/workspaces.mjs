/**
 * src/server/workspaces.mjs
 *
 * v5.0.0 — Multi-user workspace data layer.
 *
 * File-based store at ~/.local/share/bizar/workspaces/ (mode 0700):
 *
 * workspaces/
 * ├── index.json                          # { workspaces: [{id, name, ownerId, createdAt}], users: [{id, email, name}] }
 * ├── {workspaceId}/
 * │   ├── members.json                    # [{userId, role: 'admin'|'editor'|'viewer', joinedAt}]
 * │   ├── invites.json                    # [{token, email, role, invitedBy, expiresAt}]
 * │   ├── tasks.jsonl                     # existing tasks, scoped to workspace
 * │   └── settings.json                   # workspace-scoped settings
 *
 * Backwards compatible: existing single-user setups keep working without migration.
 * A "default" workspace is auto-created on first run.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  statSync,
  chmodSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── Constants ─────────────────────────────────────────────────────────────────

export const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
};

/** Role hierarchy: admin > editor > viewer */
const ROLE_RANK = {
  [ROLES.ADMIN]: 3,
  [ROLES.EDITOR]: 2,
  [ROLES.VIEWER]: 1,
};

// Use functions instead of constants so tests can override process.env.HOME
// before calling any workspace functions.
function getHome() {
  return homedir();
}
function getBizarLocal() {
  return join(getHome(), '.local', 'share', 'bizar');
}
function getWorkspacesRoot() {
  return join(getBizarLocal(), 'workspaces');
}
function getIndexFile() {
  return join(getWorkspacesRoot(), 'index.json');
}

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── ID generation ─────────────────────────────────────────────────────────────

function genId(prefix) {
  return `${prefix}_${randomBytes(6).toString('hex').slice(0, 10)}`;
}

function genWorkspaceId() {
  return `ws_${randomBytes(6).toString('hex').slice(0, 10)}`;
}

function genUserId() {
  return `usr_${randomBytes(6).toString('hex').slice(0, 10)}`;
}

function genInviteToken() {
  return randomBytes(24).toString('hex');
}

// ── Safe JSON helpers ──────────────────────────────────────────────────────────

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

// ── Ensure directory structure ─────────────────────────────────────────────────

function ensureWorkspacesRoot() {
  mkdirSync(getWorkspacesRoot(), { recursive: true, mode: 0o700 });
  chmodSync(getWorkspacesRoot(), 0o700);
}

function ensureWorkspaceDir(workspaceId) {
  const dir = join(getWorkspacesRoot(), workspaceId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

// ── Index file helpers ─────────────────────────────────────────────────────────

function loadIndex() {
  ensureWorkspacesRoot();
  const raw = safeReadJSON(getIndexFile(), { workspaces: [], users: [] });
  return raw;
}

function saveIndex(index) {
  ensureWorkspacesRoot();
  atomicWriteJson(getIndexFile(), index);
  chmodSync(getIndexFile(), 0o600);
}

// ── Workspace members / invites helpers ───────────────────────────────────────

function loadMembers(workspaceId) {
  const file = join(getWorkspacesRoot(), workspaceId, 'members.json');
  return safeReadJSON(file, []);
}

function saveMembers(workspaceId, members) {
  const dir = ensureWorkspaceDir(workspaceId);
  const file = join(dir, 'members.json');
  atomicWriteJson(file, members);
  chmodSync(file, 0o600);
}

function loadInvites(workspaceId) {
  const file = join(getWorkspacesRoot(), workspaceId, 'invites.json');
  return safeReadJSON(file, []);
}

function saveInvites(workspaceId, invites) {
  const dir = ensureWorkspaceDir(workspaceId);
  const file = join(dir, 'invites.json');
  atomicWriteJson(file, invites);
  chmodSync(file, 0o600);
}

// ── User helpers ───────────────────────────────────────────────────────────────

function loadUser(userId) {
  const index = loadIndex();
  return index.users.find((u) => u.id === userId) || null;
}

function findUserByEmail(email) {
  const index = loadIndex();
  return index.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates the "default" workspace and adds the current user as admin.
 * Called on server startup if no workspaces exist.
 *
 * @param {object} opts
 * @param {string} opts.userId  — existing user id
 * @param {string} opts.email   — user email
 * @param {string} opts.name    — user display name
 * @returns {Promise<{workspace: object, user: object}>}
 */
export async function ensureDefaultWorkspace({ userId, email, name }) {
  const index = loadIndex();

  // Already initialized
  if (index.workspaces.length > 0) {
    const workspace = index.workspaces[0];
    const user = loadUser(userId) || index.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return { workspace, user };
  }

  // Create default workspace
  const workspaceId = 'ws_default';
  const now = new Date().toISOString();
  const workspace = { id: workspaceId, name: 'Default Workspace', ownerId: userId, createdAt: now };

  // Ensure user exists in index
  let user = loadUser(userId);
  if (!user) {
    user = { id: userId, email, name };
    index.users.push(user);
  }

  index.workspaces.push(workspace);
  saveIndex(index);

  // Add user as admin of the workspace
  ensureWorkspaceDir(workspaceId);
  saveMembers(workspaceId, [{ userId, role: ROLES.ADMIN, joinedAt: now }]);

  return { workspace, user };
}

/**
 * Create a new workspace.
 *
 * @param {object} opts
 * @param {string} opts.name     — workspace name
 * @param {string} opts.ownerId  — user id of the owner
 * @returns {Promise<object>} created workspace
 */
export async function createWorkspace({ name, ownerId }) {
  const index = loadIndex();
  const workspaceId = genWorkspaceId();
  const now = new Date().toISOString();

  // Ensure owner exists in users index (needed for listWorkspaces to find them)
  if (!index.users.some((u) => u.id === ownerId)) {
    // Owner not in index - create a minimal user entry
    // Note: We don't know email/name here, so we use placeholder
    index.users.push({ id: ownerId, email: `${ownerId}@local`, name: ownerId });
    saveIndex(index);
  }

  const workspace = { id: workspaceId, name, ownerId, createdAt: now };
  index.workspaces.push(workspace);
  saveIndex(index);

  ensureWorkspaceDir(workspaceId);
  saveMembers(workspaceId, [{ userId: ownerId, role: ROLES.ADMIN, joinedAt: now }]);

  return workspace;
}

/**
 * Get a workspace by id.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getWorkspace(id) {
  const index = loadIndex();
  return index.workspaces.find((w) => w.id === id) || null;
}

/**
 * List all workspaces a user belongs to.
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function listWorkspaces(userId) {
  const index = loadIndex();
  const result = [];
  for (const workspace of index.workspaces) {
    const members = loadMembers(workspace.id);
    if (members.some((m) => m.userId === userId)) {
      result.push(workspace);
    }
  }
  return result;
}

/**
 * List workspaces where user is a member, with their roles.
 *
 * @param {string} userId
 * @returns {Promise<Array<{workspace: object, role: string}>>}
 */
export async function listWorkspacesWithRoles(userId) {
  const index = loadIndex();
  const user = loadUser(userId);
  if (!user) return [];

  const result = [];
  for (const workspace of index.workspaces) {
    const members = loadMembers(workspace.id);
    const member = members.find((m) => m.userId === userId);
    if (member) {
      result.push({ workspace, role: member.role });
    }
  }
  return result;
}

/**
 * Add a member to a workspace.
 *
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} role  — admin | editor | viewer
 * @returns {Promise<void>}
 */
export async function addMember(workspaceId, userId, role) {
  if (!Object.values(ROLES).includes(role)) {
    throw Object.assign(new Error(`Invalid role: ${role}`), { status: 400, code: 'bad_request' });
  }

  const index = loadIndex();
  const workspace = index.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    throw Object.assign(new Error('Workspace not found'), { status: 404, code: 'not_found' });
  }

  const members = loadMembers(workspaceId);
  const existing = members.find((m) => m.userId === userId);
  if (existing) {
    throw Object.assign(new Error('User is already a member'), { status: 409, code: 'conflict' });
  }

  members.push({ userId, role, joinedAt: new Date().toISOString() });
  saveMembers(workspaceId, members);
}

/**
 * Remove a member from a workspace.
 *
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function removeMember(workspaceId, userId) {
  const index = loadIndex();
  const workspace = index.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    throw Object.assign(new Error('Workspace not found'), { status: 404, code: 'not_found' });
  }

  const members = loadMembers(workspaceId);
  const filtered = members.filter((m) => m.userId !== userId);
  if (filtered.length === members.length) {
    throw Object.assign(new Error('User is not a member'), { status: 404, code: 'not_found' });
  }

  saveMembers(workspaceId, filtered);
}

/**
 * Update a member's role.
 *
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} newRole
 * @returns {Promise<void>}
 */
export async function updateMemberRole(workspaceId, userId, newRole) {
  if (!Object.values(ROLES).includes(newRole)) {
    throw Object.assign(new Error(`Invalid role: ${newRole}`), { status: 400, code: 'bad_request' });
  }

  const members = loadMembers(workspaceId);
  const member = members.find((m) => m.userId === userId);
  if (!member) {
    throw Object.assign(new Error('Member not found'), { status: 404, code: 'not_found' });
  }

  member.role = newRole;
  saveMembers(workspaceId, members);
}

/**
 * Create an invite for a workspace.
 *
 * @param {string} workspaceId
 * @param {string} email       — invitee email
 * @param {string} role        — admin | editor | viewer
 * @param {string} invitedBy   — user id of inviter
 * @returns {Promise<{token: string, url: string}>}
 */
export async function createInvite(workspaceId, email, role, invitedBy) {
  if (!Object.values(ROLES).includes(role)) {
    throw Object.assign(new Error(`Invalid role: ${role}`), { status: 400, code: 'bad_request' });
  }

  const index = loadIndex();
  const workspace = index.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    throw Object.assign(new Error('Workspace not found'), { status: 404, code: 'not_found' });
  }

  const token = genInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();

  const invites = loadInvites(workspaceId);
  invites.push({ token, email: email.toLowerCase(), role, invitedBy, expiresAt });
  saveInvites(workspaceId, invites);

  // Build invite URL — the dashboard port is read from the port file
  const configDir = join(homedir(), '.config', 'bizar');
  let port = '4097';
  try {
    const portFile = join(configDir, 'dashboard.port');
    port = readFileSync(portFile, 'utf8').trim() || '4097';
  } catch {
    /* use default */
  }

  const url = `http://localhost:${port}/accept-invite?token=${token}`;
  return { token, url };
}

/**
 * List pending invites for a workspace.
 *
 * @param {string} workspaceId
 * @returns {Promise<Array>}
 */
export async function listInvites(workspaceId) {
  const invites = loadInvites(workspaceId);
  const now = Date.now();
  return invites
    .filter((inv) => new Date(inv.expiresAt).getTime() > now)
    .map((inv) => ({ email: inv.email, role: inv.role, invitedBy: inv.invitedBy, expiresAt: inv.expiresAt }));
}

/**
 * Revoke an invite.
 *
 * @param {string} workspaceId
 * @param {string} inviteToken
 * @returns {Promise<void>}
 */
export async function revokeInvite(workspaceId, inviteToken) {
  const invites = loadInvites(workspaceId);
  const filtered = invites.filter((inv) => inv.token !== inviteToken);
  if (filtered.length === invites.length) {
    throw Object.assign(new Error('Invite not found'), { status: 404, code: 'not_found' });
  }
  saveInvites(workspaceId, filtered);
}

/**
 * Accept an invite token. Creates the user if they don't exist.
 *
 * @param {string} token
 * @param {string} userId   — existing or new user id
 * @param {string} email    — user email
 * @param {string} name     — user display name
 * @returns {Promise<{workspace: object, role: string}>}
 */
export async function acceptInvite(token, userId, email, name) {
  const index = loadIndex();

  // Find the invite across all workspaces
  for (const workspace of index.workspaces) {
    const invites = loadInvites(workspace.id);
    const invite = invites.find((inv) => inv.token === token);
    if (!invite) continue;

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('Invite has expired'), { status: 410, code: 'gone' });
    }

    // Ensure user exists in index
    let user = index.users.find((u) => u.id === userId);
    if (!user) {
      user = { id: userId, email: email.toLowerCase(), name };
      index.users.push(user);
      saveIndex(index);
    }

    // Add as member
    const members = loadMembers(workspace.id);
    if (!members.some((m) => m.userId === userId)) {
      members.push({ userId, role: invite.role, joinedAt: new Date().toISOString() });
      saveMembers(workspace.id, members);
    }

    // Remove the invite
    const updatedInvites = invites.filter((inv) => inv.token !== token);
    saveInvites(workspace.id, updatedInvites);

    return { workspace, role: invite.role };
  }

  throw Object.assign(new Error('Invite not found'), { status: 404, code: 'not_found' });
}

/**
 * Check if a user has at least the required role in a workspace.
 *
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} requiredRole  — admin | editor | viewer
 * @returns {Promise<boolean>}
 */
export async function checkPermission(workspaceId, userId, requiredRole) {
  const members = loadMembers(workspaceId);
  const member = members.find((m) => m.userId === userId);
  if (!member) return false;
  const userRank = ROLE_RANK[member.role] || 0;
  const requiredRank = ROLE_RANK[requiredRole] || 0;
  return userRank >= requiredRank;
}

/**
 * Get the current user's role in a workspace.
 *
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function getMemberRole(workspaceId, userId) {
  const members = loadMembers(workspaceId);
  const member = members.find((m) => m.userId === userId);
  return member ? member.role : null;
}

/**
 * List all members of a workspace.
 *
 * @param {string} workspaceId
 * @returns {Promise<Array>}
 */
export async function listMembers(workspaceId) {
  const index = loadIndex();
  const members = loadMembers(workspaceId);

  return members.map((m) => {
    const user = index.users.find((u) => u.id === m.userId);
    return {
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      email: user?.email || null,
      name: user?.name || null,
    };
  });
}

/**
 * Delete a workspace.
 *
 * @param {string} workspaceId
 * @returns {Promise<void>}
 */
export async function deleteWorkspace(workspaceId) {
  const index = loadIndex();
  const workspaceIdx = index.workspaces.findIndex((w) => w.id === workspaceId);
  if (workspaceIdx === -1) {
    throw Object.assign(new Error('Workspace not found'), { status: 404, code: 'not_found' });
  }

  index.workspaces.splice(workspaceIdx, 1);
  saveIndex(index);

  // Remove workspace directory
  const dir = join(getWorkspacesRoot(), workspaceId);
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      unlinkSync(join(dir, file));
    }
    unlinkSync(dir);
  } catch {
    /* ignore cleanup errors */
  }
}

/**
 * Get or create a user by email. For invite acceptance flow.
 *
 * @param {string} email
 * @param {string} name
 * @returns {Promise<{user: object, created: boolean}>}
 */
export async function getOrCreateUser(email, name) {
  const index = loadIndex();
  const existing = index.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return { user: existing, created: false };

  const user = { id: genUserId(), email: email.toLowerCase(), name };
  index.users.push(user);
  saveIndex(index);
  return { user, created: true };
}

/**
 * Update a user's profile.
 *
 * @param {string} userId
 * @param {object} updates  — { name?, email? }
 * @returns {Promise<object>}
 */
export async function updateUser(userId, updates) {
  const index = loadIndex();
  const user = index.users.find((u) => u.id === userId);
  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 404, code: 'not_found' });
  }

  if (updates.name !== undefined) user.name = updates.name;
  if (updates.email !== undefined) user.email = updates.email.toLowerCase();
  saveIndex(index);
  return user;
}

/**
 * Get a user by id.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getUser(userId) {
  return loadUser(userId);
}

/**
 * Get the default workspace id for a user (first workspace they're a member of).
 *
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function getDefaultWorkspaceId(userId) {
  const workspaces = await listWorkspaces(userId);
  return workspaces[0]?.id || null;
}
