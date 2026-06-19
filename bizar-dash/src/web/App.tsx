// src/App.tsx — root shell. Wires data + contexts + tab routing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Topbar, TABS } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { ModalProvider } from './components/Modal';
import { ToastProvider, useToast } from './components/Toast';
import { SearchModal } from './components/SearchModal';
import { api } from './lib/api';
import { Ws } from './lib/ws';
import {
  applyTheme,
  applyThemeTokens,
  type Plan,
  type Settings,
  type SettingsResponse,
  type Snapshot,
  type WsMessage,
  type WsStatus,
  type ProjectRecord,
  type SearchResult,
} from './lib/types';
import { Overview } from './views/Overview';
import { Chat } from './views/Chat';
import { Agents } from './views/Agents';
import { Plans } from './views/Plans';
import { Tasks } from './views/Tasks';
import { Config } from './views/Config';
import { SettingsView } from './views/Settings';
import { Mods } from './views/Mods';
import { Schedules } from './views/Schedules';
import { Skills } from './views/Skills';
import { Spinner } from './components/Spinner';
import { Button } from './components/Button';
import { AlertTriangle, X } from 'lucide-react';
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
  tasks: Tasks,
  config: Config,
  settings: SettingsView,
  mods: Mods,
  schedules: Schedules,
  skills: Skills,
};

