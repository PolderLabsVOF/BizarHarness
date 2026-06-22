// src/mobile/views/MobileHistory.tsx — session history list.
import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { MobileBottomSheet } from '../components/MobileBottomSheet';

type HistoryEntry = {
  id: string;
  ts: string;
  duration?: number;
  agent?: string;
  taskCount?: number;
  summary?: string;
  output?: string;
};

type HistoryEvent = {
  ts: string;
  kind: string;
  text?: string;
  projectId?: string;
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
  history?: HistoryEntry[];
  events?: HistoryEvent[];
  projects?: ProjectHistory[];
};

type Props = {
  onBack: () => void;
};

export function MobileHistory({ onBack }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<HistoryEntry | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    try {
      const data = await api.get<HistoryResponse>('/history');
      if (Array.isArray(data.history)) {
        setEntries(data.history);
        return;
      }

      if (Array.isArray(data.projects)) {
        const latestEventByProject = new Map<string, HistoryEvent>();
        for (const event of data.events || []) {
          const pid = event.projectId;
          if (!pid) continue;
          const current = latestEventByProject.get(pid);
          if (!current || new Date(event.ts).getTime() > new Date(current.ts).getTime()) {
            latestEventByProject.set(pid, event);
          }
        }

        setEntries(
          data.projects.map((project) => {
            const latestEvent = latestEventByProject.get(project.id);
            return {
              id: project.id,
              ts: project.lastAccessed || latestEvent?.ts || new Date(0).toISOString(),
              agent: project.name,
              taskCount: project.tasks.total,
              summary: `${project.path} · ${project.tasks.done}/${project.tasks.total} done · ${project.plans} plan${project.plans === 1 ? '' : 's'}`,
              output: latestEvent ? `${latestEvent.kind}${latestEvent.text ? ` — ${latestEvent.text}` : ''}` : 'No recent events.',
            } satisfies HistoryEntry;
          }),
        );
        return;
      }

      setEntries([]);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const formatDuration = (ms?: number): string => {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  };

  const formatTime = (ts: string): string => {
    const d = new Date(ts);
    return d.toLocaleString();
  };

  const filtered = query.trim()
    ? entries.filter((entry) => {
        const q = query.toLowerCase();
        return (entry.agent || 'session').toLowerCase().includes(q)
          || (entry.summary || '').toLowerCase().includes(q)
          || (entry.output || '').toLowerCase().includes(q);
      })
    : entries;

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search history…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => load()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <History size={40} />
          <p>{entries.length === 0 ? 'No history yet.' : 'No matching sessions.'}</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map((e) => (
            <button
              key={e.id}
              type="button"
              className="mobile-list-item mobile-list-item-interactive"
              onClick={() => setDetail(e)}
            >
              <div className="mobile-list-icon"><History size={16} /></div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{e.agent || 'Session'}</span>
                <span className="mobile-list-meta">
                  {formatTime(e.ts)}
                  {e.duration ? ` · ${formatDuration(e.duration)}` : ''}
                  {e.taskCount ? ` · ${e.taskCount} tasks` : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail sheet */}
      {detail && (
        <MobileBottomSheet open={true} onClose={() => setDetail(null)} title="Session Detail">
          <div className="mobile-agent-detail-meta">
            <div className="mobile-task-detail-row"><span>Agent</span><span>{detail.agent || '—'}</span></div>
            <div className="mobile-task-detail-row"><span>Started</span><span>{formatTime(detail.ts)}</span></div>
            <div className="mobile-task-detail-row"><span>Duration</span><span>{formatDuration(detail.duration)}</span></div>
            <div className="mobile-task-detail-row"><span>Tasks</span><span>{detail.taskCount || 0}</span></div>
          </div>
          {detail.summary && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Summary</h4>
              <p style={{ fontSize: 13 }}>{detail.summary}</p>
            </div>
          )}
          {detail.output && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Output</h4>
              <pre className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--bg-elev-2)', padding: 8, borderRadius: 6 }}>
                {detail.output.slice(0, 1000)}{detail.output.length > 1000 ? '…' : ''}
              </pre>
            </div>
          )}
        </MobileBottomSheet>
      )}
    </div>
  );
}
