// src/web/views/Timeline.tsx — v6.6.0 F-042
//
// Cross-cutting history view. Aggregates every "what changed, where,
// when" event (git commits, hook logs, agent activity, task changes,
// goal changes, file events) into a single chronological feed with a
// filter bar at the top and a date-grouped list below.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Filter,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { TimelineEvent } from '../components/timeline/TimelineEvent';
import { EmptyState } from '../components/EmptyState';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { cn } from '../lib/utils';
import { Ws } from '../lib/ws';
import type {
  ProjectRecord,
  Settings,
  Snapshot,
  TimelineEvent as TimelineEventT,
} from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const ALL_TYPES = ['commit', 'hook', 'agent', 'task', 'goal', 'file'] as const;

type Group = {
  label: string;
  startTs: number;
  events: TimelineEventT[];
};

function groupByDate(events: TimelineEventT[]): Group[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const today: TimelineEventT[] = [];
  const yesterday: TimelineEventT[] = [];
  const week: TimelineEventT[] = [];
  const earlier: TimelineEventT[] = [];

  for (const e of events) {
    const t = new Date(e.ts).getTime();
    if (!Number.isFinite(t)) {
      earlier.push(e);
      continue;
    }
    if (t >= startOfToday) today.push(e);
    else if (t >= startOfYesterday) yesterday.push(e);
    else if (t >= startOfWeek) week.push(e);
    else earlier.push(e);
  }
  const out: Group[] = [];
  if (today.length) out.push({ label: 'Today', startTs: startOfToday, events: today });
  if (yesterday.length) out.push({ label: 'Yesterday', startTs: startOfYesterday, events: yesterday });
  if (week.length) out.push({ label: 'This week', startTs: startOfWeek, events: week });
  if (earlier.length) out.push({ label: 'Earlier', startTs: 0, events: earlier });
  return out;
}

export function Timeline(props: Props): React.ReactNode {
  const toast = useToast();
  const [events, setEvents] = useState<TimelineEventT[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(ALL_TYPES));
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string | 'all'>('all');
  const [agentContext, setAgentContext] = useState<string | null>(null);

  const activeProject: ProjectRecord | null = props.snapshot?.activeProject || null;
  const projects: ProjectRecord[] = props.snapshot?.projects || [];

  const fetchEvents = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (projectFilter !== 'all') params.set('projectId', projectFilter);
      if (typeFilter.size && typeFilter.size < ALL_TYPES.length) {
        params.set('type', Array.from(typeFilter).join(','));
      }
      if (search.trim()) params.set('text', search.trim());
      const r = await api.get<{ events: TimelineEventT[]; total: number }>(
        `/timeline?${params.toString()}`,
      );
      setEvents(r.events || []);
    } catch (err) {
      toast.error(`Timeline load failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [toast, projectFilter, typeFilter, search]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Live updates via WS — append timeline:event into the local list.
  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { type?: string; event?: TimelineEventT };
      if (m.type === 'timeline:event' && m.event) {
        setEvents((cur) => {
          if (!cur) return [m.event as TimelineEventT];
          // Dedupe by id (WS may repeat the same event during reconnect).
          if (cur.some((e) => e.id === m.event!.id)) return cur;
          return [m.event as TimelineEventT, ...cur].slice(0, 500);
        });
      }
    });
    return () => { off(); ws.close(); };
  }, []);

  const toggleType = useCallback((t: string) => {
    setTypeFilter((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const onEventClick = useCallback((evt: TimelineEventT) => {
    const r = evt.refs || {};
    if (r.taskId) props.setActiveTab('tasks');
    else if (r.goalId) props.setActiveTab('goals');
    else if (r.agentName) props.setActiveTab('agents');
    else if (evt.type === 'commit') props.setActiveTab('history');
  }, [props.setActiveTab]);

  const onAiSummary = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get<{ text: string }>('/timeline/agent-context');
      setAgentContext(r.text);
    } catch (err) {
      toast.error(`AI summary failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const groups = useMemo(() => groupByDate(events || []), [events]);

  return (
    <div className="view-timeline" data-testid="view-timeline">
      <Card className="timeline-filters">
        <div className="timeline-filters-row">
          <CardTitle>
            <Activity size={14} aria-hidden /> Timeline
          </CardTitle>
          <CardMeta>
            {events ? `${events.length} events` : 'Loading…'}
            {activeProject ? ` · ${activeProject.name}` : ''}
          </CardMeta>
          <div className="timeline-filters-spacer" />
          <Button variant="secondary" size="sm" onClick={onAiSummary} disabled={busy}>
            <Sparkles size={12} /> AI summary
          </Button>
          <Button variant="ghost" size="sm" onClick={fetchEvents} disabled={busy}>
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>
        <div className="timeline-filters-row">
          <label className="timeline-filter-label" htmlFor="timeline-project">Project</label>
          <select
            id="timeline-project"
            className="input mono"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label className="timeline-filter-label" htmlFor="timeline-search">Search</label>
          <input
            id="timeline-search"
            className="input"
            type="text"
            placeholder="summary or detail text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="timeline-filters-row">
          <Filter size={12} aria-hidden />
          <span className="muted">Type:</span>
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={cn('chip', typeFilter.has(t) && 'chip-active')}
              onClick={() => toggleType(t)}
              data-testid={`timeline-type-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
        {agentContext && (
          <div className="timeline-agent-context" data-testid="timeline-agent-context">
            <div className="timeline-agent-context-head">
              <Sparkles size={12} /> AI summary (≤200 words)
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss"
                onClick={() => setAgentContext(null)}
              >
                <X size={12} />
              </button>
            </div>
            <pre className="timeline-agent-context-body">{agentContext}</pre>
          </div>
        )}
      </Card>

      {busy && !events && (
        <Card><Spinner size="md" /> Loading timeline…</Card>
      )}

      {events && events.length === 0 && (
        <EmptyState
          title="No timeline events yet"
          message="Events appear as the dashboard observes commits, hook logs, agent activity, task / goal changes, and file events."
        />
      )}

      {groups.map((g) => (
        <Card key={g.label} className="timeline-group" data-testid={`timeline-group-${g.label.toLowerCase().replace(/\s+/g, '-')}`}>
          <CardTitle>{g.label}</CardTitle>
          <CardMeta>{g.events.length} events</CardMeta>
          <ul className="timeline-list" data-testid="timeline-list">
            {g.events.map((e) => (
              <TimelineEvent key={e.id} event={e} onClick={onEventClick} showAbsolute={g.label !== 'Today'} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export default Timeline;
