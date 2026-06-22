// src/MobileApp.tsx — mobile root with state-based routing + stack navigation.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckSquare,
  Grid,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Spinner } from './components/Spinner';
import { api } from './lib/api';
import type { Notification, Settings, Snapshot, WsMessage } from './lib/types';
import { applyTheme, applyThemeTokens } from './lib/types';
import { Ws } from './lib/ws';
import { MobileBottomNav, type MobileTab } from './mobile/MobileBottomNav';
import { MobileTopbar } from './mobile/MobileTopbar';
import { MobileActivity } from './mobile/views/MobileActivity';
import { MobileAgents } from './mobile/views/MobileAgents';
import { MobileChat } from './mobile/views/MobileChat';
import { MobileConfig } from './mobile/views/MobileConfig';
import { MobileHistory } from './mobile/views/MobileHistory';
import { MobileMods } from './mobile/views/MobileMods';
import { MobileMore } from './mobile/views/MobileMore';
import { MobilePlanCanvas } from './mobile/views/MobilePlanCanvas';
import { MobilePlans } from './mobile/views/MobilePlans';
import { MobileSchedules } from './mobile/views/MobileSchedules';
import { MobileSearchModal } from './mobile/views/MobileSearchModal';
import { MobileSettings } from './mobile/views/MobileSettings';
import { MobileSkills } from './mobile/views/MobileSkills';
import { MobileTasks } from './mobile/views/MobileTasks';

type MainTabId = 'activity' | 'chat' | 'tasks' | 'settings' | 'more';

export type MobileView =
  | { id: MainTabId }
  | { id: 'plans' }
  | { id: 'agents' }
  | { id: 'skills' }
  | { id: 'mods' }
  | { id: 'schedules' }
  | { id: 'history' }
  | { id: 'config' }
  | { id: 'plan-detail'; slug: string }
  | { id: 'agent-detail'; name: string }
  | { id: 'task-detail'; taskId: string };

const MAIN_TABS: MobileTab[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'more', label: 'More', icon: Grid },
];

function parseNotificationTarget(notification: Notification): MobileView | null {
  const meta = notification.meta ?? {};
  const taskId = typeof meta.taskId === 'string' ? meta.taskId : null;
  const slug = typeof meta.slug === 'string' ? meta.slug : null;
  const agentName = typeof meta.agent === 'string' ? meta.agent : null;
  if (taskId) return { id: 'task-detail', taskId };
  if (slug) return { id: 'plan-detail', slug };
  if (agentName) return { id: 'agent-detail', name: agentName };

  const link = notification.link ?? '';
  if (link.startsWith('/plans/')) return { id: 'plan-detail', slug: decodeURIComponent(link.slice('/plans/'.length)) };
  if (link.startsWith('/tasks/')) return { id: 'task-detail', taskId: decodeURIComponent(link.slice('/tasks/'.length)) };
  if (link.startsWith('/agents/')) return { id: 'agent-detail', name: decodeURIComponent(link.slice('/agents/'.length)) };

  return null;
}

