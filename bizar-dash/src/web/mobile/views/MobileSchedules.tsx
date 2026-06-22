// src/mobile/views/MobileSchedules.tsx — schedules list with detail sheet + new modal.
import { useEffect, useState } from 'react';
import { Clock, Plus, RefreshCw, Trash2, Play } from 'lucide-react';
import { api } from '../../lib/api';
import type { Schedule, Snapshot } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { MobileModal } from '../components/MobileModal';

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
};

export function MobileSchedules({ snapshot, onBack }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>(snapshot.schedules || []);
  const [loading, setLoading] = useState(!snapshot.schedules);
  const [filter, setFilter] = useState('');
  const [detailSchedule, setDetailSchedule] = useState<Schedule | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const reload = async () => {
    try {
      const data = await api.get<{ schedules: Schedule[] }>('/schedules');
      setSchedules(data.schedules || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (snapshot.schedules) {
      setSchedules(snapshot.schedules);
      setLoading(false);
    } else {
      reload();
    }
  }, [snapshot.schedules]);

  const toggleSchedule = async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/schedules/${encodeURIComponent(id)}`, { enabled });
      setSchedules((cur) => cur.map((s) => (s.id === id ? { ...s, enabled } : s)));
      if (detailSchedule?.id === id) setDetailSchedule((s) => s ? { ...s, enabled } : s);
    } catch {
      // best-effort
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await api.del(`/schedules/${encodeURIComponent(id)}`);
      setSchedules((cur) => cur.filter((s) => s.id !== id));
      if (detailSchedule?.id === id) setDetailSchedule(null);
    } catch {
      // best-effort
    }
  };

  const triggerSchedule = async (id: string) => {
    try {
      await api.post(`/schedules/${encodeURIComponent(id)}/trigger`);
    } catch {
      // best-effort
    }
  };

  const filtered = filter.trim()
    ? schedules.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
    : schedules;

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search schedules…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => reload()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
        <button type="button" className="mobile-icon-btn" onClick={() => setNewOpen(true)} aria-label="New schedule">
          <Plus size={16} />
        </button>
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <Clock size={40} />
          <p>No schedules found.</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className="mobile-list-item mobile-list-item-interactive"
              onClick={() => setDetailSchedule(s)}
            >
              <div className="mobile-list-icon"><Clock size={16} /></div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{s.name}</span>
                <span className="mobile-list-meta">
                  {s.schedule} · {s.nextRun ? `next ${new Date(s.nextRun).toLocaleString()}` : 'no next run'}
                </span>
              </div>
              <span className={`mobile-list-badge ${s.enabled ? 'badge-on' : 'badge-off'}`}>
                {s.enabled ? 'on' : 'off'}
              </span>
            </button>
          ))}
        </div>
      )}

      {detailSchedule && (
        <MobileBottomSheet
          open={true}
          onClose={() => setDetailSchedule(null)}
          title={detailSchedule.name}
          actions={
            <div className="mobile-task-detail-actions">
              <button
                type="button"
                className="mobile-btn"
                onClick={() => { if (detailSchedule) triggerSchedule(detailSchedule.id); }}
              >
                <Play size={14} /> Trigger now
              </button>
              <button
                type="button"
                className={`mobile-btn ${!detailSchedule.enabled ? '' : 'mobile-btn-secondary'}`}
                onClick={() => { if (detailSchedule) toggleSchedule(detailSchedule.id, !detailSchedule.enabled); }}
              >
                {detailSchedule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                className="mobile-btn mobile-btn-danger"
                onClick={() => { if (detailSchedule) deleteSchedule(detailSchedule.id); }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          }
        >
          <div className="mobile-agent-detail">
            <div className="mobile-agent-detail-meta">
              <div className="mobile-task-detail-row"><span>Type</span><span>{detailSchedule.type}</span></div>
              <div className="mobile-task-detail-row"><span>Schedule</span><span className="mono">{detailSchedule.schedule}</span></div>
              <div className="mobile-task-detail-row"><span>Action</span><span>{detailSchedule.action.type}: {detailSchedule.action.target}</span></div>
              <div className="mobile-task-detail-row"><span>Next run</span><span>{detailSchedule.nextRun ? new Date(detailSchedule.nextRun).toLocaleString() : '—'}</span></div>
              <div className="mobile-task-detail-row"><span>Last run</span><span>{detailSchedule.lastRun ? formatRel(detailSchedule.lastRun) : '—'}</span></div>
              {detailSchedule.lastResult && (
                <div className="mobile-task-detail-row"><span>Last result</span><span style={{ fontSize: 12 }}>{detailSchedule.lastResult.slice(0, 100)}</span></div>
              )}
            </div>
          </div>
        </MobileBottomSheet>
      )}

      <NewScheduleModal open={newOpen} onClose={() => setNewOpen(false)} onCreate={() => { setNewOpen(false); reload(); }} />
    </div>
  );
}

function formatRel(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function NewScheduleModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: () => void }) {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [actionType, setActionType] = useState('command');
  const [actionTarget, setActionTarget] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !schedule.trim()) return;
    try {
      await api.post('/schedules', {
        name: name.trim(),
        schedule: schedule.trim(),
        type: 'cron',
        action: { type: actionType, target: actionTarget },
        enabled: true,
      });
      setName('');
      setSchedule('');
      setActionType('command');
      setActionTarget('');
      onCreate();
    } catch {
      // best-effort
    }
  };

  return (
    <MobileModal open={open} onClose={onClose} title="New Schedule" actions={
      <button type="submit" form="new-schedule-form" className="mobile-btn" style={{ width: '100%' }}>
        <Plus size={14} /> Create
      </button>
    }>
      <form id="new-schedule-form" onSubmit={handleSubmit} className="mobile-task-form">
        <label className="mobile-field-label">Name *</label>
        <input className="mobile-input" type="text" placeholder="My schedule"
          value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <label className="mobile-field-label">Cron expression *</label>
        <input className="mobile-input" type="text" placeholder="* * * * *"
          value={schedule} onChange={(e) => setSchedule(e.target.value)} required />
        <label className="mobile-field-label">Action type</label>
        <select className="mobile-input" value={actionType} onChange={(e) => setActionType(e.target.value)}>
          <option value="command">command</option>
          <option value="agent">agent</option>
          <option value="webhook">webhook</option>
        </select>
        <label className="mobile-field-label">Target</label>
        <input className="mobile-input" type="text" placeholder="e.g. echo hello"
          value={actionTarget} onChange={(e) => setActionTarget(e.target.value)} />
      </form>
    </MobileModal>
  );
}
