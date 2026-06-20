// src/mobile/views/MobileNotifications.tsx — notifications bell + sheet.
import { useEffect, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Notification } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';

type Props = {
  onSelect: (id: string) => void;
};

function notifIcon(severity: string) {
  switch (severity) {
    case 'success': return '✓';
    case 'error': return '✗';
    case 'warning': return '⚠';
    default: return 'ℹ';
  }
}

function formatNotifTime(ts: string): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

export function MobileNotifications({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    try {
      const data = await api.get<{ notifications: Notification[]; stats: { unread: number } }>('/notifications');
      setNotifications(data.notifications || []);
      setUnread(data.stats?.unread || 0);
    } catch {
      // best-effort
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((cur) => cur.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {
      // best-effort
    }
  };

  const markRead = async (id: string) => {
    try {
      await api.post(`/notifications/${encodeURIComponent(id)}/read`);
      setNotifications((cur) =>
        cur.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      // best-effort
    }
  };

  return (
    <>
      <button
        type="button"
        className="mobile-icon-btn mobile-notif-btn"
        onClick={() => setOpen(true)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="mobile-notif-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      <MobileBottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        actions={
          unread > 0 ? (
            <button type="button" className="mobile-btn mobile-btn-secondary" style={{ width: '100%' }} onClick={markAllRead}>
              <CheckCheck size={14} /> Mark all read
            </button>
          ) : undefined
        }
      >
        <div className="mobile-notif-list">
          {notifications.length === 0 && (
            <div className="mobile-empty">
              <Bell size={32} />
              <p>No notifications</p>
            </div>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`mobile-notif-item ${n.read ? 'read' : 'unread'}`}
              onClick={() => {
                if (!n.read) markRead(n.id);
                if (n.link) onSelect(n.link);
                setOpen(false);
              }}
            >
              <span className={`mobile-notif-icon severity-${n.severity}`}>
                {notifIcon(n.severity)}
              </span>
              <div className="mobile-notif-body">
                <span className="mobile-notif-title">{n.title || n.message}</span>
                {n.message && n.title && (
                  <span className="mobile-notif-text">{n.message}</span>
                )}
                <span className="mobile-notif-time">{formatNotifTime(n.ts)}</span>
              </div>
              {!n.read && <span className="mobile-notif-dot" />}
            </div>
          ))}
        </div>
      </MobileBottomSheet>
    </>
  );
}
