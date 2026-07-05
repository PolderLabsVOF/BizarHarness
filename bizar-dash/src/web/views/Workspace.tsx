// src/web/views/Workspace.tsx — v5.0.0 — workspace management view.
import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, Trash2, Shield, Crown, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { useModal } from '../components/Modal';
import { Button } from '../components/Button';
import { InviteDialog, type InviteInfo } from '../components/InviteDialog';
import { cn } from '../lib/utils';

export type WorkspaceMember = {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  joinedAt: string;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
};

type Props = {
  workspaceId: string;
  onWorkspaceDeleted?: () => void;
  onWorkspaceUpdated?: (name: string) => void;
};

const ROLE_ICONS = {
  admin: Crown,
  editor: Shield,
  viewer: Eye,
};

const ROLE_COLORS = {
  admin: 'role-admin',
  editor: 'role-editor',
  viewer: 'role-viewer',
};

export function WorkspaceView({ workspaceId, onWorkspaceDeleted, onWorkspaceUpdated }: Props) {
  const modal = useModal();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameEditing, setNameEditing] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ workspace: WorkspaceInfo; members: WorkspaceMember[] }>(
        `/workspaces/${workspaceId}`,
      );
      setWorkspace(r.workspace);
      setMembers(r.members || []);
      setNameDraft(r.workspace.name);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const loadInvites = async () => {
    try {
      const r = await api.get<{ invites: InviteInfo[] }>(`/workspaces/${workspaceId}/invites`);
      setInvites(r.invites || []);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadInvites();
  }, [workspaceId]);

  const handleSaveName = async () => {
    if (!nameDraft.trim() || !workspace) return;
    try {
      // Workspace rename would be a separate endpoint; for now just update locally
      setWorkspace((w) => (w ? { ...w, name: nameDraft.trim() } : w));
      onWorkspaceUpdated?.(nameDraft.trim());
      setNameEditing(false);
    } catch {
      setError('Failed to update name');
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!confirm(`Delete workspace "${workspace?.name}"? This cannot be undone.`)) return;
    if (!confirm('Are you absolutely sure? All workspace data will be permanently deleted.')) return;
    try {
      await api.del(`/workspaces/${workspaceId}`);
      onWorkspaceDeleted?.();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to delete workspace');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Remove this member from the workspace?')) return;
    try {
      await api.del(`/workspaces/${workspaceId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to remove member');
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      await api.post(`/workspaces/${workspaceId}/members/${userId}`, { role: newRole });
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole as WorkspaceMember['role'] } : m)),
      );
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to update role');
    }
  };

  // Note: In a real implementation, we'd get the current user ID from the session/JWT.
  // For now, we trust the server to only render this view for authorized users.
  const currentUserIsAdmin = true;

  if (loading) {
    return (
      <div className="view view-workspace">
        <div className="workspace-loading">Loading workspace...</div>
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div className="view view-workspace">
        <div className="workspace-error">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={loadWorkspace}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="view view-workspace">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Users size={18} />
            {nameEditing ? (
              <input
                type="text"
                className="workspace-name-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setNameEditing(false);
                }}
                autoFocus
              />
            ) : (
              <span onClick={() => currentUserIsAdmin && setNameEditing(true)} className={cn('workspace-name', currentUserIsAdmin && 'workspace-name-editable')}>
                {workspace?.name}
              </span>
            )}
          </h2>
          <p className="view-subtitle">
            Created {workspace?.createdAt ? new Date(workspace.createdAt).toLocaleDateString() : '—'}
          </p>
        </div>
        <div className="view-actions">
          {currentUserIsAdmin && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  modal.open({
                    title: 'Invite Members',
                    children: <InviteDialog workspaceId={workspaceId} onInviteCreated={loadInvites} />,
                    width: 480,
                  });
                }}
              >
                <Plus size={14} />
                Invite
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteWorkspace}>
                <Trash2 size={14} />
                Delete
              </Button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="workspace-error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="workspace-sections">
        {/* Members section */}
        <section className="workspace-section">
          <h3 className="workspace-section-title">Members ({members.length})</h3>
          <div className="workspace-members-list">
            {members.map((member) => {
              const RoleIcon = ROLE_ICONS[member.role] || Eye;
              return (
                <div key={member.userId} className="workspace-member">
                  <div className="workspace-member-info">
                    <div className="workspace-member-avatar">
                      {member.name?.[0]?.toUpperCase() || member.email[0].toUpperCase()}
                    </div>
                    <div className="workspace-member-details">
                      <span className="workspace-member-name">{member.name || 'Unknown'}</span>
                      <span className="workspace-member-email">{member.email}</span>
                    </div>
                  </div>
                  <div className="workspace-member-actions">
                    <span className={cn('workspace-member-role', ROLE_COLORS[member.role])}>
                      <RoleIcon size={12} />
                      {member.role}
                    </span>
                    {currentUserIsAdmin && member.role !== 'admin' && (
                      <>
                        <select
                          className="workspace-role-select"
                          value={member.role}
                          onChange={(e) => handleUpdateRole(member.userId, e.target.value)}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          onClick={() => handleRemoveMember(member.userId)}
                          title="Remove member"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Pending invites section */}
        {currentUserIsAdmin && (
          <section className="workspace-section">
            <h3 className="workspace-section-title">Pending Invites ({invites.length})</h3>
            {invites.length === 0 ? (
              <p className="workspace-empty">No pending invites</p>
            ) : (
              <div className="workspace-invites-list">
                {invites.map((inv) => (
                  <div key={inv.token} className="workspace-invite">
                    <span className="workspace-invite-email">{inv.email}</span>
                    <span className={cn('workspace-invite-role', ROLE_COLORS[inv.role])}>{inv.role}</span>
                    <span className="workspace-invite-expiry">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