export function MobileApp() {
  const [activeTab, setActiveTab] = useState<MainTabId>('activity');
  const [stack, setStack] = useState<MobileView[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingChatTaskId, setPendingChatTaskId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsEpoch, setWsEpoch] = useState(0);

  const currentView = useMemo<MobileView>(() => {
    return stack[stack.length - 1] ?? { id: activeTab };
  }, [activeTab, stack]);

  const pushView = useCallback((view: MobileView) => {
    setStack((cur) => [...cur, view]);
  }, []);

  const popView = useCallback(() => {
    setStack((cur) => cur.slice(0, -1));
  }, []);

  const goToTab = useCallback((id: MainTabId) => {
    setStack([]);
    setActiveTab(id);
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    try {
      const next = await api.get<Snapshot>('/snapshot');
      setSnapshot(next);
      if (next.settings?.data) {
        setSettings(next.settings.data);
      }
      setBootError(null);
    } catch (err) {
      setBootError((err as Error).message || 'Dashboard server unreachable.');
      throw err;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get<Snapshot>('/snapshot').catch(() => null),
      api.get<{ data: Settings }>('/settings').catch(() => null),
      api.probeAuthStatus().catch(() => null),
    ])
      .then(([snap, settingsResponse]) => {
        if (cancelled) return;
        const nextSettings = settingsResponse?.data ?? snap?.settings?.data ?? null;
        if (snap) setSnapshot(snap);
        if (nextSettings) setSettings(nextSettings);
        if (!snap && !nextSettings) {
          setBootError('Dashboard server unreachable.');
        } else {
          setBootError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setBootError((err as Error).message || 'Dashboard server unreachable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settings?.theme) return;
    applyTheme(settings.theme);
    applyThemeTokens(settings.theme);
  }, [settings?.theme]);

  useEffect(() => {
    if (settings?.theme?.mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (!settings?.theme) return;
      applyTheme(settings.theme);
      applyThemeTokens(settings.theme);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [settings?.theme]);

  useEffect(() => {
    const reconnect = () => {
      setWsEpoch((cur) => cur + 1);
      refreshSnapshot().catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reconnect();
    };

    window.addEventListener('online', reconnect);
    window.addEventListener('pageshow', reconnect);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('online', reconnect);
      window.removeEventListener('pageshow', reconnect);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshSnapshot]);

  useEffect(() => {
    const ws = new Ws();
    const offMessage = ws.on((msg: WsMessage) => {
      if (msg.type === 'snapshot' && 'data' in msg && msg.data) {
        setSnapshot((cur) => ({ ...(cur ?? ({} as Snapshot)), ...msg.data }));
      } else if (msg.type === 'change') {
        refreshSnapshot().catch(() => undefined);
      } else if (msg.type === 'tasks:change') {
        const nextTask = msg.task;
        setSnapshot((cur) => {
          if (!cur) return cur;
          const tasks = (cur.tasks || []).map((task) => (task.id === nextTask.id ? nextTask : task));
          const exists = tasks.some((task) => task.id === nextTask.id);
          return { ...cur, tasks: exists ? tasks : [nextTask, ...tasks] };
        });
      } else if (msg.type === 'tasks:delete') {
        setSnapshot((cur) => (
          cur
            ? { ...cur, tasks: (cur.tasks || []).filter((task) => task.id !== msg.id) }
            : cur
        ));
      } else if (msg.type === 'settings:change') {
        if (msg.settings) setSettings(msg.settings);
      } else if (
        msg.type === 'project:change' ||
        msg.type === 'agents:change' ||
        msg.type === 'schedules:change' ||
        msg.type === 'plan:change'
      ) {
        refreshSnapshot().catch(() => undefined);
      } else if (msg.type === 'agent:status' || msg.type === 'agent:restarted') {
        setSnapshot((cur) => {
          if (!cur) return cur;
          const agents = (cur.agents || []).map((agent) => (
            agent.name === msg.agent.name ? msg.agent : agent
          ));
          return { ...cur, agents };
        });
      }
    });

    return () => {
      offMessage();
      ws.close();
    };
  }, [refreshSnapshot, wsEpoch]);

  const handleTabChange = useCallback((id: string) => {
    if (id === 'activity' || id === 'chat' || id === 'tasks' || id === 'settings' || id === 'more') {
      goToTab(id);
    }
  }, [goToTab]);

  const handleNavigate = useCallback((type: string, id: string, meta?: Record<string, unknown> | null) => {
    if (type === 'notification') {
      const target = parseNotificationTarget({
        id: '',
        ts: '',
        severity: 'info',
        message: '',
        source: '',
        link: id || null,
        meta: meta ?? null,
      });
      if (target) {
        pushView(target);
      }
      return;
    }

    if (type === 'task' && id) {
      pushView({ id: 'task-detail', taskId: id });
      return;
    }
    if (type === 'plan' && id) {
      pushView({ id: 'plan-detail', slug: id });
      return;
    }
    if (type === 'agent' && id) {
      pushView({ id: 'agent-detail', name: id });
      return;
    }
    if (type === 'project') {
      goToTab('activity');
      return;
    }
    if (type === 'setting') {
      goToTab('settings');
    }
  }, [goToTab, pushView]);

  const renderView = (): React.ReactNode => {
    if (!snapshot || !settings) return null;

    if (stack.length > 0) {
      const stackedView = stack[stack.length - 1];
      switch (stackedView.id) {
        case 'plans':
          return <MobilePlans snapshot={snapshot} onBack={popView} onOpenPlan={(slug) => pushView({ id: 'plan-detail', slug })} />;
        case 'agents':
          return <MobileAgents snapshot={snapshot} onBack={popView} onOpenAgent={(name) => pushView({ id: 'agent-detail', name })} onRefresh={refreshSnapshot} />;
        case 'skills':
          return <MobileSkills snapshot={snapshot} onBack={popView} />;
        case 'mods':
          return <MobileMods snapshot={snapshot} onBack={popView} />;
        case 'schedules':
          return <MobileSchedules snapshot={snapshot} onBack={popView} />;
        case 'history':
          return <MobileHistory onBack={popView} />;
        case 'config':
          return <MobileConfig onBack={popView} />;
        case 'plan-detail':
          return <MobilePlanCanvas slug={stackedView.slug} onBack={popView} />;
        case 'agent-detail':
          return (
            <MobileAgents
              snapshot={snapshot}
              onBack={popView}
              onOpenAgent={() => undefined}
              onRefresh={refreshSnapshot}
              selectedAgent={stackedView.name}
            />
          );
        case 'task-detail':
          return (
            <MobileTasks
              snapshot={snapshot}
              onRefresh={refreshSnapshot}
              selectedTaskId={stackedView.taskId}
              onCloseDetail={popView}
              onOpenChat={(taskId) => {
                setPendingChatTaskId(taskId);
                goToTab('chat');
              }}
            />
          );
        default:
          return null;
      }
    }

    switch (activeTab) {
      case 'activity':
        return <MobileActivity snapshot={snapshot} onRefresh={refreshSnapshot} />;
      case 'chat':
        return (
          <MobileChat
            snapshot={snapshot}
            settings={settings}
            initialTaskId={pendingChatTaskId}
            onClearTaskId={() => setPendingChatTaskId(null)}
          />
        );
      case 'tasks':
        return (
          <MobileTasks
            snapshot={snapshot}
            onRefresh={refreshSnapshot}
            onOpenChat={(taskId) => {
              setPendingChatTaskId(taskId);
              goToTab('chat');
            }}
          />
        );
      case 'settings':
        return <MobileSettings settings={settings} snapshot={snapshot} onRefresh={refreshSnapshot} />;
      case 'more':
        return (
          <MobileMore
            snapshot={snapshot}
            onNavigate={(id) => {
              if (id === 'plans' || id === 'agents' || id === 'skills' || id === 'mods' || id === 'schedules' || id === 'history' || id === 'config') {
                pushView({ id });
              }
            }}
          />
        );
      default:
        return null;
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

  if (bootError || !snapshot || !settings) {
    return (
      <div className="mobile-loading">
        <h2>Dashboard unavailable</h2>
        <p>{bootError || 'Dashboard server unreachable.'}</p>
        <p className="muted">Make sure the Bizar dashboard server is running.</p>
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <MobileTopbar
        activeTab={currentView.id}
        snapshot={snapshot}
        onSearch={() => setSearchOpen(true)}
        onNavigate={handleNavigate}
      />

      <main className="mobile-content">{renderView()}</main>

      {stack.length === 0 && (
        <MobileBottomNav tabs={MAIN_TABS} activeTab={activeTab} onChange={handleTabChange} />
      )}

      {stack.length > 0 && (
        <button type="button" className="mobile-back-btn" onClick={popView} aria-label="Go back">
          ← Back
        </button>
      )}

      <MobileSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={handleNavigate} />
    </div>
  );
}
