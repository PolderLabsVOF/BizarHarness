import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Trash2, RefreshCw } from 'lucide-react';
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
 * mark-one-read, mark-all-read, and dismiss.
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

  const dismiss = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await fetchJson(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unread = items.filter((n) => !n.read).length;

  return (
    <Stack gap={5} data-testid="notifications-view">
      <ViewHeader
        title="Notifications"
        description={`${unread} unread of ${items.length} total. Backed by ~/.config/bizar/notifications.jsonl.`}
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <Button variant="ghost" onClick={() => void res.refetch()} data-testid="notifications-refresh">
              <RefreshCw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="secondary" onClick={() => void markAll()} disabled={busy === 'all' || unread === 0} data-testid="notifications-mark-all">
              <CheckCheck size={14} aria-hidden /> Mark all read
            </Button>
          </Inline>
        }
      />
      {res.loading && items.length === 0 ? (
        <Stack gap={2}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </Stack>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} aria-hidden />}
          title="No notifications"
          description="Agent runs, task moves, and CI results will land here."
        />
      ) : (
        <Stack gap={2}>
          {items.map((n) => {
            const tone = toneFor(n);
            return (
              <Card key={n.id} variant="default" style={{ opacity: n.read ? 0.7 : 1 }}>
                <CardBody>
                  <Inline align="start" justify="between" gap={3}>
                    <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                      <Inline align="center" gap={2}>
                        {!n.read && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--accent)' }} />}
                        <strong style={{ fontSize: 'var(--fs-13)' }}>{n.title || n.source || n.id}</strong>
                        {n.source && <Badge tone={tone}>{n.source}</Badge>}
                        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>{fmtRel(n.createdAt)}</span>
                      </Inline>
                      {n.body && <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{n.body}</span>}
                    </Stack>
                    <Inline gap={1}>
                      {!n.read && (
                        <Button variant="ghost" onClick={() => void markRead(n.id)} disabled={busy === n.id} data-testid={`notification-read-${n.id}`}>
                          Mark read
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => void dismiss(n.id)} disabled={busy === n.id} data-testid={`notification-dismiss-${n.id}`}>
                        <Trash2 size={12} aria-hidden /> Dismiss
                      </Button>
                    </Inline>
                  </Inline>
                </CardBody>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}