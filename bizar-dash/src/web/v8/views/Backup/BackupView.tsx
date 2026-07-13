import { useCallback, useEffect, useState } from 'react';
import { Archive, Plus, Trash2, RotateCw, ShieldCheck, FileText } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { WsMessage } from '../../data/types.js';

/**
 * BackupView — Sprint S35. Snapshot creation, restore, verify, delete.
 */

interface BackupEntry {
  path: string;
  label?: string;
  size?: number;
  createdAt?: string;
  includesProject?: boolean;
}

function fmtSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function BackupView(): JSX.Element {
  const list = useFetch<{ ok: boolean; backups: BackupEntry[] }>('/api/backup/list');
  const [items, setItems] = useState<BackupEntry[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [includeProject, setIncludeProject] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (list.data?.backups) setItems(list.data.backups);
  }, [list.data]);

  const onChange = useCallback((msg: WsMessage) => {
    if (msg.type === 'backups:change') void list.refetch();
  }, [list]);
  useWsMessage('backups:change', onChange);

  const create = async (): Promise<void> => {
    setBusy('create');
    setError(null);
    try {
      await fetchJson('/api/backup/create', { method: 'POST', body: { label: label.trim() || null, includeProject } });
      setLabel('');
      setIncludeProject(false);
      setCreateOpen(false);
      void list.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verify = async (path: string): Promise<void> => {
    setBusy(path);
    setError(null);
    try {
      await fetchJson('/api/backup/verify', { method: 'POST', body: { backupPath: path } });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (path: string): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`Restore from ${path}? This overwrites current settings + tasks.`)) return;
    setBusy(path);
    setError(null);
    try {
      await fetchJson('/api/backup/restore', { method: 'POST', body: { backupPath: path, dryRun: false } });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (path: string): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete backup ${path}?`)) return;
    setBusy(path);
    setError(null);
    try {
      await fetchJson(`/api/backup/${encodeURIComponent(path)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((b) => b.path !== path));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Backups"
        description={`${items.length} backup${items.length === 1 ? '' : 's'} in ~/.config/bizar/backups/. Create, restore, verify, or delete.`}
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <Button variant="primary" onClick={() => setCreateOpen(true)} data-testid="backup-create-open">
              <Plus size={14} aria-hidden /> New backup
            </Button>
          </Inline>
        }
      />
      {list.loading && items.length === 0 ? (
        <Stack gap={2}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 80 }} />
        </Stack>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Archive size={32} aria-hidden />}
          title="No backups yet"
          description="Create your first snapshot before risky changes."
        />
      ) : (
        <Stack gap={2}>
          {items.map((b) => (
            <Card key={b.path} variant="default">
              <CardBody>
                <Inline align="center" justify="between" gap={3}>
                  <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Inline align="center" gap={2}>
                      <Archive size={14} aria-hidden />
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{b.label || b.path.split('/').pop()}</strong>
                      {b.includesProject && <Badge tone="info">project</Badge>}
                    </Inline>
                    <Inline align="center" gap={3} style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
                      <span>{fmtSize(b.size)}</span>
                      <span>{b.createdAt ? new Date(b.createdAt).toLocaleString() : ''}</span>
                    </Inline>
                  </Stack>
                  <Inline gap={1}>
                    <Button variant="ghost" onClick={() => void verify(b.path)} disabled={busy === b.path} data-testid={`backup-verify-${b.path}`}>
                      <ShieldCheck size={12} aria-hidden /> Verify
                    </Button>
                    <Button variant="ghost" onClick={() => void restore(b.path)} disabled={busy === b.path} data-testid={`backup-restore-${b.path}`}>
                      <RotateCw size={12} aria-hidden /> Restore
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(b.path)} disabled={busy === b.path} data-testid={`backup-delete-${b.path}`}>
                      <Trash2 size={12} aria-hidden /> Delete
                    </Button>
                  </Inline>
                </Inline>
              </CardBody>
            </Card>
          ))}
        </Stack>
      )}

      <Sheet open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
        <SheetContent side="right" title="New backup">
          <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
            <Stack gap={2}>
              <label htmlFor="backup-label" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Label (optional)</label>
              <Input
                id="backup-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. pre-v9.2.0"
                disabled={busy === 'create'}
                data-testid="backup-create-label"
              />
            </Stack>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={includeProject} onChange={(e) => setIncludeProject(e.target.checked)} disabled={busy === 'create'} data-testid="backup-create-include-project" />
              <span style={{ fontSize: 'var(--fs-13)' }}>Include project files (larger snapshot)</span>
            </label>
            <Inline gap={2}>
              <Button variant="primary" onClick={() => void create()} disabled={busy === 'create'} data-testid="backup-create-submit">
                {busy === 'create' ? 'Creating…' : 'Create backup'}
              </Button>
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy === 'create'}>
                Cancel
              </Button>
            </Inline>
          </Stack>
        </SheetContent>
      </Sheet>
    </Stack>
  );
}