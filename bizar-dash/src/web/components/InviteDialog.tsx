// src/web/components/InviteDialog.tsx — v5.0.0 — modal to create and manage workspace invites.
import { useState, useEffect } from 'react';
import { Copy, Check, Trash2, Mail, Link2 } from 'lucide-react';
import { useModal } from './Modal';
import { Button } from './Button';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export type InviteInfo = {
  token: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  invitedBy: string;
  expiresAt: string;
};

type Props = {
  workspaceId: string;
  onInviteCreated?: () => void;
};

export function InviteDialog({ workspaceId, onInviteCreated }: Props) {
  const modal = useModal();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInvites();
  }, [workspaceId]);

  async function loadInvites() {
    setLoading(true);
    try {
      const r = await api.get<{ invites: InviteInfo[] }>(`/workspaces/${workspaceId}/invites`);
      setInvites(r.invites || []);
    } catch {
      // Ignore load errors
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.post<{ token: string; url: string }>(`/workspaces/${workspaceId}/invites`, {
        email: email.trim(),
        role,
      });
      setEmail('');
      await loadInvites();
      onInviteCreated?.();

      // Show the invite URL in a copy dialog
      modal.open({
        title: 'Invite Link Created',
        children: (
          <div className="invite-link-dialog">
            <p>Share this link with <strong>{email}</strong> to invite them as <strong>{role}</strong>:</p>
            <div className="invite-url-box">
              <Link2 size={14} />
              <input
                type="text"
                readOnly
                value={result.url}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                className="invite-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(result.url).catch(() => undefined);
                  setCopied(result.token);
                  setTimeout(() => setCopied(null), 2000);
                }}
              >
                {copied === result.token ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <p className="invite-url-note">This link expires in 7 days.</p>
          </div>
        ),
        footer: (
          <Button variant="primary" size="sm" onClick={() => modal.close()}>
            Done
          </Button>
        ),
      });
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(token: string) {
    if (!confirm('Revoke this invite?')) return;
    try {
      await api.del(`/workspaces/${workspaceId}/invites/${token}`);
      await loadInvites();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to revoke invite');
    }
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const roleColors: Record<string, string> = {
    admin: 'role-admin',
    editor: 'role-editor',
    viewer: 'role-viewer',
  };

  return (
    <div className="invite-dialog">
      <form className="invite-form" onSubmit={handleCreate}>
        <div className="invite-form-row">
          <div className="invite-form-field">
            <label htmlFor="invite-email">Email address</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
            />
          </div>
          <div className="invite-form-field invite-form-field-role">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'editor' | 'viewer')}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={creating}
            disabled={!email.trim()}
          >
            <Mail size={13} />
            Invite
          </Button>
        </div>
        {error && <p className="invite-error">{error}</p>}
      </form>

      <div className="invite-list">
        <h4 className="invite-list-title">Pending Invites</h4>
        {loading && <p className="invite-loading">Loading...</p>}
        {!loading && invites.length === 0 && (
          <p className="invite-empty">No pending invites</p>
        )}
        {invites.map((inv) => (
          <div key={inv.token} className="invite-item">
            <div className="invite-item-info">
              <span className="invite-item-email">{inv.email}</span>
              <span className={cn('invite-item-role', roleColors[inv.role])}>{inv.role}</span>
            </div>
            <div className="invite-item-actions">
              <button
                type="button"
                className="invite-action-btn"
                title="Copy invite link"
                onClick={() => {
                  const url = `${window.location.origin}/accept-invite?token=${inv.token}`;
                  copyToClipboard(url, inv.token);
                }}
              >
                {copied === inv.token ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button
                type="button"
                className="invite-action-btn invite-action-revoke"
                title="Revoke invite"
                onClick={() => handleRevoke(inv.token)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
