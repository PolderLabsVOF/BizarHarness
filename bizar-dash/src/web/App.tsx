// src/App.tsx — root shell. Wires data + contexts + tab routing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Topbar, TABS } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { ModalProvider, useModal } from './components/Modal';
import { ToastProvider, useToast } from './components/Toast';
import { SearchModal } from './components/SearchModal';
import { Notifications } from './components/Notifications';
import { CommandDialog, type DialogDescriptor } from './components/CommandDialog';
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
import { Activity } from './views/Activity';
import { Config } from './views/Config';
import { SettingsView } from './views/Settings';
import { Mods } from './views/Mods';
import { Schedules } from './views/Schedules';
import { Skills } from './views/Skills';
import { History } from './views/History';
import { Providers } from './views/Providers';
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
  /**
   * v3.3.0 — Cross-view scratch state. The "Open in chat" button
   * on the Agents tab sets `pendingInitialAgent`, which the Chat
   * view reads on mount (and clears). Keeps the chat a true
   * one-click handoff without needing URL state.
   */
  crossState?: CrossViewState;
  setCrossState?: (patch: Partial<CrossViewState>) => void;
};

export type CrossViewState = {
  initialAgent?: string | null;
};

const VIEW_MAP: Record<string, (p: ViewProps) => React.ReactNode> = {
  overview: Overview,
  chat: Chat,
  agents: Agents,
  providers: Providers,
  plans: Plans,
  tasks: Tasks,
  activity: Activity,
  config: Config,
  settings: SettingsView,
  mods: Mods,
  schedules: Schedules,
  skills: Skills,
  history: History,
};