const VERSION = 'v3.1.0';

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
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [bootError, setBootError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [stuckAgents, setStuckAgents] = useState<{ name: string }[]>([]);
  const [stuckBannerDismissed, setStuckBannerDismissed] = useState(false);
  const wsRef = useRef<Ws | null>(null);

  // Apply theme tokens
  useEffect(() => {
    if (settings?.theme) {
      applyTheme(settings.theme);
      applyThemeTokens(settings.theme);
    }
  }, [settings?.theme]);

  // System-mode listener
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
      api.get<SettingsResponse>('/settings').catch(() => null),
      api.get<{ stuck: { name: string }[] }>('/agents/stuck').catch(() => null),
    ])
      .then(([snap, set, stuck]) => {
        if (cancelled) return;
        if (snap) setSnapshot(snap);
        if (set?.data) setSettings(set.data);
        if (stuck?.stuck) setStuckAgents(stuck.stuck);
        if (!snap && !set) setBootError('Dashboard server unreachable.');
        if (set?.data?.ui?.defaultTab) setActiveTab(set.data.ui.defaultTab);
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

  // v3.1.0 — Periodic stuck-agent poll. Light-weight; the server does
  // the threshold math and only returns the list.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await api.get<{ stuck: { name: string }[] }>('/agents/stuck');
        if (!cancelled) {
          setStuckAgents((cur) => {
            const next = r.stuck || [];
            const wasEmpty = cur.length === 0;
            if (wasEmpty && next.length > 0) {
              toast.warning(`${next.length} agent${next.length === 1 ? '' : 's'} stuck`, 5000);
            }
            return next;
          });
        }
      } catch {
        /* best-effort */
      }
    };
    const id = setInterval(tick, 30_000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          .then((s) => setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...s })))
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
      } else if (msg.type === 'project:change') {
        // Refresh the whole snapshot to pick up the new active project
        api
          .get<Snapshot>('/snapshot')
          .then((s) => setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...s })))
          .catch(() => undefined);
      } else if (msg.type === 'agents:change' || msg.type === 'schedules:change') {
        api
          .get<Snapshot>('/snapshot')
          .then((s) => setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...s })))
          .catch(() => undefined);
      } else if (msg.type === 'agent:status' || msg.type === 'agent:restarted') {
        const m = msg;
        setSnapshot((cur) => {
          if (!cur) return cur;
          const agents = (cur.agents || []).map((a) => (a.name === m.agent.name ? m.agent : a));
          return { ...cur, agents };
        });
      } else if (msg.type === 'plan:change') {
        // Plans list refreshes after any plan mutation.
        api
          .get<{ plans: Plan[] }>('/plans')
          .then((d) => {
            setSnapshot((cur) => (cur ? { ...cur, plans: d.plans || [] } : cur));
          })
          .catch(() => undefined);
      } else if (msg.type === 'agent:stuck') {
        const m = msg;
        setStuckAgents(m.agents || []);
      }
    });
    return () => {
      offStatus();
      offMsg();
      ws.close();
    };
  }, [toast]);

  // Keyboard shortcuts
  useEffect(() => {
    const map: Record<string, string> = {};
    TABS.forEach((t, i) => {
      map[String(i + 1)] = t.id;
    });
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const t = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (t !== 'input' && t !== 'textarea' && !((e.target as HTMLElement)?.isContentEditable)) {
          e.preventDefault();
          setSearchOpen(true);
          return;
        }
      }
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

  const refreshProjects = async () => {
    try {
      const r = await api.get<{ projects: ProjectRecord[]; active: string | null }>('/projects');
      setSnapshot((cur) =>
        cur ? { ...cur, projects: r.projects || [], activeProject: r.projects?.find((p) => p.id === r.active) || null } : cur,
      );
    } catch (err) {
      toast.error(`Projects refresh failed: ${(err as Error).message}`);
    }
  };

  const onActivateProject = async (id: string) => {
    try {
      await api.post(`/projects/${encodeURIComponent(id)}/activate`);
      // WS will fire project:change and refresh; but also reflect locally
      setSnapshot((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          activeProject: cur.projects.find((p) => p.id === id) || null,
        };
      });
    } catch (err) {
      toast.error(`Activate failed: ${(err as Error).message}`);
    }
  };

  const onSearchSelect = (r: SearchResult) => {
    const t = r.type;
    if (t === 'agent') setActiveTab('agents');
    else if (t === 'task') setActiveTab('tasks');
    else if (t === 'mod') setActiveTab('mods');
    else if (t === 'schedule') setActiveTab('schedules');
    else if (t === 'project') {
      const id = (r.item as ProjectRecord).id;
      onActivateProject(id);
    } else if (t === 'command') {
      // No command page; just toast
      toast.info(`/${(r.item as { name: string }).name} — run from the TUI`, 2500);
    } else if (t === 'setting') {
      // v3.0.4 — Jump to Settings view and scroll to the matching row.
      const settingId = (r.item as { id?: string; path?: string }).id
        || (r.item as { path?: string }).path
        || '';
      setActiveTab('settings');
      // Defer the scroll to allow the view to mount, then apply a brief
      // CSS highlight. We poll a few times because the Settings view
      // mounts lazily after tab switch.
      const tryScroll = (tries: number) => {
        if (tries <= 0) return;
        const el = settingId
          ? document.querySelector(`[data-setting-id="${CSS.escape(settingId)}"]`)
          : null;
        if (el) {
          (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('setting-flash');
          // Force reflow so the animation re-triggers on rapid jumps.
          void (el as HTMLElement).offsetWidth;
          el.classList.add('setting-flash');
          window.setTimeout(() => el.classList.remove('setting-flash'), 1500);
        } else {
          window.setTimeout(() => tryScroll(tries - 1), 80);
        }
      };
      window.setTimeout(() => tryScroll(15), 60);
    }
  };

  const layout = settings?.ui?.layout || 'topnav';

  return (
    <div className="app" data-layout={layout} data-active-tab={activeTab}>
      <Topbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        wsStatus={wsStatus}
        version={VERSION}
        activeProject={snapshot?.activeProject || null}
        projects={snapshot?.projects || []}
        onProjectChange={onActivateProject}
        onProjectsRefresh={refreshProjects}
        onOpenSearch={() => setSearchOpen(true)}
        showTabs={layout === 'topnav'}
      />
      {stuckAgents.length > 0 && !stuckBannerDismissed && (
        <div className="stuck-banner" role="alert">
          <AlertTriangle size={16} />
          <span>
            <strong>{stuckAgents.length}</strong> agent{stuckAgents.length === 1 ? '' : 's'} stuck:{' '}
            <span className="mono">
              {stuckAgents.map((a) => a.name).join(', ')}
            </span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setActiveTab('agents');
              setStuckBannerDismissed(true);
            }}
          >
            Review
          </Button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss"
            onClick={() => setStuckBannerDismissed(true)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="layout-body">
        {layout !== 'topnav' && (
          <Sidebar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        )}
        <main className="content">
          {bootError && (
            <div className="boot-error">
              <h2>Dashboard unavailable</h2>
              <p>{bootError}</p>
              <p className="boot-error-hint">
                Make sure the Bizar dashboard server is running. Try{' '}
                <code>bizar-dash start</code> in your terminal.
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
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={onSearchSelect}
      />
    </div>
  );
}
