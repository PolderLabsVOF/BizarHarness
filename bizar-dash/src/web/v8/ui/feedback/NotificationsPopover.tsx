/**
 * v8/ui/feedback/NotificationsPopover.tsx — Sprint S15b control surface.
 *
 * Bell-button + popover of unread notifications. Hits:
 *   - GET   /api/notifications?unread=true → list + stats
 *   - POST  /api/notifications/:id/read
 *   - POST  /api/notifications/read-all
 *
 * Closes on Escape + outside click.
 */

import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './useFocusTrap.js';
import { Bell, Check } from 'lucide-react';
import { Box } from '../primitives/Box.js';
import { Inline } from '../primitives/Inline.js';
import { Stack } from '../primitives/Stack.js';
import { Button } from '../controls/Button.js';
import { Badge } from '../data/Badge.js';
import { fetchJson } from '../../data/fetcher.js';
import { useWsMessage } from '../../data/useWebSocket.js';

interface NotificationItem {
  id: string;
  title?: string;
  body?: string;
  ts?: number;
  kind?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  read?: boolean;
}

function timeShort(ts?: number): string {
  if (typeof ts !== 'number') return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const KIND_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  warning: 'warning',
  danger: 'danger',
  error: 'danger',
  success: 'success',
};

export function NotificationsPopover(): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const refetch = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetchJson<{ notifications?: NotificationItem[] }>('/api/notifications?unread=true');
      setItems(res.notifications ?? []);
    } catch {
      /* swallow — server unreachable, show empty */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, []);

  // Refresh on WS notifications:change.
  useWsMessage('notifications:change', () => { void refetch(); });

  // Outside click + Esc close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (id: string): Promise<void> => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await fetchJson(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
    } catch {
      // Re-add on failure so the badge stays honest.
      void refetch();
    }
  };

  const markAll = async (): Promise<void> => {
    const snapshot = items;
    setItems([]);
    try {
      await fetchJson('/api/notifications/read-all', { method: 'POST' });
    } catch {
      setItems(snapshot);
    }
  };

  const unread = items.length;

  useFocusTrap(ref, open);
  return (
    <Box style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        aria-label={`Notifications (${unread} unread)`}
        data-testid="topbar-notifications"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--fg-muted)',
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <Bell size={16} aria-hidden />
        {unread > 0 && (
          <Box
            aria-hidden="true"
            data-testid="topbar-notifications-count"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--danger)',
              color: 'var(--fg-on-accent)',
              fontSize: 'var(--fs-12)',
              fontWeight: 600,
              lineHeight: '16px',
              padding: '0 4px',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </Box>
        )}
      </button>
      {open && (
        <Box
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 360,
            maxHeight: 480,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            zIndex: 50,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Inline
            align="center"
            justify="between"
            style={{
              padding: 'var(--space-3)',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-1)',
            }}
          >
            <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>
              Notifications
            </span>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { void markAll(); }}>
                <Check size={12} aria-hidden /> Mark all read
              </Button>
            )}
          </Inline>
          <Box style={{ overflowY: 'auto', flex: 1 }}>
            {loading && items.length === 0 && (
              <Box style={{ padding: 'var(--space-4)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Loading…
              </Box>
            )}
            {!loading && items.length === 0 && (
              <Box style={{ padding: 'var(--space-4)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                No unread notifications.
              </Box>
            )}
            {items.map((n) => {
              const tone = KIND_TONE[n.tone ?? ''] ?? KIND_TONE[n.kind ?? ''] ?? 'info';
              return (
                <Box
                  key={n.id}
                  style={{
                    padding: 'var(--space-3)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <Stack gap={1}>
                    <Inline align="center" justify="between" gap={2}>
                      <span style={{ fontSize: 'var(--fs-13)', fontWeight: 500 }}>{n.title || n.kind || 'Notification'}</span>
                      <Badge tone={tone} size="sm">{n.kind ?? n.tone ?? 'info'}</Badge>
                    </Inline>
                    {n.body !== undefined && (
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{n.body}</span>
                    )}
                    <Inline align="center" justify="between">
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{timeShort(n.ts)}</span>
                      <Button variant="ghost" size="sm" onClick={() => { void markRead(n.id); }}>
                        Mark read
                      </Button>
                    </Inline>
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}