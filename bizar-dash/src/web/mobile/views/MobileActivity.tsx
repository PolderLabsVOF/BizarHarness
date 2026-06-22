// src/mobile/views/MobileActivity.tsx — enhanced activity with filters, event detail, and snapshot submit hero.
import { useEffect, useState } from 'react';
import { RefreshCw, Bot, Activity as ActivityIcon, Pause, Play, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/utils';
import type { ActivityItem, Snapshot } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';

type Props = {
  snapshot: Snapshot;
  onRefresh: () => Promise<void>;
};

const EVENT_KINDS = ['all', 'tasks', 'agents', 'bg', 'plans', 'mods'] as const;
type EventKind = typeof EVENT_KINDS[number];

const KIND_LABELS: Record<string, string> = {
  all: 'All',
  tasks: 'Tasks',
  agents: 'Agents',
  bg: 'Background',
  plans: 'Plans',
  mods: 'Mods',
};

export function MobileActivity({ snapshot, onRefresh }: Props) {
  const [events, setEvents] = useState<ActivityItem[]>(snapshot.overview?.recentActivity || []);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EventKind>('all');
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<ActivityItem | null>(null);
  const [submitText, setSubmitText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (snapshot.overview?.recentActivity) {
      setEvents(snapshot.overview.recentActivity);
      setLoading(false);
    } else {
      loadEvents();
    }
  }, [snapshot.overview]);

  const loadEvents = async () => {
    try {
      const data = await api.get<Snapshot>('/snapshot');
      setEvents(data.overview?.recentActivity || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  const filtered = filter === 'all' ? events : events.filter((e) => {
    if (filter === 'tasks') return e.kind?.startsWith('task');
    if (filter === 'agents') return e.kind?.startsWith('agent');
    if (filter === 'bg') return e.kind?.includes('bg') || e.kind?.includes('schedule');
    if (filter === 'plans') return e.kind?.includes('plan');
    if (filter === 'mods') return e.kind?.includes('mod');
    return true;
  });

  const agents = snapshot.agents || [];
  const tasks = snapshot.tasks || [];
  const activeTasks = tasks.filter((t) => t.status === 'doing' || t.status === 'queued');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const handleSubmit = async () => {
    if (!submitText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/chat', { message: submitText.trim(), agent: 'odin' });
      setSubmitText('');
      await onRefresh().catch(() => undefined);
      await loadEvents();
    } catch {
      // best-effort
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    await onRefresh().catch(() => undefined);
    await loadEvents();
  };

  return (
    <div className="mobile-view">
      {/* Snapshot Submit Hero */}
      <div className="mobile-submit-hero">
        <textarea
          className="mobile-submit-input"
          placeholder="What needs to be done? Describe a task, bug, or refactor for Odin to plan…"
          value={submitText}
          onChange={(e) => setSubmitText(e.target.value)}
          rows={2}
        />
        <div className="mobile-submit-actions">
          <div className="mobile-submit-chips">
            {['Implement feature', 'Fix bug', 'Refactor', 'Investigate', 'Write tests'].map((chip) => (
              <button
                key={chip}
                type="button"
                className="mobile-submit-chip"
                onClick={() => setSubmitText((cur) => cur ? `${cur} ${chip}` : chip)}
              >
                {chip}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mobile-btn"
            disabled={!submitText.trim() || submitting}
            onClick={handleSubmit}
          >
            <Send size={14} /> Submit to Odin
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mobile-stats">
        <div className="mobile-stat">
          <div className="mobile-stat-value">{agents.length}</div>
          <div className="mobile-stat-label">Agents</div>
        </div>
        <div className="mobile-stat">
          <div className="mobile-stat-value">{activeTasks.length}</div>
          <div className="mobile-stat-label">Active</div>
        </div>
        <div className="mobile-stat">
          <div className="mobile-stat-value">{doneTasks.length}</div>
          <div className="mobile-stat-label">Done</div>
        </div>
        <div className="mobile-stat">
          <div className="mobile-stat-value">{snapshot.plans?.length || 0}</div>
          <div className="mobile-stat-label">Plans</div>
        </div>
      </div>

      {loading && events.length === 0 && (
        <div className="mobile-loading mobile-loading-inline">
          <p>Loading activity…</p>
        </div>
      )}

      {/* Filter chips */}
      <div className="mobile-activity-header">
        <h3 className="mobile-section-title" style={{ margin: 0 }}>Recent Activity</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="mobile-icon-btn"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button type="button" className="mobile-icon-btn" onClick={handleRefresh} aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="mobile-search-scopes">
        {EVENT_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`mobile-scope-chip ${filter === k ? 'active' : ''}`}
            onClick={() => setFilter(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Active agents */}
      {agents.length > 0 && (
        <section className="mobile-section">
          <h3 className="mobile-section-title"><Bot size={14} /> Agents</h3>
          <div className="mobile-card-list">
            {agents.slice(0, 6).map((a) => (
              <div key={a.name} className="mobile-agent-card">
                <div className="mobile-agent-dot" data-status={a.status || 'idle'} />
                <div className="mobile-agent-info">
                  <span className="mobile-agent-name">{a.name}</span>
                  <span className="mobile-agent-meta">{a.status || 'idle'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Event feed */}
      {!paused && filtered.length > 0 && (
        <section className="mobile-section">
          <div className="mobile-card-list">
            {filtered.slice(0, 30).map((e, i) => (
              <button
                key={`${e.ts}-${e.kind}-${i}`}
                type="button"
                className="mobile-event-item"
                onClick={() => setDetail(e)}
              >
                <span className="mobile-event-kind" data-kind={e.kind}>{KIND_LABELS[e.kind as keyof typeof KIND_LABELS] || e.kind}</span>
                <span className="mobile-event-msg">
                  {renderEventMessage(e)}
                </span>
                <span className="mobile-event-time">{formatRelative(e.ts)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!paused && filtered.length === 0 && events.length > 0 && (
        <div className="mobile-empty">
          <ActivityIcon size={40} />
          <p>No matching activity.</p>
          <p className="muted">Try a different filter.</p>
        </div>
      )}

      {/* Event detail sheet */}
      {detail && (
        <MobileBottomSheet
          open={true}
          onClose={() => setDetail(null)}
          title={KIND_LABELS[detail.kind as keyof typeof KIND_LABELS] || detail.kind}
        >
          <div className="mobile-agent-detail-meta">
            <div className="mobile-task-detail-row"><span>Kind</span><span>{detail.kind}</span></div>
            <div className="mobile-task-detail-row"><span>Time</span><span>{new Date(detail.ts).toLocaleString()}</span></div>
            {Object.entries(detail)
              .filter(([k]) => !['ts', 'kind'].includes(k))
              .map(([k, v]) => (
                <div key={k} className="mobile-task-detail-row">
                  <span>{k}</span>
                  <span style={{ fontSize: 12, maxWidth: 200, wordBreak: 'break-all' }}>
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
          </div>
        </MobileBottomSheet>
      )}

      {/* Empty state */}
      {agents.length === 0 && activeTasks.length === 0 && (
        <div className="mobile-empty">
          <ActivityIcon size={40} />
          <p>No activity yet.</p>
          <p className="muted">Start a task or chat to see things here.</p>
        </div>
      )}
    </div>
  );
}

function renderEventMessage(e: ActivityItem): string {
  const k = e.kind || '';
  if (k.includes('task')) return `Task: ${e.title || e.id || 'updated'}`;
  if (k.includes('agent')) return `Agent: ${e.name || 'status changed'}`;
  if (k.includes('plan')) return `Plan: ${e.slug || 'changed'}`;
  if (k.includes('mod')) return `Mod: ${e.name || 'changed'}`;
  if (k.includes('schedule')) return `Schedule: ${e.name || 'triggered'}`;
  return JSON.stringify(e).slice(0, 80);
}
