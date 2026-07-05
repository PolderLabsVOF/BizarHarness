/**
 * src/server/routes/workspaces.mjs
 *
 * v5.0.0 — Workspace management REST API.
 *
 * Endpoints:
 *   GET    /api/workspaces                    — list user's workspaces
 *   POST   /api/workspaces                    — create workspace
 *   GET    /api/workspaces/:id                — get workspace details
 *   DELETE /api/workspaces/:id                 — delete workspace (admin only)
 *   POST   /api/workspaces/:id/invites        — create invite
 *   GET    /api/workspaces/:id/invites        — list pending invites
 *   DELETE /api/workspaces/:id/invites/:token — revoke invite
 *   POST   /api/workspaces/:id/members/:userId — update member role
 *   DELETE /api/workspaces/:id/members/:userId — remove member
 *   POST   /api/invites/:token/accept         — accept invite
 */
import { Router } from 'express';
import {
  createWorkspace,
  getWorkspace,
  listWorkspacesWithRoles,
  deleteWorkspace,
  createInvite,
  listInvites,
  revokeInvite,
  addMember,
  removeMember,
  updateMemberRole,
  acceptInvite,
  checkPermission,
  listMembers,
  ROLES,
} from '../workspaces.mjs';
import { getCurrentUserId, getCurrentWorkspaceId } from '../auth.mjs';
import { wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createWorkspacesRouter() {
  const router = Router();

  // GET /api/workspaces — list user's workspaces
  router.get('/workspaces', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const workspaces = await listWorkspacesWithRoles(userId);
    res.json({ workspaces });
  }));

  // POST /api/workspaces — create workspace
  router.post('/workspaces', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'bad_request', message: 'Workspace name is required' });
    }
    const workspace = await createWorkspace({ name: name.trim(), ownerId: userId });
    res.status(201).json({ workspace });
  }));

  // GET /api/workspaces/:id — get workspace details
  router.get('/workspaces/:id', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id } = req.params;
    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'not_found', message: 'Workspace not found' });
    }
    const hasAccess = await checkPermission(id, userId, ROLES.VIEWER);
    if (!hasAccess) {
      return res.status(403).json({ error: 'forbidden', message: 'Not a member of this workspace' });
    }
    const members = await listMembers(id);
    res.json({ workspace, members });
  }));

  // DELETE /api/workspaces/:id — delete workspace (admin only)
  router.delete('/workspaces/:id', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id } = req.params;
    const canDelete = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canDelete) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
    }
    await deleteWorkspace(id);
    res.json({ ok: true });
  }));

  // POST /api/workspaces/:id/invites — create invite
  router.post('/workspaces/:id/invites', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id } = req.params;
    const { email, role } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'bad_request', message: 'Email is required' });
    }
    if (!role || !Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'bad_request', message: 'Valid role is required' });
    }
    const canInvite = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canInvite) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin role required to invite' });
    }
    const result = await createInvite(id, email, role, userId);
    res.status(201).json(result);
  }));

  // GET /api/workspaces/:id/invites — list pending invites
  router.get('/workspaces/:id/invites', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id } = req.params;
    const canView = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canView) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
    }
    const invites = await listInvites(id);
    res.json({ invites });
  }));

  // DELETE /api/workspaces/:id/invites/:token — revoke invite
  router.delete('/workspaces/:id/invites/:token', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id, token } = req.params;
    const canRevoke = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canRevoke) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
    }
    await revokeInvite(id, token);
    res.json({ ok: true });
  }));

  // POST /api/workspaces/:id/members/:userId — update member role
  router.post('/workspaces/:id/members/:userId', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id, userId: targetUserId } = req.params;
    const { role } = req.body || {};
    if (!role || !Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'bad_request', message: 'Valid role is required' });
    }
    const canUpdate = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canUpdate) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
    }
    await updateMemberRole(id, targetUserId, role);
    res.json({ ok: true, role });
  }));

  // DELETE /api/workspaces/:id/members/:userId — remove member
  router.delete('/workspaces/:id/members/:userId', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { id, userId: targetUserId } = req.params;
    const canRemove = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canRemove) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
    }
    await removeMember(id, targetUserId);
    res.json({ ok: true });
  }));

  // POST /api/invites/:token/accept — accept invite
  router.post('/invites/:token/accept', wrap(async (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const { token } = req.params;
    const { email, name } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ error: 'bad_request', message: 'Email and name are required' });
    }
    const result = await acceptInvite(token, userId, email, name);
    res.json({ ok: true, workspace: result.workspace, role: result.role });
  }));

  return router;
}
