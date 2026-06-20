// src/mobile/MobileApp.tsx — mobile root with state-based routing + stack navigation.
import { useCallback, useEffect, useState } from 'react';
import { Activity, MessageSquare, CheckSquare, Settings, Grid } from 'lucide-react';
import { api } from '../lib/api';
import type { Snapshot, Settings as SettingsType } from '../lib/types';
import { MobileTopbar } from './MobileTopbar';
import { MobileBottomNav, type MobileTab } from './MobileBottomNav';
import { MobileSearchModal } from './views/MobileSearchModal';
import { MobileNotifications } from './views/MobileNotifications';
import { MobileActivity } from './views/MobileActivity';
import { MobileChat } from './views/MobileChat';
import { MobileTasks } from './views/MobileTasks';
import { MobileSettings } from './views/MobileSettings';
import { MobileMore } from './views/MobileMore';
import { MobilePlans } from './views/MobilePlans';
import { MobileAgents } from './views/MobileAgents';
import { MobileSkills } from './views/MobileSkills';
import { MobileMods } from './views/MobileMods';
import { MobileSchedules } from './views/MobileSchedules';
import { MobileHistory } from './views/MobileHistory';
import { MobileConfig } from './views/MobileConfig';

export type MobileView =
  | { id: 'activity' }
  | { id: 'chat' }
  | { id: 'tasks' }
  | { id: 'settings' }
  | { id: 'more' }
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

const TABS: MobileTab[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'more', label: 'More', icon: Grid },
];

