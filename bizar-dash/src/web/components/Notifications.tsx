// src/components/Notifications.tsx — v3.3.0 bell icon + dropdown panel.

import { useEffect, useRef, useState } from 'react';
import { Bell, Check, X, Info, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from './Button';
import { useToast } from './Toast';
import { api } from '../lib/api';
import { cn, formatRelative } from '../lib/utils';
import type { Notification, NotificationStats, WsMessage } from '../lib/types';

const ICONS: Record<string, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

type Props = {
  /** Setter for unread count so the rest of the app can react. */
  onCountChange?: (unread: number) => void;
  /** Optional hook to subscribe to incoming WS messages. */
  wsSubscribe?: (cb: (msg: WsMessage) => void) => () => void;
};

export function Notifications({ onCountChange, wsSubscribe }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const reload = async () => {
    try {
      setLoading(true);
      const r = await api.get<{ notifications: Notification[]; stats: NotificationStats }>(
        '/notifications?limit=200',
      );
      setItems(r.notifications || []);
      setStats(r.stats || null);
      onCountChange?.(r.stats?.unread || 0);
    } catch (err) {
      // Soft-fail: the bell just shows no items.
      // eslint-disable-next-line no-console
      console.warn('[notifications] reload failed:', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to incoming notification:new events.
  useEffect(() => {
    if (!wsSubscribe) return;
    const off = wsSubscribe((msg) => {
      if (msg.type === 'notification:new') {
        const incoming = msg.notification;
        setItems((cur) => [incoming, ...cur.filter((n) => n.id !== incoming.id)]);
        // Bump unread count.
        if (!incoming.read) {
          setStats((cur) =>
            cur ? { ...cur, unread: (cur.unread || 0) + 1 } : { total: 1, unread: 1, lastTs: incoming.ts, counts: { [incoming.severity || 'info']: 1 } },
          );
          onCountChange?.((stats?.unread || 0) + 1);
        }
      } else if (msg.type === 'notifications:change') {
        // External change (mark-all-read, etc.) — refresh from server.
        reload();
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSubscribe]);

  // Close the panel on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const onMarkAllRead = async () => {
    try {
      await api.post('/notifications/read-all', {});
      setItems((cur) => cur.map((n) => ({ ...n, read: true })));
      setStats((cur) => (cur ? { ...cur, unread: 0 } : cur));
      onCountChange?.(0);
      toast.success('All notifications marked as read.', 1500);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const onMarkRead = async (id: string) => {
    try {
      await api.post(`/notifications/${encodeURIComponent(id)}/read`, {});
      setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setStats((cur) => (cur ? { ...cur, unread: Math.max(0, (cur.unread || 1) - 1) } : cur));
      onCountChange?.(Math.max(0, (stats?.unread || 1) - 1));
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const onRemove = async (id: string) => {
    try {
      await api.del(`/notifications/${encodeURIComponent(id)}`);
      setItems((cur) => cur.filter((n) => n.id !== id));
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const unread = stats?.unread || 0;

  return (
    <div className="notifications-root" ref={rootRef}>
      <button
        type="button"
        className={cn('topbar-icon-btn notifications-bell', open && 'is-open')}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell size={16} />
        {unread > 0 && <span className="notifications-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notifications-panel" role="dialog" aria-label="Notifications">
          <header className="notifications-panel-head">
            <div>
              <strong>Notifications</strong>
              {unread > 0 && <span className="muted text-sm"> · {unread} unread</span>}
            </div>
            <div className="notifications-panel-head-actions">
              <Button size="sm" variant="ghost" onClick={onMarkAllRead} disabled={unread === 0}>
                <Check size={12} /> Mark all read
              </Button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="notifications-list">
            {loading && items.length === 0 ? (
              <div className="notifications-empty muted">Loading…</div>
            ) : items.length === 0 ? (
              <div className="notifications-empty muted">No notifications yet.</div>
            ) : (
              items.map((n) => {
                const Icon = ICONS[n.severity] || Info;
                return (
                  <div
                    key={n.id}
                    className={cn('notification-item', !n.read && 'is-unread', `severity-${n.severity}`)}
                  >
                    <Icon size={14} className={`notification-icon severity-${n.severity}`} />
                    <div className="notification-body">
                      {n.title && <div className="notification-title">{n.title}</div>}
                      <div className="notification-msg">{n.message}</div>
                      <div className="notification-meta muted">
                        <span className="mono">{n.source}</span>
                        <span>·</span>
                        <span>{formatRelative(n.ts)}</span>
                      </div>
                    </div>
                    <div className="notification-actions">
                      {!n.read && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onMarkRead(n.id)}
                          title="Mark as read"
                          aria-label="Mark as read"
                        >
                          <Check size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => onRemove(n.id)}
                        title="Remove"
                        aria-label="Remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <footer className="notifications-panel-foot">
            <span className="muted text-sm">
              {stats ? `${stats.total} total · last ${formatRelative(stats.lastTs || new Date().toISOString())}` : ''}
            </span>
          </footer>
        </div>
      )}
    </div>
  );
}
