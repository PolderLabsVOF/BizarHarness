// src/mobile/views/MobileHistory.tsx — session history list.
import { useEffect, useState } from 'react';
import { History, RefreshCw, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';

type HistoryEntry = {
  id: string;
  ts: string;
  duration?: number;
  agent?: string;
  taskCount?: number;
  summary?: string;
  output?: string;
};

type Props = {
  onBack: () => void;
};

export function MobileHistory({ onBack }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<HistoryEntry | null>(null);

  const load = async () => {
    try {
      const data = await api.get<{ history: HistoryEntry[] }>('/history');
      setEntries(data.history || []);
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

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <input className="mobile-search-input" type="text" placeholder="Search history…"
          style={{ flex: 1 }} />
        <button type="button" className="mobile-icon-btn" onClick={() => load()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : entries.length === 0 ? (
        <div className="mobile-empty">
          <History size={40} />
          <p>No history yet.</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {entries.map((e) => (
            <div
              key={e.id}
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
              <ChevronRight size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}

      {/* Detail sheet */}
      {detail && (
        <div className="mobile-sheet-overlay" onClick={() => setDetail(null)}>
          <div className="mobile-sheet" style={{ maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-header">
              <h3 className="mobile-sheet-title">Session Detail</h3>
              <button type="button" className="mobile-icon-btn" onClick={() => setDetail(null)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="mobile-sheet-content">
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
