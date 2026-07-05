// src/views/History.tsx — v3.4.0: cross-project history view.
// Shows per-project timelines (task events, plan events, project lifecycle)
// aggregated from the activity log.

import React, { useEffect, useState } from 'react';
import {
  History as HistoryIcon,
  RefreshCw,
  Folder,
  CheckSquare,
  Filter,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { VirtualList } from '../components/VirtualList';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, formatRelative } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type HistoryEvent = {
  ts: string;
  kind: string;
  nodeId?: string;
  text?: string;
  author?: string;
  taskId?: string;
  [k: string]: unknown;
};

type ProjectHistory = {
  id: string;
  name: string;
  path: string;
  status: string;
  lastAccessed?: string | null;
  tasks: { total: number; done: number; doing: number; blocked: number; queued: number };
  plans: number;
};

type HistoryResponse = {
  events: HistoryEvent[];
  projects: ProjectHistory[];
  stats: { file: string; size: number; lines: number; lastTs: string | null; counts: Record<string, number> };
  generatedAt: string;
};

const TIME_RANGES = [
  { id: '1h', label: 'Last hour', ms: 60 * 60 * 1000 },
  { id: '1d', label: 'Last day', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All time', ms: 0 },
];

function renderProjectCard(
  p: ProjectHistory,
  events: HistoryEvent[],
  expanded: Set<string>,
  toggleProject: (id: string) => void,
): React.ReactNode {
  const isOpen = expanded.has(p.id);
  return (
    <Card key={p.id} className="history-project" style={{ marginBottom: 4 }}>
      <div className="history-project-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
          <div className="history-project-name">
            <Folder size={16} /> {p.name}
          </div>
          <div className="history-project-meta">{p.path}</div>
        </div>
        <div className="history-project-stats">
          <span className="history-project-stat">
            <span className="history-project-stat-num">{p.tasks.done}</span>
            <span className="muted">/ {p.tasks.total} done</span>
          </span>
          {p.tasks.doing > 0 && (
            <span className="history-project-stat">
              <span className="history-project-stat-num">{p.tasks.doing}</span>
              <span className="muted">doing</span>
            </span>
          )}
          {p.tasks.blocked > 0 && (
            <span className="history-project-stat">
              <span className="history-project-stat-num">{p.tasks.blocked}</span>
              <span className="muted">blocked</span>
            </span>
          )}
          <span className="history-project-stat">
            <FileText size={11} /> <span className="history-project-stat-num">{p.plans}</span>
            <span className="muted"> plan{p.plans === 1 ? '' : 's'}</span>
          </span>
          {p.lastAccessed && (
            <span className="history-project-stat">
              <span className="muted">last opened {formatRelative(p.lastAccessed)}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => toggleProject(p.id)}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {isOpen && (
        <div className="history-timeline-mini">
          {events.length === 0 ? (
            <div className="muted" style={{ padding: '12px 8px', fontSize: 12 }}>
              No events in this time range.
            </div>
          ) : (
            events.slice(-100).reverse().map((ev, i) => (
              <div key={i} className="history-timeline-row">
                <span className="history-timeline-ts">
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
                <span className="history-timeline-kind">{ev.kind || 'event'}</span>
                <span className="history-timeline-msg" title={String(ev.text || ev.title || '')}>
                  {ev.author ? `@${ev.author} ` : ''}
                  {String(ev.text ?? ev.title ?? ev.name ?? '')}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

export function History({ snapshot }: Props) {
  const toast = useToast();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeId, setRangeId] = useState<string>('1d');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  const load = async (since?: string) => {
    try {
      const q = since ? `?since=${encodeURIComponent(since)}&limit=1000` : '?limit=1000';
      const r = await api.get<HistoryResponse>(`/history${q}`);
      setData(r);
      setExpanded(
        new Set(
          r.projects
            .filter((project) => r.events.some((ev) => (ev as { projectId?: string }).projectId === project.id))
            .map((project) => project.id),
        ),
      );
    } catch (err) {
      toast.error(`History load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const range = TIME_RANGES.find((r) => r.id === rangeId) || TIME_RANGES[1];
    if (range.ms > 0) {
      const since = new Date(Date.now() - range.ms).toISOString();
      load(since);
    } else {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeId]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Group events by project — use projectId where present, otherwise 'global'
  const eventsByProject = new Map<string, HistoryEvent[]>();
  for (const ev of data?.events || []) {
    const pid = (ev as { projectId?: string }).projectId || 'global';
    if (!eventsByProject.has(pid)) eventsByProject.set(pid, []);
    eventsByProject.get(pid)!.push(ev);
  }

  const toggleProject = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onExportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bizar-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('History exported.');
  };

  return (
    <div className="view view-history" data-tick={tick}>
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <HistoryIcon size={18} /> History
          </h2>
          <p className="view-subtitle">
            Cross-project history of events, tasks, and plans.
            {data?.stats?.lastTs && (
              <> · last event {formatRelative(data.stats.lastTs)}</>
            )}
          </p>
        </div>
        <div className="view-actions">
          <div className="tasks-toolbar-group">
            <Filter size={14} style={{ color: 'var(--text-dim)' }} />
            <select
              className="select select-sm"
              value={rangeId}
              onChange={(e) => setRangeId(e.target.value)}
              title="Time range"
            >
              {TIME_RANGES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              const range = TIME_RANGES.find((r) => r.id === rangeId) || TIME_RANGES[1];
              if (range.ms > 0) {
                load(new Date(Date.now() - range.ms).toISOString());
              } else {
                load();
              }
            }}
          >
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={onExportJson}>
            <Download size={14} /> Export
          </Button>
        </div>
      </header>

      {loading && (
        <div className="view-loading">
          <Spinner size="lg" />
          <p>Loading history…</p>
        </div>
      )}

      {!loading && data && (
        <div className="history-list">
          {data.projects.length === 0 && (
            <Card>
              <CardTitle><Folder size={14} /> No projects</CardTitle>
              <CardMeta>Register a project in Overview to start tracking history.</CardMeta>
            </Card>
          )}

          {data.projects.length > 0 && (
            <VirtualList
              items={data.projects}
              itemHeight={70}
              height={Math.min(data.projects.length * 70, 500)}
              className="history-virtual-list"
              renderItem={(p) => renderProjectCard(p, eventsByProject.get(p.id) || [], expanded, toggleProject)}
            />
          )}

          {/* Global / unassigned events */}
          {eventsByProject.has('global') && (
            <Card className="history-project">
              <div className="history-project-head">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                  <div className="history-project-name">
                    <HistoryIcon size={16} /> Global events
                  </div>
                  <div className="history-project-meta">
                    Activity not tied to a specific project
                  </div>
                </div>
              </div>
              <div className="history-timeline-mini">
                {(eventsByProject.get('global') || []).slice(-100).reverse().map((ev, i) => (
                  <div key={i} className="history-timeline-row">
                    <span className="history-timeline-ts">
                      {new Date(ev.ts).toLocaleTimeString()}
                    </span>
                    <span className="history-timeline-kind">{ev.kind || 'event'}</span>
                    <span className="history-timeline-msg" title={String(ev.text || ev.title || '')}>
                      {ev.author ? `@${ev.author} ` : ''}
                      {String(ev.text ?? ev.title ?? ev.name ?? '')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data.stats?.counts && Object.keys(data.stats.counts).length > 0 && (
            <Card>
              <CardTitle>Event counts by kind</CardTitle>
              <CardMeta>{data.stats.lines} total lines in log</CardMeta>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {Object.entries(data.stats.counts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 30)
                  .map(([kind, count]) => (
                    <span
                      key={kind}
                      className={cn('tag', 'tag-neutral')}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {kind}: {count}
                    </span>
                  ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
