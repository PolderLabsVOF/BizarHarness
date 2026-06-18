// src/App.tsx — root shell. Wires data + contexts + tab routing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Topbar, TABS } from './components/Topbar';
import { ModalProvider } from './components/Modal';
import { ToastProvider, useToast } from './components/Toast';
import { api } from './lib/api';
import { Ws } from './lib/ws';
import {
  applyTheme,
  type Settings,
  type SettingsResponse,
  type Snapshot,
  type WsMessage,
  type WsStatus,
} from './lib/types';
import { Overview } from './views/Overview';
import { Chat } from './views/Chat';
import { Agents } from './views/Agents';
import { Plans } from './views/Plans';
import { Projects } from './views/Projects';
import { Tasks } from './views/Tasks';
import { Config } from './views/Config';
import { SettingsView } from './views/Settings';
import { Spinner } from './components/Spinner';
import './styles/main.css';

type ViewProps = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const VIEW_MAP: Record<string, (p: ViewProps) => React.ReactNode> = {
  overview: Overview,
  chat: Chat,
  agents: Agents,
  plans: Plans,
  projects: Projects,
  tasks: Tasks,
  config: Config,
  settings: SettingsView,
};

const VERSION = 'v2.6.0';

export function App() {
  return (
    <ToastProvider>
      <ModalProvider>
        <Shell />
      </ModalProvider>
    </ToastProvider>
  );
}

function Shell() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [bootError, setBootError] = useState<string | null>(null);
  const wsRef = useRef<Ws | null>(null);
  const toast = useToast();

  // Apply theme whenever settings are loaded or theme changes
  useEffect(() => {
    if (settings?.theme) applyTheme(settings.theme);
  }, [settings?.theme]);

  // React to system preference when in 'system' mode
  useEffect(() => {
    if (settings?.theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [settings?.theme]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<Snapshot>('/snapshot').catch(() => null),
      api.get<SettingsResponse>('/settings').catch(() => null),
    ])
      .then(([snap, set]) => {
        if (cancelled) return;
        if (snap) setSnapshot(snap);
        if (set?.data) setSettings(set.data);
        if (!snap && !set) {
          setBootError('Dashboard server unreachable.');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = (err as Error)?.message ?? 'unknown error';
        setBootError(msg);
        toast.error(`Failed to load: ${msg}`);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // WebSocket lifecycle
  useEffect(() => {
    const ws = new Ws();
    wsRef.current = ws;
    const offStatus = ws.onStatus((s) => setWsStatus(s));
    const offMsg = ws.on((msg: WsMessage) => {
      if (msg.type === 'snapshot' && 'data' in msg && msg.data) {
        setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...msg.data }));
      } else if (msg.type === 'change') {
        const m = msg;
        const file = m.path?.split('/').pop() || m.path || '';
        toast.info(`File changed: ${file}`, 2500);
        api
          .get<Snapshot>('/snapshot')
          .then((s) =>
            setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...s })),
          )
          .catch(() => undefined);
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
    });
    return () => {
      offStatus();
      offMsg();
      ws.close();
    };
  }, [toast]);

  // Keyboard shortcuts — 1..8 → switch tabs
  useEffect(() => {
    const map: Record<string, string> = {};
    TABS.forEach((t, i) => {
      map[String(i + 1)] = t.id;
    });
    const handler = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (
        t === 'input' ||
        t === 'textarea' ||
        (e.target as HTMLElement)?.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      const id = map[e.key];
      if (id) {
        e.preventDefault();
        setActiveTab(id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const View = VIEW_MAP[activeTab];

  const refreshSnapshot = useMemo(
    () => async () => {
      try {
        const s = await api.get<Snapshot>('/snapshot');
        setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...s }));
      } catch (err) {
        toast.error(`Refresh failed: ${(err as Error).message}`);
      }
    },
    [toast],
  );

  return (
    <div className="app">
      <Topbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        wsStatus={wsStatus}
        version={VERSION}
      />
      <main className="content">
        {bootError && (
          <div className="boot-error">
            <h2>Dashboard unavailable</h2>
            <p>{bootError}</p>
            <p className="boot-error-hint">
              Make sure the Bizar dashboard server is running. Try{' '}
              <code>bizar dashboard start</code> in your terminal.
            </p>
          </div>
        )}
        {!bootError && (!snapshot || !settings) && (
          <div className="loading">
            <Spinner size="lg" />
            <p>Loading Bizar…</p>
          </div>
        )}
        {snapshot && settings && View && (
          <View
            snapshot={snapshot}
            settings={settings}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            refreshSnapshot={refreshSnapshot}
          />
        )}
      </main>
    </div>
  );
}
