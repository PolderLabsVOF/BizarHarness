// src/web/views/settings/WorkspacesSection.tsx — v5.0.0 — workspace management in settings.
import { useState, useEffect } from 'react';
import { Users, Plus, Trash2, Crown, Shield, Eye, Copy, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/Button';
import { useModal } from '../../components/Modal';
import { InviteDialog } from '../../components/InviteDialog';
import { cn } from '../../lib/utils';

export type WorkspaceInfo = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
};

export type WorkspaceWithRole = {
  workspace: WorkspaceInfo;
  role: string;
};

export type WorkspaceMember = {
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
};

const ROLE_ICONS = { admin: Crown, editor: Shield, viewer: Eye };
const ROLE_COLORS = { admin: 'role-admin', editor: 'role-editor', viewer: 'role-viewer' };

export function WorkspacesSection() {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const modal = useModal();

  useEffect(() => {
    loadWorkspaces();
  }, []);

  async function loadWorkspaces() {
    setLoading(true);
    try {
      const r = await api.get<{ workspaces: WorkspaceWithRole[] }>('/workspaces');
      setWorkspaces(r.workspaces || []);
    } catch {
      setError('Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/workspaces', { name: newName.trim() });
      setNewName('');
      await loadWorkspaces();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(workspaceId: string, name: string) {
    if (!confirm(`Delete workspace "${name}"?`)) return;
    if (!confirm('This cannot be undone.')) return;
    try {
      await api.del(`/workspaces/${workspaceId}`);
      await loadWorkspaces();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to delete workspace');
    }
  }

  function copyInviteLink(workspaceId: string) {
    navigator.clipboard.writeText(`${window.location.origin}/accept-invite?workspace=${workspaceId}`).catch(() => undefined);
    setCopied(workspaceId);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) {
    return <div className="settings-section-loading">Loading workspaces...</div>;
  }

  return (
    <div className="settings-section settings-section-workspaces">
      <h3 className="settings-section-title">Workspaces</h3>
      <p className="settings-section-desc">
        Workspaces let you share access with team members. Each workspace has its own members, settings, and data.
      </p>

      {error && (
        <div className="settings-section-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Create new workspace */}
      <form className="workspace-create-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New workspace name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={64}
        />
        <Button type="submit" variant="primary" size="sm" loading={creating} disabled={!newName.trim()}>
          <Plus size={13} />
          Create
        </Button>
      </form>

      {/* Workspace list */}
      <div className="workspace-list">
        {workspaces.length === 0 && (
          <p className="workspace-list-empty">No workspaces yet. Create one above.</p>
        )}
        {workspaces.map(({ workspace, role }) => {
          const RoleIcon = ROLE_ICONS[role as keyof typeof ROLE_ICONS] || Eye;
          return (
            <div key={workspace.id} className="workspace-item">
              <div className="workspace-item-info">
                <div className="workspace-item-icon">
                  <Users size={16} />
                </div>
                <div className="workspace-item-details">
                  <span className="workspace-item-name">{workspace.name}</span>
                  <span className={cn('workspace-item-role', ROLE_COLORS[role as keyof typeof ROLE_COLORS])}>
                    <RoleIcon size={11} />
                    {role}
                  </span>
                </div>
              </div>
              <div className="workspace-item-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="Copy invite link"
                  onClick={() => copyInviteLink(workspace.id)}
                >
                  {copied === workspace.id ? <Check size={13} /> : <Copy size={13} />}
                </Button>
                {role === 'admin' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    title="Manage members"
                    onClick={() => {
                      modal.open({
                        title: `Manage "${workspace.name}"`,
                        children: <InviteDialog workspaceId={workspace.id} onInviteCreated={() => loadWorkspaces()} />,
                        width: 520,
                      });
                    }}
                  >
                    <Users size={13} />
                  </Button>
                )}
                {role === 'admin' && workspaces.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    title="Delete workspace"
                    onClick={() => handleDelete(workspace.id, workspace.name)}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