const VERSION = 'v3.6.1';

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
  const modalApi = useModal();
  const { isModalOpen } = modalApi;
  const isModalOpenRef = useRef(false);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [bootError, setBootError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [stuckAgents, setStuckAgents] = useState<{ name: string }[]>([]);
  const [stuckBannerDismissed, setStuckBannerDismissed] = useState(false);
  const wsRef = useRef<Ws | null>(null);
  const [ws, setWs] = useState<Ws | null>(null);

  // Apply theme tokens
  useEffect(() => {
    if (settings?.theme) {
      applyTheme(settings.theme);
      applyThemeTokens(settings.theme);
    }
  }, [settings?.theme]);

  // v3.6.1 — Keep a ref in sync with isModalOpen so the keyboard handler
  // always reads the current value even between state updates and effect
  // re-runs. This closes the race window where modal.close() has cleared
  // the state but the old keyboard handler (with isModalOpen=false in
  // its closure) hasn't been replaced yet.
  useEffect(() => {
    isModalOpenRef.current = isModalOpen;
  }, [isModalOpen]);

  // System-mode listener
  useEffect(() => {
    if (settings?.theme?.mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme(settings.theme.mode);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [settings?.theme?.mode]);

  // Initial fetch — runs once on mount
  useEffect(() => {
    let cancelled = false;
    const loadBootData = () =>
      Promise.all([
        api.get<Snapshot>('/snapshot').catch(() => null),
        api.get<SettingsResponse>('/settings').catch(() => null),
        api.get<{ stuck: { name: string }[] }>('/agents/stuck').catch(() => null),
      ]);

    const applyBootData = (
      snap: Snapshot | null,
      set: SettingsResponse | null,
      stuck: { stuck: { name: string }[] } | null,
    ) => {
      if (snap) setSnapshot(snap);
      if (set?.data) setSettings(set.data);
      if (stuck?.stuck) setStuckAgents(stuck.stuck);
    };

    (async () => {
      try {
        const auth = await api.probeAuthStatus();
        const [snap, set, stuck] = await loadBootData();
        if (cancelled) return;

        applyBootData(snap, set, stuck);
        if (snap || set) return;

        if (!auth.loopback) {
          setBootError('Dashboard server unreachable.');
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (cancelled) return;

        const [retrySnap, retrySet, retryStuck] = await loadBootData();
        if (cancelled) return;

        applyBootData(retrySnap, retrySet, retryStuck);
        if (!retrySnap && !retrySet) {
          setBootError('Dashboard server unreachable.');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error)?.message ?? 'unknown error';
        setBootError(msg);
        toast.error(`Failed to load: ${msg}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Apply defaultTab ONCE on mount only — must NOT re-fire on toast changes
  useEffect(() => {
    let cancelled = false;
    api.get<SettingsResponse>('/settings')
      .then((set) => {
        if (cancelled) return;
        const defaultTab = set?.data?.ui?.defaultTab;
        if (defaultTab) setActiveTab(defaultTab);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);  // empty deps — runs once on mount

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
    setWs(ws);
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
      } else if (msg.type === 'dialog:show') {
        // v0.5.1: Open a command dialog received from the plugin via WS broadcast.
        const m = msg as { type: 'dialog:show'; dialog: DialogDescriptor };
        if (m.dialog) {
          modalApi.open({
            title: m.dialog.title,
            width: 520,
            children: <CommandDialog dialog={m.dialog} onClose={() => modalApi.close()} />,
          });
        }
      }
    });
    return () => {
      offStatus();
      offMsg();
      ws.close();
      setWs(null);
    };
  }, [toast]);

  const subscribeToWs = useCallback((cb: (msg: WsMessage) => void) => {
    if (!ws) return () => undefined;
    return ws.on(cb);
  }, [ws]);

  // v3.3.1 — Track recent user interactions. After any mousedown/click/
  // focusin/keydown we set a 1500ms "safe" window during which digit-key
  // shortcuts are suppressed. This protects against the case where a modal
  // closes on a click and the user's next key event (often a key-repeat)
  // would otherwise trigger setActiveTab("overview").
  // v3.3.0 used 250ms which was too short (keyboard repeat can fire later).
  //
  // v3.5.4 (bug #4) — The safe window alone was not enough. Users were
  // still being bounced to overview after action grace windows expired
  // because the transientFocus check (activeElement === body) was nested
  // inside the safe-window branch. See the handler below for the new
  // two-gate model: (1) body/null focus ALWAYS blocks digit shortcuts;
  // (2) the safe window relaxes that block only for the first 1500ms
  // after an interaction. After the window passes, the user must
  // explicitly focus a real element before digit-key tab switches work.
  const safeUntilRef = useRef(0);
  useEffect(() => {
    const bump = () => {
      safeUntilRef.current = Date.now() + 1500;
    };
    document.addEventListener('mousedown', bump, true);
    document.addEventListener('click', bump, true);
    document.addEventListener('focusin', bump, true);
    document.addEventListener('keydown', bump, true);
    return () => {
      document.removeEventListener('mousedown', bump, true);
      document.removeEventListener('click', bump, true);
      document.removeEventListener('focusin', bump, true);
      document.removeEventListener('keydown', bump, true);
    };
  }, []);

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
      // v3.2.0 — broader guard. Digit-key shortcuts must not fire while
      // the user is interacting with ANY focusable form control or a
      // modal/contentEditable region. Previously this only excluded
      // <input> and <textarea>, which let digit presses through when
      // focus was on a <select>, <button>, <label>, or contenteditable
      // node — causing mysterious tab switches (most often back to
      // "overview" via the `1` shortcut).
      //
      // v3.3.1 — "click after modal close" guard (extended). When a modal
      // closes (e.g. the user clicks "Submit to Odin" in the Tasks tab),
      // React portals the modal out of the DOM and the previously-focused
      // button is unmounted. Focus falls back to <body>. If the user then
      // accidentally taps a digit key (1/2/3/...) — or a key-repeat fires
      // while they're still mid-click — the handler would switch tabs.
      // The safe window is now 1500ms (up from 250ms) and covers all
      // interaction types (mousedown/click/focusin/keydown).
      //
      // v3.3.1 — transient-focus check. If active element is body/null,
      // treat it as a transient focus state (modal close → body fallback)
      // and bail. v3.5.4 (bug #4): this check is now independent of the
      // safe window — it ALWAYS applies. Previously it was only effective
      // inside the 1500ms grace window, which let digit-key presses through
      // once the window expired. The user would see themselves bounced back
      // to overview (digit `1`) after every action whose grace window had
      // already elapsed. The safe window now only relaxes the rule
      // temporarily for the action that JUST happened; it must be combined
      // with a real focus element for digit-key shortcuts to fire.
      const activeEl = document.activeElement;
      const transientFocus = !activeEl || activeEl === document.body || activeEl === document.documentElement;
      if (transientFocus) {
        // Even within the grace window, body/null focus means there is
        // no real input target — refuse to switch tabs. The user must
        // explicitly click into a focusable element (input, button, etc.)
        // to enable digit-key tab switching again.
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isFormControl =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        tag === 'button' ||
        tag === 'option' ||
        tag === 'label' ||
        !!target?.isContentEditable;
      // Inside a form? Even safer: walk up to check.
      let inForm = false;
      if (target && typeof target.closest === 'function') {
        inForm = !!target.closest('form, [role="dialog"], [contenteditable], [data-no-key]');
      }
      // v3.5.2 — reject key-repeat events. When a user presses and holds
      // a digit key the browser fires repeated keydown events; we must only
      // act on the first (e.repeat === false). This prevents the modal-close
      // + key-repeat scenario from switching tabs after the safe window closes.
      if (e.repeat) return;
      // v3.6.1 — Check isModalOpenRef (not the closure variable) so we always
      // see the current value even between state update and effect re-run.
      if (isModalOpenRef.current) return;
      if (
        isFormControl ||
        inForm ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        Date.now() < safeUntilRef.current
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
  const showHeader = settings?.ui?.showHeader !== false;

  return (
    <div className="app" data-layout={layout} data-active-tab={activeTab}>
      {showHeader && (
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
          settings={settings}
          notificationsSlot={<Notifications wsSubscribe={subscribeToWs} />}
          showTabs={layout === 'topnav'}
        />
      )}
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
