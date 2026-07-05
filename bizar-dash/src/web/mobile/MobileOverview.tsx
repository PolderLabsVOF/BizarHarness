// src/mobile/MobileOverview.tsx — mobile-optimized overview with vertical scrolling
// stat cards, a submit hero, recent activity feed, and quick action shortcuts.
import { useState } from 'react';
import {
  CheckSquare,
  Clock,
  Bot,
  Coins,
  Plus,
  MessageSquare,
  Stethoscope,
  Send,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot | null;
  refreshSnapshot: () => Promise<void>;
};

type StatColor = 'blue' | 'purple' | 'green' | 'yellow';

export function MobileOverview({ snapshot, refreshSnapshot }: Props) {
  const [submitText, setSubmitText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const tasks = snapshot?.tasks || [];
  const schedules = snapshot?.schedules || [];
  const agents = snapshot?.agents || [];
  const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'active').length;

  const handleSubmit = async () => {
    const text = submitText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/chat', { message: text, agent: 'odin' });
      setSubmitText('');
      await refreshSnapshot().catch(() => undefined);
    } catch {
      // best-effort; the input stays so the user can retry
    } finally {
      setSubmitting(false);
    }
  };

  const goToTasks = () => {
    window.dispatchEvent(new CustomEvent('mobile-navigate', { detail: { tab: 'tasks' } }));
  };
  const goToChat = () => {
    window.dispatchEvent(new CustomEvent('mobile-navigate', { detail: { tab: 'chat' } }));
  };
  const runDoctor = () => {
    window.dispatchEvent(new CustomEvent('mobile-navigate', { detail: { view: 'doctor' } }));
  };

  return (
    <div className="mobile-overview mobile-view">
      <HeroCard
        value={submitText}
        onChange={setSubmitText}
        onSubmit={handleSubmit}
        submitting={submitting}
      />

      <div className="mobile-stats-stack">
        <StatCard
          icon={<CheckSquare size={20} />}
          label="Tasks"
          value={tasks.length}
          subtext={`${tasks.filter((t) => t.status === 'doing').length} active`}
          color="blue"
        />
        <StatCard
          icon={<Clock size={20} />}
          label="Schedules"
          value={schedules.length}
          color="purple"
        />
        <StatCard
          icon={<Bot size={20} />}
          label="Active Agents"
          value={activeAgents}
          color="green"
        />
        <StatCard
          icon={<Coins size={20} />}
          label="API Tokens"
          value={'0'}
          subtext="last 24h"
          color="yellow"
        />
      </div>

      <RecentActivityCard snapshot={snapshot} />

      <QuickActionsCard onNewTask={goToTasks} onNewChat={goToChat} onRunDoctor={runDoctor} />
    </div>
  );
}

type HeroCardProps = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  submitting: boolean;
};

function HeroCard({ value, onChange, onSubmit, submitting }: HeroCardProps) {
  return (
    <div className="mobile-hero">
      <h1>What do you want to do?</h1>
      <p>
        Describe what you want — Odin will split it into tasks, create a plan, delegate to
        background agents, and track progress in real time.
      </p>
      <textarea
        placeholder="e.g. Implement user authentication with email + password..."
        className="mobile-hero-input"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="mobile-hero-submit"
        onClick={onSubmit}
        disabled={!value.trim() || submitting}
      >
        {submitting ? 'Submitting…' : (
          <>
            <Send size={14} /> Submit
          </>
        )}
      </button>
    </div>
  );
}

type StatCardProps = {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subtext?: string;
  color: StatColor;
};

function StatCard({ icon, label, value, subtext, color }: StatCardProps) {
  return (
    <div className={`mobile-stat-card is-${color}`}>
      <div className="mobile-stat-icon">{icon}</div>
      <div className="mobile-stat-body">
        <div className="mobile-stat-label">{label}</div>
        <div className="mobile-stat-value">{value}</div>
        {subtext && <div className="mobile-stat-subtext">{subtext}</div>}
      </div>
    </div>
  );
}

function RecentActivityCard({ snapshot }: { snapshot: Snapshot | null }) {
  const items = (snapshot?.overview?.recentActivity || []).slice(0, 8);
  return (
    <div className="mobile-activity-card">
      <h3>Recent Activity</h3>
      {items.length === 0 ? (
        <p className="mobile-empty">No recent activity</p>
      ) : (
        <ul className="mobile-activity-list">
          {items.map((a, i) => {
            const ts = typeof a.ts === 'string' ? a.ts : '';
            const text = (a as Record<string, unknown>).message
              || (a as Record<string, unknown>).text
              || (a as Record<string, unknown>).title
              || a.kind
              || '';
            return (
              <li key={`${ts}-${i}`} className="mobile-activity-item">
                <span className="mobile-activity-time">
                  {ts ? new Date(ts).toLocaleTimeString() : ''}
                </span>
                <span className="mobile-activity-text">{String(text)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type QuickActionsCardProps = {
  onNewTask: () => void;
  onNewChat: () => void;
  onRunDoctor: () => void;
};

function QuickActionsCard({ onNewTask, onNewChat, onRunDoctor }: QuickActionsCardProps) {
  return (
    <div className="mobile-quick-actions">
      <button type="button" className="mobile-quick-action" onClick={onNewTask}>
        <Plus size={16} /> New task
      </button>
      <button type="button" className="mobile-quick-action" onClick={onNewChat}>
        <MessageSquare size={16} /> New chat
      </button>
      <button type="button" className="mobile-quick-action" onClick={onRunDoctor}>
        <Stethoscope size={16} /> Run doctor
      </button>
    </div>
  );
}