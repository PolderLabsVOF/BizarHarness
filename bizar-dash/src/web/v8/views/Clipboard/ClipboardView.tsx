/**
 * v8/views/Clipboard/ClipboardView.tsx — Sprint S43, v9.3.0.
 *
 * Saved clip list (GET /api/clipboard/list), Save Sheet
 * (POST /api/clipboard/save with {url, title, content, selection}),
 * inline-confirm Delete (DELETE /api/clipboard/:id). Each row links
 * to the source URL when present.
 */

import { useCallback, useMemo, useState } from 'react';
import { ClipboardPaste, Plus, Trash2, ExternalLink, RefreshCcw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface Clip {
  id: string;
  url?: string;
  title?: string;
  content?: string;
  selection?: string;
  savedAt?: string;
}

export function ClipboardView(): JSX.Element {
  const payload = useFetch<{ clips: Clip[] }>('/api/clipboard/list');
  const [saving, setSaving] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clips = useMemo<Clip[]>(() => payload.data?.clips ?? [], [payload.data]);
  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  const drop = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/clipboard/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={4} data-testid="clipboard-view">
      <ViewHeader
        title="Clipboard"
        description="Saved clips. Each becomes a markdown note under clips/."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="clipboard-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="clipboard-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setSaving(true)} data-testid="clipboard-add">
              <Plus size={14} aria-hidden /> Save clip
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          {payload.loading && clips.length === 0 ? (
            <Stack gap={1}>
              <Skeleton style={{ height: 60 }} />
              <Skeleton style={{ height: 60 }} />
            </Stack>
          ) : clips.length === 0 ? (
            <EmptyState icon={<ClipboardPaste size={28} aria-hidden />} title="No saved clips" description="Save one with a URL + content." />
          ) : (
            <Stack gap={1}>
              {clips.map((c) => {
                const isConfirming = confirmDelete === c.id;
                return (
                  <div
                    key={c.id}
                    data-testid={`clipboard-row-${c.id}`}
                    style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                        <Inline align="center" gap={2}>
                          <strong style={{ fontSize: 'var(--fs-13)' }}>{c.title || c.id}</strong>
                          {c.url && (
                            <a href={c.url} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--fs-11)', color: 'var(--accent)' }}>
                              <ExternalLink size={10} aria-hidden style={{ verticalAlign: 'middle' }} /> {c.url}
                            </a>
                          )}
                          {c.savedAt && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{c.savedAt}</span>}
                        </Inline>
                        {(c.selection || c.content) && (
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                            {(c.selection || c.content || '').length > 200
                              ? `${(c.selection || c.content || '').slice(0, 200)}…`
                              : (c.selection || c.content)}
                          </span>
                        )}
                      </Stack>
                      <Button variant="ghost" onClick={() => setConfirmDelete((cur) => (cur === c.id ? null : c.id))} data-testid={`clipboard-delete-${c.id}`} aria-label={`Delete ${c.id}`}>
                        <Trash2 size={14} aria-hidden />
                      </Button>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(c.id)} data-testid={`clipboard-confirm-delete-${c.id}`}>
                          Confirm delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={saving} onOpenChange={setSaving}>
        <SheetContent side="right" title="Save clip" description="URL or content required.">
          <SaveForm
            onSubmit={async (body) => {
              await fetchJson('/api/clipboard/save', { method: 'POST', body });
              setSaving(false);
              refresh();
            }}
            onCancel={() => setSaving(false)}
          />
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function SaveForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: { url?: string; title?: string; content?: string; selection?: string }) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [url, setUrl] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [selection, setSelection] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>URL (optional)</span>
        <Input value={url} onChange={(e) => setUrl((e.target as HTMLInputElement).value)} data-testid="clipboard-form-url" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Title (optional)</span>
        <Input value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} data-testid="clipboard-form-title" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Content</span>
        <Textarea value={content} rows={6} onChange={(e) => setContent((e.target as HTMLTextAreaElement).value)} data-testid="clipboard-form-content" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Selection (optional)</span>
        <Textarea value={selection} rows={3} onChange={(e) => setSelection((e.target as HTMLTextAreaElement).value)} data-testid="clipboard-form-selection" />
      </label>
      {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
      <Inline justify="end" gap={2}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || (!url.trim() && !content.trim())}
          data-testid="clipboard-form-submit"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSubmit({
                url: url.trim() || undefined,
                title: title.trim() || undefined,
                content: content.trim() || undefined,
                selection: selection.trim() || undefined,
              });
            } catch (err) {
              setError(err instanceof FetchError ? err.message : (err as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Inline>
    </Stack>
  );
}