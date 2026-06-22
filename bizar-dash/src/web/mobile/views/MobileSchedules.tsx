// src/mobile/views/MobileSchedules.tsx — schedules list with detail sheet, edit modal, and a reusable New/Edit modal.
//
// v3.9.0 — overhaul:
//   - PATCH for partial updates (toggle enabled, edit fields) is now
//     supported by the backend (see routes/schedules.mjs).
//   - NewScheduleModal accepts an optional `initial` schedule and submits
//     PUT when editing, POST when creating. The same modal handles both
//     flows so the operator doesn't context-switch between forms.
//   - Detail sheet exposes an Edit button so the mobile UI can edit any
//     schedule, not just toggle it.
//   - The structured pickers mirror the desktop (DOW, hour, minute,
//     timezone) but in a more compact layout suited to a phone screen.
import { useEffect, useState } from 'react';
import { Clock, Plus, RefreshCw, Trash2, Play, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import type { Schedule, Snapshot } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { MobileModal } from '../components/MobileModal';

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
};

const TYPES: Array<Schedule['type']> = ['cron', 'interval', 'once'];
const ACTIONS: Array<Schedule['action']['type']> = ['command', 'agent', 'webhook'];

const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'];

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`,
}));
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55
const DOWS = [
  { value: '*', label: 'Every day' },
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
];
const INTERVAL_UNITS = [
  { value: 's', label: 'sec' },
  { value: 'm', label: 'min' },
  { value: 'h', label: 'hr' },
  { value: 'd', label: 'day' },
];

export function MobileSchedules({ snapshot }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>(snapshot.schedules || []);
  const [loading, setLoading] = useState(!snapshot.schedules);
  const [filter, setFilter] = useState('');
  const [detailSchedule, setDetailSchedule] = useState<Schedule | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; initial?: Schedule }>({ open: false });

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

  // v3.9.0 — PATCH partial update (toggle enabled, edit name, etc.).
  // The backend supports PATCH (see routes/schedules.mjs).
  const toggleSchedule = async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/schedules/${encodeURIComponent(id)}`, { enabled });
      setSchedules((cur) => cur.map((s) => (s.id === id ? { ...s, enabled } : s)));
      if (detailSchedule?.id === id) {
        setDetailSchedule((s) => (s ? { ...s, enabled } : s));
      }
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

  // v3.9.0 — backend added /trigger as an alias of /run (mobile uses this).
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
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={() => setEditor({ open: true })}
          aria-label="New schedule"
        >
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
                  {humanizeSchedule(s)} ·{' '}
                  {s.nextRun ? `next ${formatNextShort(s.nextRun, s.timezone)}` : 'no next run'}
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
                className="mobile-btn"
                onClick={() => {
                  if (!detailSchedule) return;
                  setEditor({ open: true, initial: detailSchedule });
                  setDetailSchedule(null);
                }}
              >
                <Pencil size={14} /> Edit
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
              <div className="mobile-task-detail-row">
                <span>Type</span>
                <span>{detailSchedule.type}</span>
              </div>
              <div className="mobile-task-detail-row">
                <span>Schedule</span>
                <span className="mono">{humanizeSchedule(detailSchedule) || detailSchedule.schedule}</span>
              </div>
              {detailSchedule.timezone && (
                <div className="mobile-task-detail-row">
                  <span>Timezone</span>
                  <span className="mono">{detailSchedule.timezone}</span>
                </div>
              )}
              <div className="mobile-task-detail-row">
                <span>Action</span>
                <span>{detailSchedule.action.type}: {detailSchedule.action.target}</span>
              </div>
              {detailSchedule.action.type === 'agent' && detailSchedule.action.prompt && (
                <div className="mobile-task-detail-row">
                  <span>Prompt</span>
                  <span style={{ fontSize: 12 }}>{detailSchedule.action.prompt}</span>
                </div>
              )}
              {detailSchedule.budgetCheck?.skipIfBudgetLow && (
                <div className="mobile-task-detail-row">
                  <span>Budget gate</span>
                  <span>skip if ≥ {detailSchedule.budgetCheck.maxConcurrent ?? 6} concurrent</span>
                </div>
              )}
              <div className="mobile-task-detail-row">
                <span>Next run</span>
                <span>{detailSchedule.nextRun ? formatNextShort(detailSchedule.nextRun, detailSchedule.timezone) : '—'}</span>
              </div>
              <div className="mobile-task-detail-row">
                <span>Last run</span>
                <span>{detailSchedule.lastRun ? formatRel(detailSchedule.lastRun) : '—'}</span>
              </div>
              {detailSchedule.lastResult && (
                <div className="mobile-task-detail-row">
                  <span>Last result</span>
                  <span style={{ fontSize: 12 }}>{detailSchedule.lastResult}</span>
                </div>
              )}
              {detailSchedule.lastError && (
                <div className="mobile-task-detail-row">
                  <span>Last error</span>
                  <span style={{ fontSize: 12 }}>{detailSchedule.lastError}</span>
                </div>
              )}
            </div>
          </div>
        </MobileBottomSheet>
      )}

      <ScheduleEditor
        open={editor.open}
        initial={editor.initial}
        onClose={() => setEditor({ open: false })}
        onSaved={() => {
          setEditor({ open: false });
          reload();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable mobile editor modal                                      */
/* ------------------------------------------------------------------ */

type EditorState = {
  name: string;
  type: Schedule['type'];
  cronMinute: number;
  cronHour: number;
  cronDow: string;
  intervalN: number;
  intervalUnit: string;
  onceAt: string;
  timezone: string;
  actionType: Schedule['action']['type'];
  actionTarget: string;
  actionPrompt: string;
  skipIfBudgetLow: boolean;
  maxConcurrent: number;
  enabled: boolean;
};

function initialEditorState(initial?: Schedule): EditorState {
  if (!initial) {
    return {
      name: '',
      type: 'cron',
      cronMinute: 0,
      cronHour: 13,
      cronDow: '0',
      intervalN: 30,
      intervalUnit: 'm',
      onceAt: '',
      timezone: 'UTC',
      actionType: 'agent',
      actionTarget: '',
      actionPrompt: '',
      skipIfBudgetLow: false,
      maxConcurrent: 6,
      enabled: true,
    };
  }
  const parsedCron = initial.type === 'cron' ? parseSimpleCron(initial.schedule) : null;
  const parsedInterval = initial.type === 'interval' ? parseSimpleInterval(initial.schedule) : null;
  return {
    name: initial.name || '',
    type: initial.type,
    cronMinute: parsedCron?.minute ?? 0,
    cronHour: parsedCron?.hour ?? 9,
    cronDow: parsedCron?.dow ?? '*',
    intervalN: parsedInterval?.n ?? 30,
    intervalUnit: parsedInterval?.unit ?? 'm',
    onceAt: initial.type === 'once' ? toDatetimeLocal(initial.schedule) : '',
    timezone: initial.timezone || 'UTC',
    actionType: initial.action.type,
    actionTarget: initial.action.target || '',
    actionPrompt: initial.action.prompt || '',
    skipIfBudgetLow: !!initial.budgetCheck?.skipIfBudgetLow,
    maxConcurrent: Number.isFinite(initial.budgetCheck?.maxConcurrent)
      ? initial.budgetCheck!.maxConcurrent!
      : 6,
    enabled: initial.enabled !== false,
  };
}

function composeScheduleValue(s: EditorState): string {
  if (s.type === 'cron') return `${s.cronMinute} ${s.cronHour} * * ${s.cronDow}`;
  if (s.type === 'interval') return `${s.intervalN}${s.intervalUnit}`;
  if (!s.onceAt) return '';
  try {
    return new Date(s.onceAt).toISOString();
  } catch {
    return s.onceAt;
  }
}

function ScheduleEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<EditorState>(() => initialEditorState(initial));
  const [submitting, setSubmitting] = useState(false);

  // Re-seed state when the modal is reopened with a different initial.
  useEffect(() => {
    if (open) setState(initialEditorState(initial));
  }, [open, initial]);

  const update = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState((cur) => ({ ...cur, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.name.trim()) return;
    const schedule = composeScheduleValue(state);
    if (!schedule) return;
    setSubmitting(true);
    try {
      const payload = {
        name: state.name.trim(),
        type: state.type,
        schedule,
        timezone: state.timezone,
        action: {
          type: state.actionType,
          target: state.actionTarget.trim(),
          ...(state.actionType === 'agent' && state.actionPrompt.trim()
            ? { prompt: state.actionPrompt.trim() }
            : {}),
        },
        budgetCheck: {
          maxConcurrent: state.maxConcurrent,
          skipIfBudgetLow: state.skipIfBudgetLow,
        },
        enabled: state.enabled,
      };
      if (initial) {
        await api.put(`/schedules/${encodeURIComponent(initial.id)}`, payload);
      } else {
        await api.post('/schedules', payload);
      }
      onSaved();
    } catch {
      // best-effort — modal stays open so the operator can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileModal
      open={open}
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'New schedule'}
      actions={
        <button
          type="submit"
          form="mobile-schedule-form"
          className="mobile-btn"
          style={{ width: '100%' }}
          disabled={submitting}
        >
          <Plus size={14} /> {initial ? 'Save' : 'Create'}
        </button>
      }
    >
      <form id="mobile-schedule-form" onSubmit={handleSubmit} className="mobile-task-form">
        <label className="mobile-field-label">Name *</label>
        <input
          className="mobile-input"
          type="text"
          placeholder="Weekly review"
          value={state.name}
          onChange={(e) => update('name', e.target.value)}
          autoFocus
          required
        />

        <label className="mobile-field-label">Type</label>
        <select
          className="mobile-input"
          value={state.type}
          onChange={(e) => update('type', e.target.value as Schedule['type'])}
        >
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        {state.type === 'cron' && (
          <>
            <label className="mobile-field-label">Day of week</label>
            <select
              className="mobile-input"
              value={state.cronDow}
              onChange={(e) => update('cronDow', e.target.value)}
            >
              {DOWS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>

            <div className="mobile-form-row">
              <div style={{ flex: 1 }}>
                <label className="mobile-field-label">Hour</label>
                <select
                  className="mobile-input"
                  value={String(state.cronHour)}
                  onChange={(e) => update('cronHour', parseInt(e.target.value, 10))}
                >
                  {HOURS.map((h) => <option key={h.value} value={String(h.value)}>{h.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="mobile-field-label">Minute</label>
                <select
                  className="mobile-input"
                  value={String(state.cronMinute)}
                  onChange={(e) => update('cronMinute', parseInt(e.target.value, 10))}
                >
                  {MINUTES.map((m) => <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        {state.type === 'interval' && (
          <div className="mobile-form-row">
            <div style={{ flex: 1 }}>
              <label className="mobile-field-label">Every</label>
              <input
                className="mobile-input"
                type="number"
                min={1}
                value={state.intervalN}
                onChange={(e) => update('intervalN', parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="mobile-field-label">Unit</label>
              <select
                className="mobile-input"
                value={state.intervalUnit}
                onChange={(e) => update('intervalUnit', e.target.value)}
              >
                {INTERVAL_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {state.type === 'once' && (
          <>
            <label className="mobile-field-label">Run at</label>
            <input
              className="mobile-input"
              type="datetime-local"
              value={state.onceAt}
              onChange={(e) => update('onceAt', e.target.value)}
            />
          </>
        )}

        <label className="mobile-field-label">Timezone</label>
        <select
          className="mobile-input"
          value={TIMEZONES.includes(state.timezone) ? state.timezone : 'UTC'}
          onChange={(e) => update('timezone', e.target.value)}
        >
          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>

        <label className="mobile-field-label">Action type</label>
        <select
          className="mobile-input"
          value={state.actionType}
          onChange={(e) => update('actionType', e.target.value as Schedule['action']['type'])}
        >
          {ACTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label className="mobile-field-label">Target</label>
        <input
          className="mobile-input"
          type="text"
          placeholder={
            state.actionType === 'webhook'
              ? 'https://...'
              : state.actionType === 'agent'
                ? 'agent or task ref'
                : 'echo hello'
          }
          value={state.actionTarget}
          onChange={(e) => update('actionTarget', e.target.value)}
        />

        {state.actionType === 'agent' && (
          <>
            <label className="mobile-field-label">Prompt</label>
            <textarea
              className="mobile-input"
              rows={3}
              placeholder="What should the agent do?"
              value={state.actionPrompt}
              onChange={(e) => update('actionPrompt', e.target.value)}
            />
          </>
        )}

        <fieldset className="mobile-budget-card">
          <legend>Budget pre-flight</legend>
          <label className="mobile-checkbox-row">
            <input
              type="checkbox"
              checked={state.skipIfBudgetLow}
              onChange={(e) => update('skipIfBudgetLow', e.target.checked)}
            />
            <span>Skip if too many bg tasks are running</span>
          </label>
          <label className="mobile-field-label">Cap</label>
          <input
            className="mobile-input"
            type="number"
            min={1}
            max={64}
            value={state.maxConcurrent}
            onChange={(e) => update('maxConcurrent', parseInt(e.target.value, 10) || 6)}
            disabled={!state.skipIfBudgetLow}
          />
        </fieldset>

        <label className="mobile-checkbox-row">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
          />
          <span>Enabled</span>
        </label>
      </form>
    </MobileModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatRel(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatNextShort(iso: string, tz?: string | null): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz || undefined,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function parseSimpleCron(expr: string): { minute: number; hour: number; dow: string } | null {
  if (typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, , , dow] = parts;
  const minNum = parseInt(m, 10);
  const hourNum = parseInt(h, 10);
  if (!Number.isFinite(minNum) || !Number.isFinite(hourNum)) return null;
  if (m !== String(minNum) || h !== String(hourNum)) return null;
  return {
    minute: minNum,
    hour: hourNum,
    dow: dow === '*' ? '*' : (Number.isFinite(parseInt(dow, 10)) ? dow : '*'),
  };
}

function parseSimpleInterval(s: string): { n: number; unit: string } | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d+)([smhd])$/i.exec(s.trim());
  if (!m) return null;
  return { n: parseInt(m[1], 10), unit: m[2].toLowerCase() };
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function humanizeSchedule(s: Schedule): string {
  if (s.type !== 'cron') return s.schedule;
  const parsed = parseSimpleCron(s.schedule);
  if (!parsed) return s.schedule;
  const dow = DOWS.find((d) => d.value === parsed.dow)?.label || parsed.dow;
  const hourLabel = HOURS.find((h) => h.value === parsed.hour)?.label || `${parsed.hour}`;
  const minute = String(parsed.minute).padStart(2, '0');
  if (dow === 'Every day') return `Every day ${hourLabel} :${minute}`;
  return `Every ${dow} ${hourLabel} :${minute}`;
}