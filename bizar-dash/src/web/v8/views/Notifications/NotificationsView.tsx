import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Trash2, RefreshCw, RotateCcw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { WsMessage } from '../../data/types.js';

/**
 * NotificationsView — Sprint S35. Per-user notification stream backed
 * by `/api/notifications`. Pulls unread + read mixed, supports
 * mark-one-read, mark-all-read, dismiss with 5s undo, and
 * "Show dismissed" with restore.
 */

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface NotificationItem {
  id: string;
  title?: string;
  body?: string;
  source?: string;
  tone?: Tone;
  read?: boolean;
  createdAt?: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  stats?: { total: number; unread: number };
}

interface UndoToast {
  id: string;
  item: NotificationItem;
  timer: ReturnType<typeof setTimeout>;
}

function toneFor(item: NotificationItem): Tone {
  if (item.tone && ['info', 'success', 'warning', 'danger', 'neutral'].includes(item.tone)) {
    return item.tone as Tone;
  }
  return 'neutral';
}

function fmtRel(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const delta = Math.max(0, Date.now() - t);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(t).toLocaleString();
}

export function NotificationsView(): JSX.Element {
  const res = useFetch<NotificationsResponse>('/api/notifications?limit=200');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [dismissed, setDismissed] = useState<NotificationItem[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (res.data?.notifications) setItems(res.data.notifications);
  }, [res.data]);

  const onChange = useCallback((msg: WsMessage) => {
    if (msg.type === 'notifications:change') res.refetch();
  }, [res]);
  useWsMessage('notifications:change', onChange);

  const markRead = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await fetchJson(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const markAll = async (): Promise<void> => {
    setBusy('all');
    setError(null);
    try {
      await fetchJson('/api/notifications/read-all', { method: 'POST' });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = (item: NotificationItem): void => {
    clearTimeout(undoToast?.timer);
    setUndoToast(null);
    setDismissed((prev) => prev.filter((n) => n.id !== item.id));
    setItems((prev) => [item, ...prev]);
  };

  const dismiss = async (id: string): Promise<void> => {
    const item = items.find((n) => n.id === id);
    if (!item) return;
    setBusy(id);
    setError(null);
    try {
      await fetchJson(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((n) => n.id !== id));
      setDismissed((prev) => [item, ...prev]);

      // 5-second undo window
      const timer = setTimeout(() => {
        setDismissed((prev) => prev.filter((n) => n.id !== id));
        setUndoToast((cur) => (cur?.id === id ? null : cur));
      }, 5_000);
      setUndoToast({ id, item, timer });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unread = items.filter((n) => !n.read).length;
  const visibleItems = showDismissed ? [...items, ...dismissed] : items;

  return (
    <Stack gap={5} data-testid="notifications-view">
      <ViewHeader
        title="Notifications"
        description={`${unread} unread of ${items.length} total${dismissed.length > 0 ? `, ${dismissed.length} dismissed` : ''}. Backed by ~/.config/bizar/notifications.jsonl.`}
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <Button variant="ghost" onClick={() => void res.refetch()} data-testid="notifications-refresh">
              <RefreshCw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="secondary" onClick={() => void markAll()} disabled={busy === 'all' || unread === 0} data-testid="notifications-mark-all">
              <CheckCheck size={14} aria-hidden /> Mark all read
            </Button>
            {dismissed.length > 0 && (
              <Button variant="ghost" onClick={() => setShowDismissed((v) => !v)} data-testid="notifications-toggle-dismissed">
                {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissed.length})`}
              </Button>
            )}
          </Inline>
        }
      />
      {res.loading && items.length === 0 ? (
        <Stack gap={2}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </Stack>
      ) : items.length === 0 && dismissed.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} aria-hidden />}
          title="No notifications"
          description="Agent runs, task moves, and CI results will land here."
        />
      ) : (
        <Stack gap={2}>
          {visibleItems.map((n) => {
            const isDismissed = dismissed.some((d) => d.id === n.id);
            const tone = toneFor(n);
            return (
              <Card key={n.id} variant="default" style={{ opacity: isDismissed || n.read ? 0.7 : 1 }}>
                <CardBody>
                  <Inline align="start" justify="between" gap={3}>
                    <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                      <Inline align="center" gap={2}>
                        {isDismissed && <span data-testid={`notification-dismissed-badge-${n.id}`} style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>dismissed</span>}
                        {!n.read && !isDismissed && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--accent)' }} />}
                        <strong style={{ fontSize: 'var(--fs-13)' }}>{n.title || n.source || n.id}</strong>
                        {n.source && <Badge tone={tone}>{n.source}</Badge>}
                        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>{fmtRel(n.createdAt)}</span>
                      </Inline>
                      {n.body && <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{n.body}</span>}
                    </Stack>
                    <Inline gap={1}>
                      {isDismissed ? (
                        <Button variant="ghost" onClick={() => restore(n)} data-testid={`notification-restore-${n.id}`}>
                          <RotateCcw size={12} aria-hidden /> Restore
                        </Button>
                      ) : (
                        <>
                          {!n.read && (
                            <Button variant="ghost" onClick={() => void markRead(n.id)} disabled={busy === n.id} data-testid={`notification-read-${n.id}`}>
                              Mark read
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => void dismiss(n.id)} disabled={busy === n.id} data-testid={`notification-dismiss-${n.id}`}>
                            <Trash2 size={12} aria-hidden /> Dismiss
                          </Button>
                        </>
                      )}
                    </Inline>
                  </Inline>
                </CardBody>
              </Card>
            );
          })}
        </Stack>
      )}
      {undoToast !== null && (
        <Card variant="default" data-testid="notifications-undo-toast" style={{ border: '1px solid var(--accent)', background: 'var(--surface-1)' }}>
          <CardBody>
            <Inline align="center" justify="between" gap={3}>
              <span style={{ fontSize: 'var(--fs-13)' }}>
                Notification dismissed.{' '}
                <button
                  type="button"
                  onClick={() => {
                    clearTimeout(undoToast.timer);
                    setUndoToast(null);
                    restore(undoToast.item);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}
                  data-testid="notifications-undo-btn"
                >
                  Undo
                </button>
              </span>
              <Button variant="ghost" size="sm" onClick={() => { clearTimeout(undoToast.timer); setUndoToast(null); }} data-testid="notifications-undo-close">
                ✕
              </Button>
            </Inline>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}