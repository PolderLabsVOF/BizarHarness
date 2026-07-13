/**
 * v8/views/Dialogs/DialogsView.tsx — Sprint S42, v9.3.0.
 *
 * Active dialog queue pulled from /api/dialogs. Per-row: view kind,
 * title, body preview, source, age, inline-confirm Dismiss (DELETE
 * /api/dialogs/:id). Empty state + manual Refresh button. No
 * window.confirm.
 */

import { useCallback, useMemo, useState } from 'react';
import { MessageSquare, RefreshCcw, Trash2, X } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface DialogItem {
  id: string;
  kind?: string;
  title?: string;
  body?: string;
  source?: string;
  createdAt?: number | string;
}

export function DialogsView(): JSX.Element {
  const payload = useFetch<{ dialogs: DialogItem[] }>('/api/dialogs');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  // Live: server broadcasts `dialog:show` on enqueue. Refresh on it.
  useWsMessage('dialog:show', () => { refresh(); });

  const drop = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/dialogs/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const dialogs = useMemo<DialogItem[]>(() => payload.data?.dialogs ?? [], [payload.data]);

  return (
    <Stack gap={4} data-testid="dialogs-view">
      <ViewHeader
        title="Dialogs"
        description="Active dialog queue (debug + manual dismiss)."
        actions={
          <Inline gap={1}>
            {error !== null && (
              <span role="alert" data-testid="dialogs-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="dialogs-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
          </Inline>
        }
      />
      <Card variant="default">
        <CardBody>
          {payload.loading && dialogs.length === 0 ? (
            <Stack gap={1}>
              <Skeleton style={{ height: 32 }} />
              <Skeleton style={{ height: 32 }} />
            </Stack>
          ) : dialogs.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={28} aria-hidden />}
              title="No active dialogs"
              description="Dialogs enqueued via the slash-command plugin will appear here."
            />
          ) : (
            <Stack gap={1}>
              {dialogs.map((d) => {
                const isConfirming = confirmDelete === d.id;
                return (
                  <div
                    key={d.id}
                    data-testid={`dialog-row-${d.id}`}
                    style={{
                      padding: 'var(--space-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-0)',
                    }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Inline align="center" gap={2}>
                          <strong style={{ fontSize: 'var(--fs-13)' }}>{d.title || d.id}</strong>
                          {d.kind && (
                            <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
                              {d.kind}
                            </span>
                          )}
                          {d.source && (
                            <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                              · {d.source}
                            </span>
                          )}
                        </Inline>
                        {d.body && (
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                            {d.body.length > 160 ? `${d.body.slice(0, 160)}…` : d.body}
                          </span>
                        )}
                      </Stack>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmDelete((cur) => (cur === d.id ? null : d.id))}
                        data-testid={`dialog-dismiss-${d.id}`}
                        aria-label={`Dismiss ${d.id}`}
                      >
                        <X size={14} aria-hidden /> Dismiss
                      </Button>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(d.id)} data-testid={`dialog-confirm-dismiss-${d.id}`}>
                          <Trash2 size={14} aria-hidden /> Confirm
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
    </Stack>
  );
}