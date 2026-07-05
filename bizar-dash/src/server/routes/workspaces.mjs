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
import { withSpan, setCommonAttributes } from '../otel.mjs';
import { recordTrace } from '../metrics.mjs';
import { wrap } from './_shared.mjs';

/**
 * Common scope helper: extract userId/workspaceId from the request
 * and bind them to the active span. Returns `null` (and lets the
 * caller emit a 401) when no user is attached to the request.
 * Callers decide whether to short-circuit by checking the return
 * value.
 *
 * @param {import('@opentelemetry/api').Span} span
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function bindUserScope(span, req) {
  const userId = getCurrentUserId(req);
  const workspaceId = getCurrentWorkspaceId(req) || null;
  const ip = req.ip || req.socket?.remoteAddress;
  const userAgent = req.headers?.['user-agent'];
  setCommonAttributes(span, { userId, workspaceId, ip, userAgent });
  return userId || null;
}

/**
 * @returns {import('express').Router}
 */
export function createWorkspacesRouter() {
  const router = Router();

  // GET /api/workspaces — list user's workspaces
  router.get('/workspaces', wrap(withSpan('workspace.list', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.list', { outcome: 'unauthorized' });
      return;
    }
    const workspaces = await listWorkspacesWithRoles(userId);
    span.setAttribute('workspace.count', workspaces.length);
    res.json({ workspaces });
    recordTrace('workspace.list', { outcome: 'ok', count_bucket: workspaces.length === 0 ? '0' : workspaces.length < 5 ? '1-4' : '5+' });
  })));

  // POST /api/workspaces — create workspace
  router.post('/workspaces', wrap(withSpan('workspace.create', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.create', { outcome: 'unauthorized' });
      return;
    }
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'Workspace name is required' });
      recordTrace('workspace.create', { outcome: 'missing_name' });
      return;
    }
    const workspace = await createWorkspace({ name: name.trim(), ownerId: userId });
    span.setAttribute('workspace.id', workspace.id);
    res.status(201).json({ workspace });
    recordTrace('workspace.create', { outcome: 'created' });
  })));

  // GET /api/workspaces/:id — get workspace details
  router.get('/workspaces/:id', wrap(withSpan('workspace.get', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id } = req.params;
    span.setAttribute('workspace.id', id);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.get', { outcome: 'unauthorized' });
      return;
    }
    const workspace = await getWorkspace(id);
    if (!workspace) {
      res.status(404).json({ error: 'not_found', message: 'Workspace not found' });
      recordTrace('workspace.get', { outcome: 'not_found' });
      return;
    }
    const hasAccess = await checkPermission(id, userId, ROLES.VIEWER);
    if (!hasAccess) {
      res.status(403).json({ error: 'forbidden', message: 'Not a member of this workspace' });
      recordTrace('workspace.get', { outcome: 'forbidden' });
      return;
    }
    const members = await listMembers(id);
    span.setAttribute('workspace.member_count', members.length);
    res.json({ workspace, members });
    recordTrace('workspace.get', { outcome: 'ok' });
  })));

  // DELETE /api/workspaces/:id — delete workspace (admin only)
  router.delete('/workspaces/:id', wrap(withSpan('workspace.delete', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id } = req.params;
    span.setAttribute('workspace.id', id);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.delete', { outcome: 'unauthorized' });
      return;
    }
    const canDelete = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canDelete) {
      res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
      recordTrace('workspace.delete', { outcome: 'forbidden' });
      return;
    }
    await deleteWorkspace(id);
    res.json({ ok: true });
    recordTrace('workspace.delete', { outcome: 'ok' });
  })));

  // POST /api/workspaces/:id/invites — create invite
  router.post('/workspaces/:id/invites', wrap(withSpan('workspace.invite.create', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id } = req.params;
    span.setAttribute('workspace.id', id);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.invite.create', { outcome: 'unauthorized' });
      return;
    }
    const { email, role } = req.body || {};
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'Email is required' });
      recordTrace('workspace.invite.create', { outcome: 'missing_email' });
      return;
    }
    if (!role || !Object.values(ROLES).includes(role)) {
      res.status(400).json({ error: 'bad_request', message: 'Valid role is required' });
      recordTrace('workspace.invite.create', { outcome: 'invalid_role' });
      return;
    }
    const canInvite = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canInvite) {
      res.status(403).json({ error: 'forbidden', message: 'Admin role required to invite' });
      recordTrace('workspace.invite.create', { outcome: 'forbidden' });
      return;
    }
    span.setAttribute('workspace.invite.role', role);
    const result = await createInvite(id, email, role, userId);
    res.status(201).json(result);
    recordTrace('workspace.invite.create', { outcome: 'created', role });
  })));

  // GET /api/workspaces/:id/invites — list pending invites
  router.get('/workspaces/:id/invites', wrap(withSpan('workspace.invite.list', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id } = req.params;
    span.setAttribute('workspace.id', id);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.invite.list', { outcome: 'unauthorized' });
      return;
    }
    const canView = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canView) {
      res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
      recordTrace('workspace.invite.list', { outcome: 'forbidden' });
      return;
    }
    const invites = await listInvites(id);
    span.setAttribute('workspace.invite.count', invites.length);
    res.json({ invites });
    recordTrace('workspace.invite.list', { outcome: 'ok', count_bucket: invites.length === 0 ? '0' : '1+' });
  })));

  // DELETE /api/workspaces/:id/invites/:token — revoke invite
  router.delete('/workspaces/:id/invites/:token', wrap(withSpan('workspace.invite.revoke', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id, token } = req.params;
    span.setAttribute('workspace.id', id);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.invite.revoke', { outcome: 'unauthorized' });
      return;
    }
    const canRevoke = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canRevoke) {
      res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
      recordTrace('workspace.invite.revoke', { outcome: 'forbidden' });
      return;
    }
    await revokeInvite(id, token);
    res.json({ ok: true });
    recordTrace('workspace.invite.revoke', { outcome: 'ok' });
  })));

  // POST /api/workspaces/:id/members/:userId — update member role
  router.post('/workspaces/:id/members/:userId', wrap(withSpan('workspace.member.update', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id, userId: targetUserId } = req.params;
    span.setAttribute('workspace.id', id);
    span.setAttribute('workspace.target_user_id', targetUserId);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.member.update', { outcome: 'unauthorized' });
      return;
    }
    const { role } = req.body || {};
    if (!role || !Object.values(ROLES).includes(role)) {
      res.status(400).json({ error: 'bad_request', message: 'Valid role is required' });
      recordTrace('workspace.member.update', { outcome: 'invalid_role' });
      return;
    }
    const canUpdate = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canUpdate) {
      res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
      recordTrace('workspace.member.update', { outcome: 'forbidden' });
      return;
    }
    span.setAttribute('workspace.member.new_role', role);
    await updateMemberRole(id, targetUserId, role);
    res.json({ ok: true, role });
    recordTrace('workspace.member.update', { outcome: 'ok', role });
  })));

  // DELETE /api/workspaces/:id/members/:userId — remove member
  router.delete('/workspaces/:id/members/:userId', wrap(withSpan('workspace.member.remove', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { id, userId: targetUserId } = req.params;
    span.setAttribute('workspace.id', id);
    span.setAttribute('workspace.target_user_id', targetUserId);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.member.remove', { outcome: 'unauthorized' });
      return;
    }
    const canRemove = await checkPermission(id, userId, ROLES.ADMIN);
    if (!canRemove) {
      res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
      recordTrace('workspace.member.remove', { outcome: 'forbidden' });
      return;
    }
    await removeMember(id, targetUserId);
    res.json({ ok: true });
    recordTrace('workspace.member.remove', { outcome: 'ok' });
  })));

  // POST /api/invites/:token/accept — accept invite
  router.post('/invites/:token/accept', wrap(withSpan('workspace.invite.accept', async (span, req, res) => {
    const userId = bindUserScope(span, req);
    const { token } = req.params;
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
      recordTrace('workspace.invite.accept', { outcome: 'unauthorized' });
      return;
    }
    const { email, name } = req.body || {};
    if (!email || !name) {
      res.status(400).json({ error: 'bad_request', message: 'Email and name are required' });
      recordTrace('workspace.invite.accept', { outcome: 'missing_fields' });
      return;
    }
    const result = await acceptInvite(token, userId, email, name);
    if (result?.workspace?.id) span.setAttribute('workspace.id', result.workspace.id);
    if (result?.role) span.setAttribute('workspace.member.role', result.role);
    res.json({ ok: true, workspace: result.workspace, role: result.role });
    recordTrace('workspace.invite.accept', { outcome: 'ok' });
  })));

  return router;
}
