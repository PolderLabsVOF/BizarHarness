/**
 * v8/views/Obsidian/ObsidianView.tsx — Sprint S43, v9.3.0.
 *
 * Vault explorer. Stats card (GET /api/obsidian), notes list
 * (GET /api/obsidian/notes), per-note view (GET /api/obsidian/notes/*),
 * per-note delete (DELETE /api/obsidian/notes/*), Index button
 * (POST /api/obsidian/index), and search (GET /api/obsidian/search?q).
 */

import { useCallback, useMemo, useState } from 'react';
import { BookOpen, FileText, RefreshCcw, Trash2, Search, RotateCcw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface VaultStats {
  exists: boolean;
  vaultDir?: string;
  noteCount?: number;
  totalSize?: number;
  folderCount?: number;
}

interface NoteMeta {
  path: string;
  relPath: string;
  mtime?: number | string;
  size?: number;
}

export function ObsidianView(): JSX.Element {
  const statsPayload = useFetch<VaultStats>('/api/obsidian');
  const notesPayload = useFetch<{ notes: NoteMeta[] }>('/api/obsidian/notes');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [indexing, setIndexing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const notes = useMemo<NoteMeta[]>(() => notesPayload.data?.notes ?? [], [notesPayload.data]);
  const refresh = useCallback(() => { void statsPayload.refetch(); void notesPayload.refetch(); }, [statsPayload, notesPayload]);

  const drop = async (path: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/obsidian/notes/${path}`, { method: 'DELETE' });
      setConfirmDelete(null);
      setActiveNote(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const reindex = async (): Promise<void> => {
    setIndexing(true);
    setError(null);
    try {
      await fetchJson('/api/obsidian/index', { method: 'POST' });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setIndexing(false);
    }
  };

  return (
    <Stack gap={4} data-testid="obsidian-view">
      <ViewHeader
        title="Obsidian"
        description="Vault explorer + index. Notes stored as markdown."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="obsidian-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="obsidian-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => void reindex()} disabled={indexing} data-testid="obsidian-reindex">
              <RotateCcw size={14} aria-hidden /> {indexing ? 'Indexing…' : 'Rebuild index'}
            </Button>
          </Inline>
        }
      />

      {statsPayload.data && (
        <Card variant="default">
          <CardBody>
            <Inline align="center" gap={3}>
              <BookOpen size={18} aria-hidden style={{ color: 'var(--accent)' }} />
              <Stack gap={0}>
                <strong>{statsPayload.data.exists ? `${statsPayload.data.noteCount ?? 0} notes` : 'No vault'}</strong>
                {statsPayload.data.exists && statsPayload.data.vaultDir && (
                  <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{statsPayload.data.vaultDir}</code>
                )}
              </Stack>
              {statsPayload.data.exists && (
                <Inline align="center" gap={3} style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                  <span>{(statsPayload.data.totalSize ?? 0).toLocaleString()} bytes</span>
                  {statsPayload.data.folderCount !== undefined && <span>· {statsPayload.data.folderCount} folders</span>}
                </Inline>
              )}
            </Inline>
          </CardBody>
        </Card>
      )}

      <Card variant="default">
        <CardBody>
          <Inline gap={2} align="center">
            <Search size={14} aria-hidden style={{ color: 'var(--fg-muted)' }} />
            <Input value={search} onChange={(e) => setSearch((e.target as HTMLInputElement).value)} placeholder="Filter notes by path…" data-testid="obsidian-search" />
          </Inline>
          {notesPayload.loading && notes.length === 0 ? (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
              <Skeleton style={{ height: 28 }} />
              <Skeleton style={{ height: 28 }} />
            </Stack>
          ) : notes.length === 0 ? (
            <EmptyState icon={<BookOpen size={28} aria-hidden />} title="No notes" description="Vault is empty or not initialized." />
          ) : (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
              {notes
                .filter((n) => !search || n.path.toLowerCase().includes(search.toLowerCase()))
                .slice(0, 200)
                .map((n) => {
                  const isConfirming = confirmDelete === n.path;
                  return (
                    <div
                      key={n.path}
                      data-testid={`obsidian-row-${n.path}`}
                      style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                    >
                      <Inline align="center" justify="between" gap={2}>
                        <Inline align="center" gap={2}>
                          <FileText size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
                          <button
                            type="button"
                            onClick={() => setActiveNote((cur) => (cur === n.path ? null : n.path))}
                            data-testid={`obsidian-view-${n.path}`}
                            style={{ background: 'transparent', border: 'none', color: 'var(--fg)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit' }}
                          >
                            <code>{n.path}</code>
                          </button>
                          {n.size !== undefined && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{n.size} B</span>}
                        </Inline>
                        <Button variant="ghost" onClick={() => setConfirmDelete((cur) => (cur === n.path ? null : n.path))} data-testid={`obsidian-delete-${n.path}`} aria-label={`Delete ${n.path}`}>
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      </Inline>
                      {isConfirming && (
                        <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                          <Button variant="danger" onClick={() => void drop(n.path)} data-testid={`obsidian-confirm-delete-${n.path}`}>
                            Confirm delete
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                        </Inline>
                      )}
                      {activeNote === n.path && <NoteView path={n.path} />}
                    </div>
                  );
                })}
            </Stack>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}

function NoteView({ path }: { path: string }): JSX.Element {
  const payload = useFetch<{ relPath: string; body?: string; frontmatter?: Record<string, unknown>; raw?: string }>(`/api/obsidian/notes/${path}`);
  return (
    <div data-testid={`obsidian-note-view-${path}`} style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
      {payload.loading && payload.data === null ? (
        <Skeleton style={{ height: 60 }} />
      ) : payload.data ? (
        <pre style={{ margin: 0, fontSize: 'var(--fs-12)', whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>{payload.data.raw ?? payload.data.body ?? ''}</pre>
      ) : (
        <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>Failed to load</span>
      )}
    </div>
  );
}