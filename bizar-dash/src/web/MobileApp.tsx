// src/MobileApp.tsx — mobile shell: bottom nav + topbar + tab routing.
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  MessageSquare,
  CheckSquare,
  Settings as SettingsIcon,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { MobileTopbar } from './mobile/MobileTopbar';
import { MobileBottomNav } from './mobile/MobileBottomNav';
import type { MobileTab } from './mobile/MobileBottomNav';
import { MobileActivity } from './mobile/views/MobileActivity';
import { MobileChat } from './mobile/views/MobileChat';
import { MobileTasks } from './mobile/views/MobileTasks';
import { MobileSettings } from './mobile/views/MobileSettings';
import { MobileMore } from './mobile/views/MobileMore';
import { api } from './lib/api';
import { applyTheme, applyThemeTokens } from './lib/types';
import type { Settings, Snapshot, WsMessage } from './lib/types';
import { Spinner } from './components/Spinner';

const TABS: MobileTab[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function MobileApp() {
  const [activeTab, setActiveTab] = useState('activity');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Apply theme
  useEffect(() => {
    if (settings?.theme) {
      applyTheme(settings.theme);
      applyThemeTokens(settings.theme);
    }
  }, [settings?.theme]);

  // System mode listener
  useEffect(() => {
    if (settings?.theme?.mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme(settings.theme.mode);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [settings?.theme?.mode]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<Snapshot>('/snapshot').catch(() => null),
      api.get<{ data: Settings }>('/settings').catch(() => null),
    ])
      .then(([snap, set]) => {
        if (cancelled) return;
        if (snap) setSnapshot(snap);
        if (set?.data) setSettings(set.data);
        if (!snap && !set) setBootError('Dashboard server unreachable.');
      })
      .catch((err) => {
        if (cancelled) return;
        setBootError((err as Error).message || 'unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // WebSocket for live updates
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const msg: WsMessage = JSON.parse(e.data);
          if (msg.type === 'snapshot' && 'data' in msg && msg.data) {
            setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...msg.data }));
          } else if (msg.type === 'tasks:change') {
            const m = msg;
            setSnapshot((cur) => {
              if (!cur) return cur;
              const tasks = (cur.tasks || []).map((t) =>
                t.id === m.task.id ? m.task : t,
              );
              const exists = tasks.some((t) => t.id === m.task.id);
              return { ...cur, tasks: exists ? tasks : [m.task, ...tasks] };
            });
          } else if (msg.type === 'tasks:delete') {
            const m = msg;
            setSnapshot((cur) =>
              cur
                ? { ...cur, tasks: (cur.tasks || []).filter((t) => t.id !== m.id) }
                : cur,
            );
          } else if (msg.type === 'settings:change') {
            const m = msg;
            if (m.settings) setSettings(m.settings);
          }
        } catch {
          // ignore parse errors
        }
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const refreshSnapshot = async () => {
    try {
      const s = await api.get<Snapshot>('/snapshot');
      setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...s }));
    } catch {
      // best-effort
    }
  };

  if (loading) {
    return (
      <div className="mobile-loading">
        <Spinner size="lg" />
        <p>Loading Bizar…</p>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="mobile-loading">
        <h2>Dashboard unavailable</h2>
        <p>{bootError}</p>
        <p className="muted">Make sure the Bizar dashboard server is running.</p>
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <MobileTopbar
        activeTab={activeTab}
        snapshot={snapshot}
        onSearch={() => {}}
      />

      <main className="mobile-content">
        {activeTab === 'activity' && snapshot && (
          <MobileActivity snapshot={snapshot} />
        )}
        {activeTab === 'chat' && snapshot && (
          <MobileChat snapshot={snapshot} settings={settings} />
        )}
        {activeTab === 'tasks' && snapshot && (
          <MobileTasks snapshot={snapshot} onRefresh={refreshSnapshot} />
        )}
        {activeTab === 'settings' && settings && (
          <MobileSettings settings={settings} snapshot={snapshot} />
        )}
        {activeTab === 'more' && snapshot && (
          <MobileMore snapshot={snapshot} setActiveTab={setActiveTab} />
        )}
      </main>

      <MobileBottomNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}
