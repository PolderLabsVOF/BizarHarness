// src/views/Overview.tsx — system overview: counts, activity, quick actions.
import { useEffect, useState } from 'react';
import {
  Bot,
  CheckSquare,
  Folder,
  LayoutDashboard,
  Map,
  MessageSquare,
  RefreshCw,
  PlayCircle,
  ShieldCheck,
  FileText,
  Zap,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { formatRelative, formatTime } from '../lib/utils';
import type { Overview, Settings, Snapshot, ActivityItem } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type StatCard = {
  key: keyof Overview['counts'];
  label: string;
  Icon: typeof Bot;
  tab: string;
};

const STATS: StatCard[] = [
  { key: 'agents', label: 'Agents', Icon: Bot, tab: 'agents' },
  { key: 'plans', label: 'Plans', Icon: Map, tab: 'plans' },
  { key: 'projects', label: 'Projects', Icon: Folder, tab: 'projects' },
  { key: 'sessions', label: 'Sessions', Icon: MessageSquare, tab: 'chat' },
];

export function Overview({
  snapshot,
  setActiveTab,
  refreshSnapshot,
}: Props) {
  const toast = useToast();
  const modal = useModal();
  const [overview, setOverview] = useState<Overview | null>(
    snapshot.overview ?? null,
  );
  const [loading, setLoading] = useState(!snapshot.overview);

  useEffect(() => {
    if (snapshot.overview) {
      setOverview(snapshot.overview);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<Overview>('/overview')
      .then((o) => {
        if (!cancelled) {
          setOverview(o);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          toast.error(`Could not load overview: ${err.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.overview, toast]);

  const onRefresh = async () => {
    toast.info('Refreshing…', 1500);
    await refreshSnapshot();
  };

  const onAudit = () => {
    modal.open({
      title: 'Run audit',
      children: (
        <div>
          <p>
            The full security audit runs in the opencode TUI for proper
            reporting and exit codes.
          </p>
          <p>Run this in your terminal:</p>
          <pre className="code-block">
            <code>bizar audit</code>
          </pre>
        </div>
      ),
      footer: (
        <Button variant="primary" onClick={() => modal.close()}>
          Got it
        </Button>
      ),
    });
  };

  if (loading || !overview) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading overview…</p>
      </div>
    );
  }

  return (
    <div className="view view-overview">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <LayoutDashboard size={18} />
            System Overview
          </h2>
          <p className="view-subtitle">
            Live snapshot of agents, plans, projects, and recent activity.
          </p>
        </div>
      </header>

      <section className="stat-grid">
        {STATS.map((s) => {
          const Icon = s.Icon;
          return (
            <Card
              key={s.key}
              variant="elevated"
              interactive
              className="stat-card"
              onClick={() => setActiveTab(s.tab)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveTab(s.tab);
                }
              }}
            >
              <div className="stat-card-icon">
                <Icon size={20} />
              </div>
              <div className="stat-card-body">
                <div className="stat-card-value tabular-nums">
                  {overview.counts[s.key]}
                </div>
                <div className="stat-card-label">{s.label}</div>
              </div>
              <div className="stat-card-arrow">→</div>
            </Card>
          );
        })}
      </section>

      <Card className="quick-actions">
        <CardTitle>Quick actions</CardTitle>
        <CardMeta>Jump straight to common workflows.</CardMeta>
        <div className="quick-actions-row">
          <Button
            variant="secondary"
            onClick={() => setActiveTab('chat')}
            iconOnly={false}
          >
            <MessageSquare size={14} /> New chat
          </Button>
          <Button variant="secondary" onClick={() => setActiveTab('plans')}>
            <Map size={14} /> New plan
          </Button>
          <Button variant="secondary" onClick={() => setActiveTab('tasks')}>
            <CheckSquare size={14} /> Add task
          </Button>
          <Button variant="secondary" onClick={() => setActiveTab('projects')}>
            <Folder size={14} /> Switch project
          </Button>
          <Button variant="secondary" onClick={onAudit}>
            <ShieldCheck size={14} /> Run audit
          </Button>
          <Button variant="primary" onClick={onRefresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </Card>

      <div className="overview-cols">
        <Card>
          <CardTitle>
            <Zap size={14} /> Recent activity
          </CardTitle>
          <CardMeta>Last 30 events from .bizar/activity.log</CardMeta>
          {overview.recentActivity.length === 0 ? (
            <EmptyState
              icon={<FileText size={28} />}
              title="No activity yet"
              message="Use the chat or invoke a Bizar command to start a feed."
            />
          ) : (
            <ul className="activity-list">
              {overview.recentActivity.slice(0, 30).map((it, idx) => (
                <li key={idx} className="activity-item">
                  <span className="activity-ts tabular-nums">
                    {formatRelative(it.ts)}
                  </span>
                  <span className="activity-kind">{it.kind}</span>
                  <span className="activity-msg">{formatActivity(it)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Environment</CardTitle>
          <CardMeta>Runtime + paths</CardMeta>
          <dl className="env-table">
            <dt>Node</dt>
            <dd className="mono">{overview.versions.node}</dd>
            <dt>Platform</dt>
            <dd className="mono">{overview.versions.platform}</dd>
            <dt>Project root</dt>
            <dd className="mono ellipsis" title={overview.versions.projectRoot}>
              {overview.versions.projectRoot}
            </dd>
            <dt>Bizar root</dt>
            <dd className="mono ellipsis" title={overview.versions.bizarRoot}>
              {overview.versions.bizarRoot}
            </dd>
            <dt>Generated</dt>
            <dd className="mono tabular-nums">
              {formatTime(overview.generatedAt)}
            </dd>
          </dl>
        </Card>
      </div>

      <div className="overview-footer">
        <PlayCircle size={14} /> Dashboard built {formatTime(overview.generatedAt)}
      </div>
    </div>
  );
}

function formatActivity(it: ActivityItem): string {
  if (typeof it.message === 'string') return it.message;
  if (typeof it.prompt === 'string') return it.prompt;
  if (typeof it.slug === 'string') {
    const title = typeof it.title === 'string' ? ` title=${it.title}` : '';
    return `slug=${it.slug}${title}`;
  }
  if (typeof it.name === 'string') return `name=${it.name}`;
  return JSON.stringify(it);
}
