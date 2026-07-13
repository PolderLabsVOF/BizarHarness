import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { MemoryVault, type MemoryEntry, type MemoryScope } from '../../ui/memory/MemoryVault.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { Brain } from 'lucide-react';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { Chip } from '../../ui/data/Chip.js';
import { Button } from '../../ui/controls/Button.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

/**
 * MemoryView — Sprint S10 + S15b. Pulls `/api/memory`, lets the user
 * create / edit / delete notes via the dashboard's control surface.
 *
 * Notes are stored via `/api/memory/notes` (POST create, PUT/DELETE
 * per-note). Scope is `project` (in the repo) vs `global` (user-wide).
 */

interface RawMemoryEntry {
  id?: string;
  content?: string;
  tags?: string[];
  scope?: 'project' | 'global';
  updatedAt?: string | number;
}

interface MemoryResponse {
  notes?: RawMemoryEntry[];
  count?: number;
}

function toEntry(e: RawMemoryEntry): MemoryEntry {
  return {
    id: e.id || '',
    content: e.content || '',
    tags: e.tags || [],
    scope: (e.scope || 'project') as MemoryScope,
    updatedAt:
      typeof e.updatedAt === 'number'
        ? new Date(e.updatedAt).toLocaleString()
        : e.updatedAt || '',
  };
}

interface NoteDraft {
  id?: string;
  content: string;
  scope: MemoryScope;
}

export function MemoryView(): JSX.Element {
  const mem = useFetch<MemoryResponse>('/api/memory/notes');
  const [scope, setScope] = useState<MemoryScope | 'all'>('all');
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo<MemoryEntry[]>(() => {
    const list = (mem.data?.notes || []).map(toEntry);
    if (scope === 'all') return list;
    return list.filter((e) => e.scope === scope);
  }, [mem.data, scope]);

  const refresh = (): void => { void mem.refetch(); };

  const saveDraft = async (): Promise<void> => {
    if (!draft || !draft.content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id) {
        // Edit
        await fetchJson(`/api/memory/notes/${encodeURIComponent(draft.id)}`, {
          method: 'PUT',
          body: { content: draft.content, scope: draft.scope },
        });
      } else {
        await fetchJson('/api/memory/notes', {
          method: 'POST',
          body: { content: draft.content, scope: draft.scope },
        });
      }
      setDraft(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/memory/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setDraft(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Memory"
        description="Cross-session notes. Project memos live in the repo; global memos live on the user."
      />
      <Inline align="center" justify="between" gap={2} wrap>
        <Inline gap={2}>
          {(['all', 'project', 'global'] as const).map((s) => (
            <Chip key={s} selected={scope === s} onClick={() => setScope(s)}>
              {s === 'all' ? 'All' : s === 'project' ? 'Project' : 'Global'}
            </Chip>
          ))}
        </Inline>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setDraft({ content: '', scope: 'project' })}
          data-testid="memory-new"
        >
          <Plus size={14} aria-hidden /> New note
        </Button>
      </Inline>
      {error !== null && (
        <div
          role="alert"
          style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))',
            border: '1px solid color-mix(in oklch, var(--danger) 40%, var(--border))',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-12)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
      {mem.loading ? (
        <Skeleton style={{ height: 240 }} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Brain size={32} aria-hidden />}
          title="No memory entries"
          description="Memos land here once they are written via the memory tools. Add one with the button above."
          action={
            <Button variant="primary" size="sm" onClick={() => setDraft({ content: '', scope: 'project' })}>
              <Plus size={14} aria-hidden /> New note
            </Button>
          }
        />
      ) : (
        <MemoryVault
          entries={entries}
          onOpen={(e) => setDraft({ id: e.id, content: e.content, scope: e.scope })}
        />
      )}
      <Sheet open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <SheetContent side="right" title={draft?.id ? 'Edit note' : 'New note'}>
          {draft !== null && (
            <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
              <Stack gap={2}>
                <label
                  htmlFor="memory-content"
                  style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}
                >
                  Content
                </label>
                <Textarea
                  id="memory-content"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={10}
                  disabled={busy}
                  data-testid="memory-content"
                />
              </Stack>
              <Stack gap={2}>
                <label style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Scope</label>
                <Inline gap={2}>
                  {(['project', 'global'] as const).map((s) => (
                    <Chip
                      key={s}
                      selected={draft.scope === s}
                      onClick={() => setDraft({ ...draft, scope: s })}
                    >
                      {s === 'project' ? 'Project (in-repo)' : 'Global (user-wide)'}
                    </Chip>
                  ))}
                </Inline>
              </Stack>
              <Inline gap={2}>
                <Button
                  variant="primary"
                  onClick={() => { void saveDraft(); }}
                  disabled={busy || !draft.content.trim()}
                >
                  {draft.id ? 'Save' : 'Create'}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </Button>
                {draft.id !== undefined && (
                  <Button
                    variant="danger"
                    onClick={() => { void deleteEntry(draft.id!); }}
                    disabled={busy}
                    style={{ marginLeft: 'auto' }}
                  >
                    Delete
                  </Button>
                )}
              </Inline>
            </Stack>
          )}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}