export function MobileApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [activeTab, setActiveTab] = useState('activity');
  const [stack, setStack] = useState<MobileView[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  // v3.6.2 — Pipeline: pending taskId to open in chat when switching tabs.
  const [pendingChatTaskId, setPendingChatTaskId] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    try {
      const data = await api.get<Snapshot>('/snapshot');
      setSnapshot(data);
      if (data.settings) setSettings(data.settings.data);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    refreshSnapshot().finally(() => setLoading(false));
    // Poll every 10s
    const t = setInterval(refreshSnapshot, 10000);
    return () => clearInterval(t);
  }, [refreshSnapshot]);

  // WebSocket for live updates
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'refresh' || msg.type === 'snapshot') {
          refreshSnapshot();
        }
      } catch {
        // ignore
      }
    };
    ws.onerror = () => ws.close();
    return () => ws.close();
  }, [refreshSnapshot]);

  const push = (view: MobileView) => setStack((s) => [...s, view]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const goToTab = (id: string) => {
    setStack([]);
    setActiveTab(id);
  };

  const handleNavigate = (type: string, id: string) => {
    switch (type) {
      case 'task': push({ id: 'task-detail', taskId: id }); break;
      case 'plan': push({ id: 'plan-detail', slug: id }); break;
      case 'agent': push({ id: 'agent-detail', name: id }); break;
      default: break;
    }
  };

  // v3.6.2 — Switch to chat tab and signal a task session to load.
  const onOpenChat = (taskId: string) => {
    setPendingChatTaskId(taskId);
    goToTab('chat');
  };

  const currentView = stack.length > 0 ? stack[stack.length - 1] : { id: activeTab };

  const renderView = () => {
    // If we have a stack view, render it; otherwise render the tab
    if (stack.length > 0) {
      switch (stack[stack.length - 1].id) {
        case 'plans': return (
          <MobilePlans
            snapshot={snapshot!}
            onBack={pop}
            onOpenPlan={(slug) => push({ id: 'plan-detail', slug })}
          />
        );
        case 'agents': return (
          <MobileAgents
            snapshot={snapshot!}
            onBack={pop}
            onOpenAgent={(name) => push({ id: 'agent-detail', name })}
          />
        );
        case 'skills': return (
          <MobileSkills snapshot={snapshot!} onBack={pop} />
        );
        case 'mods': return (
          <MobileMods snapshot={snapshot!} onBack={pop} />
        );
        case 'schedules': return (
          <MobileSchedules snapshot={snapshot!} onBack={pop} />
        );
        case 'history': return (
          <MobileHistory onBack={pop} />
        );
        case 'config': return (
          <MobileConfig onBack={pop} />
        );
        case 'plan-detail': return (
          <PlanDetailView
            slug={(stack[stack.length - 1] as { id: 'plan-detail'; slug: string }).slug}
            snapshot={snapshot!}
            onBack={pop}
          />
        );
        case 'agent-detail': return (
          <AgentDetailView
            name={(stack[stack.length - 1] as { id: 'agent-detail'; name: string }).name}
            snapshot={snapshot!}
            onBack={pop}
            onRefresh={refreshSnapshot}
          />
        );
        case 'task-detail': return (
          <TaskDetailView
            taskId={(stack[stack.length - 1] as { id: 'task-detail'; taskId: string }).taskId}
            snapshot={snapshot!}
            onBack={pop}
            onRefresh={refreshSnapshot}
          />
        );
        default:
          return null;
      }
    }

    switch (activeTab) {
      case 'activity': return <MobileActivity snapshot={snapshot!} onRefresh={refreshSnapshot} />;
      case 'chat': return <MobileChat snapshot={snapshot!} settings={settings!} initialTaskId={pendingChatTaskId} onClearTaskId={() => setPendingChatTaskId(null)} />;
      case 'tasks': return <MobileTasks snapshot={snapshot!} onRefresh={refreshSnapshot} onOpenChat={onOpenChat} />;
      case 'settings': return <MobileSettings settings={settings!} snapshot={snapshot} onRefresh={refreshSnapshot} />;
      case 'more': return (
        <MobileMore
          snapshot={snapshot!}
          onNavigate={(id) => {
            if (['plans', 'agents', 'skills', 'mods', 'schedules', 'history', 'config'].includes(id)) {
              push({ id: id as MobileView['id'] } as MobileView);
            }
          }}
        />
      );
      default: return null;
    }
  };

  if (loading || !snapshot) {
    return (
      <div className="mobile-loading">
        <p>Loading…</p>
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

      <main className="mobile-content">
        {renderView()}
      </main>

      {/* Bottom nav only on main tabs */}
      {stack.length === 0 && (
        <MobileBottomNav
          tabs={TABS}
          activeTab={activeTab}
          onChange={(id) => goToTab(id)}
        />
      )}

      {/* Back button when on stack */}
      {stack.length > 0 && (
        <button
          type="button"
          className="mobile-back-btn"
          onClick={pop}
          aria-label="Go back"
        >
          ← Back
        </button>
      )}

      <MobileSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleNavigate}
      />
    </div>
  );
}

// ── Inline detail views ─────────────────────────────────────────────────────

function PlanDetailView({ slug, snapshot, onBack }: { slug: string; snapshot: Snapshot; onBack: () => void }) {
  const { MobilePlanCanvas } = require('./views/MobilePlanCanvas');
  return <MobilePlanCanvas slug={slug} onBack={onBack} />;
}

function AgentDetailView({ name, snapshot, onBack, onRefresh }: { name: string; snapshot: Snapshot; onBack: () => void; onRefresh: () => void }) {
  const { MobileAgents } = require('./views/MobileAgents');
  return (
    <MobileAgents
      snapshot={snapshot}
      onBack={onBack}
      onOpenAgent={() => {}}
      selectedAgent={name}
      onRefresh={onRefresh}
    />
  );
}

function TaskDetailView({ taskId, snapshot, onBack, onRefresh }: { taskId: string; snapshot: Snapshot; onBack: () => void; onRefresh: () => void }) {
  const { MobileTasks } = require('./views/MobileTasks');
  return (
    <MobileTasks
      snapshot={snapshot}
      onRefresh={onRefresh}
      selectedTaskId={taskId}
      onCloseDetail={onBack}
    />
  );
}
