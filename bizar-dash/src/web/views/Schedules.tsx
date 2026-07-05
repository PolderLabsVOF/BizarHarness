// src/views/Schedules.tsx — list, create, edit, run, delete schedules for the active project.
//
// v3.9.0 — overhauled with structured DOW/time/TZ pickers, a reusable
// ScheduleEditorModal that handles both create and edit, a human-readable
// schedule label on every card, and a timezone-aware next-run display.
import { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Plus,
  PlayCircle,
  Pencil,
  Trash2,
  RefreshCw,
  History,
  ChevronDown,
  LayoutTemplate,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { formatRelative } from '../lib/utils';
import type { Schedule, Settings, Snapshot } from '../lib/types';
import { ScheduleTemplateCard } from '../components/ScheduleTemplateCard';
import type { ScheduleTemplate } from '../components/ScheduleTemplateCard';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const TYPES = ['interval', 'cron', 'once'] as const;
const ACTIONS = ['command', 'agent', 'webhook'] as const;

// v3.9.0 — Curated IANA timezone list. "Other…" lets the operator type
// any zone croner accepts (the backend passes the string through).
const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CT)' },
  { value: 'Europe/London', label: 'Europe/London (UK)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
];

const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,10,…55
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`,
}));
const DOW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '*', label: 'Every day' },
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const INTERVAL_UNITS: Array<{ value: string; label: string }> = [
  { value: 's', label: 'seconds' },
  { value: 'm', label: 'minutes' },
  { value: 'h', label: 'hours' },
  { value: 'd', label: 'days' },
];

/** Best-effort cron parser — used to pre-populate the structured form
 *  when editing a schedule the user originally saved with raw cron text. */
function parseCronFields(expr: string): { minute: number; hour: number; dow: string } | null {
  if (typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, , , dow] = parts;
  // We only pre-populate when every field is a literal — wildcards and
  // ranges (other than `*`) leave the form blank rather than guess.
  const minNum = parseInt(m, 10);
  const hourNum = parseInt(h, 10);
  if (!Number.isFinite(minNum) || !Number.isFinite(hourNum)) return null;
  if (m !== String(minNum) || h !== String(hourNum)) return null;
  const dowClean = dow === '*' ? '*' : parseInt(dow, 10);
  if (dowClean === null || (dow !== '*' && !Number.isFinite(dowClean))) return null;
  return { minute: minNum, hour: hourNum, dow: dow === '*' ? '*' : String(dowClean) };
}

function parseIntervalParts(s: string): { n: number; unit: string } | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d+)\s*([smhd])$/i.exec(s.trim());
  if (!m) return null;
  return { n: parseInt(m[1], 10), unit: m[2].toLowerCase() };
}

type EditorState = {
  name: string;
  type: 'cron' | 'interval' | 'once';
  cronMinute: number;
  cronHour: number;
  cronDow: string;
  showAdvanced: boolean;
  rawCron: string;
  intervalN: number;
  intervalUnit: string;
  onceAt: string; // datetime-local string
  timezone: string;
  customTimezone: string;
  actionType: 'command' | 'agent' | 'webhook';
  actionTarget: string;
  actionPrompt: string;
  skipIfBudgetLow: boolean;
  maxConcurrent: number;
  enabled: boolean;
  humanLabel: string;
};

function buildInitialState(initial?: Schedule): EditorState {
  if (!initial) {
    return {
      name: '',
      type: 'cron',
      cronMinute: 0,
      cronHour: 13,
      cronDow: '0',
      showAdvanced: false,
      rawCron: '0 13 * * 0',
      intervalN: 30,
      intervalUnit: 'm',
      onceAt: '',
      timezone: 'UTC',
      customTimezone: '',
      actionType: 'agent',
      actionTarget: '',
      actionPrompt: '',
      skipIfBudgetLow: false,
      maxConcurrent: 6,
      enabled: true,
      humanLabel: '',
    };
  }
  const parsed = initial.type === 'cron' ? parseCronFields(initial.schedule) : null;
  const parsedInterval = initial.type === 'interval' ? parseIntervalParts(initial.schedule) : null;
  const tz = initial.timezone || 'UTC';
  const tzKnown = TIMEZONES.some((t) => t.value === tz);
  return {
    name: initial.name || '',
    type: initial.type,
    cronMinute: parsed?.minute ?? 0,
    cronHour: parsed?.hour ?? 9,
    cronDow: parsed?.dow ?? '*',
    showAdvanced: !parsed,
    rawCron: initial.schedule,
    intervalN: parsedInterval?.n ?? 30,
    intervalUnit: parsedInterval?.unit ?? 'm',
    onceAt: initial.type === 'once' ? toDatetimeLocal(initial.schedule) : '',
    timezone: tzKnown ? tz : 'Other…',
    customTimezone: tzKnown ? '' : tz,
    actionType: initial.action.type,
    actionTarget: initial.action.target || '',
    actionPrompt: initial.action.prompt || '',
    skipIfBudgetLow: !!initial.budgetCheck?.skipIfBudgetLow,
    maxConcurrent: Number.isFinite(initial.budgetCheck?.maxConcurrent)
      ? initial.budgetCheck!.maxConcurrent!
      : 6,
    enabled: initial.enabled !== false,
    humanLabel: '',
  };
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // datetime-local needs YYYY-MM-DDTHH:mm in *local* time.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

/** Compose the cron / interval / once schedule string + a human label. */
function composeSchedule(s: EditorState): { schedule: string; humanLabel: string } {
  if (s.type === 'cron') {
    if (s.showAdvanced) {
      return { schedule: s.rawCron.trim(), humanLabel: s.humanLabel || s.rawCron.trim() };
    }
    const cron = `${s.cronMinute} ${s.cronHour} * * ${s.cronDow}`;
    const dowName = DOW_OPTIONS.find((d) => d.value === s.cronDow)?.label || '';
    const hourLabel = HOUR_OPTIONS.find((h) => h.value === s.cronHour)?.label || `${s.cronHour}`;
    const minute = String(s.cronMinute).padStart(2, '0');
    const human =
      dowName === 'Every day'
        ? `Every day at ${hourLabel.replace(' ', '')} (min ${minute})`
        : `Every ${dowName} at ${hourLabel.replace(' ', '')} (min ${minute})`;
    return { schedule: cron, humanLabel: s.humanLabel || human };
  }
  if (s.type === 'interval') {
    const unit = INTERVAL_UNITS.find((u) => u.value === s.intervalUnit)?.label || s.intervalUnit;
    const schedule = `${s.intervalN}${s.intervalUnit}`;
    return {
      schedule,
      humanLabel: s.humanLabel || `Every ${s.intervalN} ${unit}`,
    };
  }
  // once
  if (!s.onceAt) return { schedule: '', humanLabel: s.humanLabel || '' };
  const iso = new Date(s.onceAt).toISOString();
  return {
    schedule: iso,
    humanLabel: s.humanLabel || new Date(s.onceAt).toLocaleString(),
  };
}

export function Schedules({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [schedules, setSchedules] = useState<Schedule[]>(snapshot.schedules || []);
  const [loading, setLoading] = useState(!snapshot.schedules);
  const [activeSection, setActiveSection] = useState<'schedules' | 'templates'>('schedules');
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const reload = async () => {
    try {
      const r = await api.get<{ schedules: Schedule[]; projectId: string | null }>(
        '/projects/active/schedules',
      );
      setSchedules(r.schedules || []);
    } catch (err) {
      toast.error(`Schedules load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const r = await api.get<{ templates: ScheduleTemplate[] }>('/schedules/templates');
      setTemplates(r.templates || []);
    } catch (err) {
      toast.error(`Templates load failed: ${(err as Error).message}`);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    if (snapshot.schedules?.length || snapshot.schedules) {
      setSchedules(snapshot.schedules || []);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.schedules]);

  useEffect(() => {
    if (activeSection === 'templates' && templates.length === 0) {
      loadTemplates();
    }
  }, [activeSection]);

  const openEditor = (initial?: Schedule) => {
    modal.open({
      title: initial ? `Edit schedule: ${initial.name}` : 'New schedule',
      width: 640,
      children: (
        <ScheduleEditorModal
          initial={initial}
          onClose={modal.close}
          onSubmitted={async (saved) => {
            setSchedules((cur) => {
              const idx = cur.findIndex((s) => s.id === saved.id);
              if (idx === -1) return [...cur, saved];
              const copy = cur.slice();
              copy[idx] = saved;
              return copy;
            });
            toast.success(initial ? 'Schedule updated.' : 'Schedule created.');
            modal.close();
            await refreshSnapshot();
          }}
          onError={(msg) => toast.error(msg)}
        />
      ),
    });
  };

  const onRun = async (s: Schedule) => {
    try {
      const r = await api.post<{ ok: boolean; schedule: Schedule; runResult: { error?: string; stdout?: string } }>(
        `/schedules/${encodeURIComponent(s.id)}/run`,
      );
      toast.success(r.ok ? 'Schedule ran.' : `Run failed: ${r.runResult?.error || 'unknown'}`);
      await reload();
    } catch (err) {
      toast.error(`Run failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (s: Schedule) => {
    if (!confirm(`Delete schedule "${s.name}"?`)) return;
    try {
      await api.del(`/schedules/${encodeURIComponent(s.id)}`);
      setSchedules((cur) => cur.filter((x) => x.id !== s.id));
      toast.success('Schedule deleted.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const onUseTemplate = async (template: ScheduleTemplate) => {
    try {
      const saved = await api.post<Schedule>('/schedules/from-template', {
        templateId: template.id,
      });
      setSchedules((cur) => [...cur, saved]);
      setActiveSection('schedules');
      toast.success(`Schedule "${saved.name}" created from template.`);
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Failed to create schedule: ${(err as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="view-loading"><Spinner size="lg" /></div>
    );
  }

  return (
    <div className="view view-schedules">
      <header className="view-header">
        <div className="view-header-text">
          <div className="view-title-row">
            <h2 className="view-title">
              <Clock size={18} /> Schedules
            </h2>
            <div className="view-section-tabs">
              <button
                type="button"
                className={`tab-btn ${activeSection === 'schedules' ? 'tab-btn-active' : ''}`}
                onClick={() => setActiveSection('schedules')}
              >
                Schedules ({schedules.length})
              </button>
              <button
                type="button"
                className={`tab-btn ${activeSection === 'templates' ? 'tab-btn-active' : ''}`}
                onClick={() => setActiveSection('templates')}
              >
                <LayoutTemplate size={14} /> Templates
              </button>
            </div>
          </div>
          <p className="view-subtitle">
            {activeSection === 'schedules'
              ? <>Recurring tasks for <strong>{snapshot.activeProject?.name || '(none)'}</strong>. Service daemon runs them at the right time.</>
              : 'Example schedules you can use as a starting point.'}
          </p>
        </div>
        <div className="view-actions">
          {activeSection === 'schedules' && (
            <>
              <Button variant="secondary" size="sm" onClick={reload}>
                <RefreshCw size={14} /> Refresh
              </Button>
              <Button variant="primary" size="sm" onClick={() => openEditor()}>
                <Plus size={14} /> New schedule
              </Button>
            </>
          )}
          {activeSection === 'templates' && (
            <Button variant="secondary" size="sm" onClick={loadTemplates} disabled={templatesLoading}>
              <RefreshCw size={14} /> Refresh
            </Button>
          )}
        </div>
      </header>

      {activeSection === 'templates' ? (
        templatesLoading ? (
          <div className="view-loading"><Spinner size="lg" /></div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<LayoutTemplate size={32} />}
            title="No templates"
            message="No schedule templates found. Templates are loaded from templates/schedules/."
          />
        ) : (
          <div className="schedule-template-grid">
            {templates.map((t) => (
              <ScheduleTemplateCard key={t.id} template={t} onUse={onUseTemplate} />
            ))}
          </div>
        )
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={<Clock size={32} />}
          title="No schedules"
          message={
            snapshot.activeProject
              ? 'Add a schedule to run commands, webhooks, or agent tasks on a cron / interval / one-shot basis.'
              : 'Activate a project first to scope schedules.'
          }
        />
      ) : (
        <div className="schedule-grid">
          {schedules.map((s) => (
            <Card key={s.id} className="schedule-card">
              <div className="schedule-card-head">
                <div>
                  <CardTitle>{s.name}</CardTitle>
                  <CardMeta>
                    <code>{s.type}</code> ·{' '}
                    <span title={s.schedule}>{humanizeSchedule(s) || s.schedule}</span>
                    {s.timezone && s.timezone !== 'UTC' ? <> · <code>{s.timezone}</code></> : null}
                    {' · '}
                    <span className={s.enabled ? 'status-on' : 'status-neutral'}>
                      {s.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </CardMeta>
                </div>
                <div className="schedule-card-actions">
                  <Button variant="secondary" size="sm" onClick={() => openEditor(s)}>
                    <Pencil size={12} /> Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onRun(s)}>
                    <PlayCircle size={12} /> Run now
                  </Button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label="Delete"
                    title="Delete"
                    onClick={() => onDelete(s)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="schedule-card-action">
                <span className="muted">action:</span>{' '}
                <code>
                  {s.action.type} {s.action.target}
                </code>
                {s.action.type === 'agent' && s.action.prompt && (
                  <div className="schedule-card-prompt">
                    <span className="muted">prompt:</span> {s.action.prompt}
                  </div>
                )}
              </div>
              {s.budgetCheck?.skipIfBudgetLow && (
                <div className="schedule-card-budget">
                  <span className="muted">budget gate:</span>{' '}
                  skip if concurrent ≥ {s.budgetCheck.maxConcurrent ?? 6}
                </div>
              )}
              <div className="schedule-card-times">
                <div>
                  <span className="muted">last</span>{' '}
                  {s.lastRun ? formatRelative(s.lastRun) : '—'}
                  {s.lastResult && (
                    <span className={`tag ${resultTagClass(s.lastResult)}`}>{s.lastResult}</span>
                  )}
                  {s.lastError && (
                    <span className="muted schedule-card-error" title={s.lastError}>
                      {' '}— {truncate(s.lastError, 80)}
                    </span>
                  )}
                </div>
                <div>
                  <span className="muted">next</span>{' '}
                  {s.nextRun ? (
                    <span title={new Date(s.nextRun).toISOString()}>
                      {formatNextRun(s.nextRun, s.timezone)}
                    </span>
                  ) : (
                    '—'
                  )}
                  {s.nextRun && (
                    <span className="muted"> · {formatRelative(s.nextRun)}</span>
                  )}
                </div>
              </div>
              {s.history && s.history.length > 0 && (
                <details className="schedule-card-history">
                  <summary>
                    <History size={12} /> {s.history.length} run{s.history.length === 1 ? '' : 's'}
                  </summary>
                  <ul>
                    {s.history.slice(-10).reverse().map((h, i) => (
                      <li key={i}>
                        <span className="tabular-nums muted">{formatRelative(h.ts)}</span>{' '}
                        <span className={`tag ${resultTagClass(h.result)}`}>{h.result}</span>
                        {h.error && <span className="muted"> — {truncate(h.error, 80)}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor modal                                                      */
/* ------------------------------------------------------------------ */

function ScheduleEditorModal({
  initial,
  onClose,
  onSubmitted,
  onError,
}: {
  initial?: Schedule;
  onClose: () => void;
  onSubmitted: (saved: Schedule) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [state, setState] = useState<EditorState>(() => buildInitialState(initial));
  const [submitting, setSubmitting] = useState(false);
  const tzSelectValue = useMemo(() => {
    if (TIMEZONES.some((t) => t.value === state.timezone)) return state.timezone;
    return 'Other…';
  }, [state.timezone]);

  const update = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState((cur) => ({ ...cur, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = state.name.trim();
    if (!trimmedName) {
      onError('Name is required.');
      return;
    }
    const composed = composeSchedule(state);
    if (!composed.schedule) {
      onError('Schedule value is required.');
      return;
    }
    if (!state.actionTarget.trim()) {
      onError('Action target is required.');
      return;
    }
    const tz = state.timezone === 'Other…' ? state.customTimezone.trim() : state.timezone;
    const actionPayload: Record<string, unknown> = {
      type: state.actionType,
      target: state.actionTarget.trim(),
    };
    if (state.actionType === 'agent' && state.actionPrompt.trim()) {
      actionPayload.prompt = state.actionPrompt.trim();
    }
    const payload: Record<string, unknown> = {
      name: trimmedName,
      type: state.type,
      schedule: composed.schedule,
      timezone: tz || 'UTC',
      action: actionPayload,
      budgetCheck: {
        maxConcurrent: state.maxConcurrent,
        skipIfBudgetLow: state.skipIfBudgetLow,
      },
      enabled: state.enabled,
    };
    setSubmitting(true);
    try {
      const saved = initial
        ? await api.put<Schedule>(`/schedules/${encodeURIComponent(initial.id)}`, payload)
        : await api.post<Schedule>('/schedules', payload);
      await onSubmitted(saved);
    } catch (err) {
      onError(`${initial ? 'Update' : 'Create'} failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="schedule-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="schedule-name">Name</label>
      <input
        id="schedule-name"
        className="input"
        type="text"
        placeholder="Weekly code review"
        value={state.name}
        onChange={(e) => update('name', e.target.value)}
        autoFocus
      />

      <div className="task-form-row">
        <div className="task-form-field">
          <label className="field-label" htmlFor="schedule-type">Type</label>
          <select
            id="schedule-type"
            className="select"
            value={state.type}
            onChange={(e) => update('type', e.target.value as EditorState['type'])}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {state.type === 'cron' && (
        <div className="schedule-cron-group">
          {!state.showAdvanced && (
            <>
              <div className="task-form-row">
                <div className="task-form-field">
                  <label className="field-label" htmlFor="schedule-dow">Day of week</label>
                  <select
                    id="schedule-dow"
                    className="select"
                    value={state.cronDow}
                    onChange={(e) => update('cronDow', e.target.value)}
                  >
                    {DOW_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div className="task-form-field">
                  <label className="field-label" htmlFor="schedule-hour">Hour</label>
                  <select
                    id="schedule-hour"
                    className="select"
                    value={String(state.cronHour)}
                    onChange={(e) => update('cronHour', parseInt(e.target.value, 10))}
                  >
                    {HOUR_OPTIONS.map((h) => (
                      <option key={h.value} value={String(h.value)}>{h.label}</option>
                    ))}
                  </select>
                </div>
                <div className="task-form-field">
                  <label className="field-label" htmlFor="schedule-minute">Minute</label>
                  <select
                    id="schedule-minute"
                    className="select"
                    value={String(state.cronMinute)}
                    onChange={(e) => update('cronMinute', parseInt(e.target.value, 10))}
                  >
                    {MINUTE_OPTIONS.map((m) => (
                      <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
          {state.showAdvanced && (
            <div className="task-form-field">
              <label className="field-label" htmlFor="schedule-cron-expr">Cron expression</label>
              <input
                id="schedule-cron-expr"
                className="input"
                type="text"
                value={state.rawCron}
                onChange={(e) => update('rawCron', e.target.value)}
                placeholder="0 13 * * 0"
              />
            </div>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => update('showAdvanced', !state.showAdvanced)}
            aria-expanded={state.showAdvanced}
          >
            <ChevronDown
              size={12}
              style={{
                transform: state.showAdvanced ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
            {state.showAdvanced ? 'Hide advanced' : 'Advanced (raw cron)'}
          </button>
        </div>
      )}

      {state.type === 'interval' && (
        <div className="task-form-row">
          <div className="task-form-field" style={{ flex: 1 }}>
            <label className="field-label" htmlFor="schedule-interval-n">Every</label>
            <input
              id="schedule-interval-n"
              className="input"
              type="number"
              min={1}
              value={state.intervalN}
              onChange={(e) => update('intervalN', parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div className="task-form-field" style={{ flex: 1 }}>
            <label className="field-label" htmlFor="schedule-interval-unit">Unit</label>
            <select
              id="schedule-interval-unit"
              className="select"
              value={state.intervalUnit}
              onChange={(e) => update('intervalUnit', e.target.value)}
            >
              {INTERVAL_UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {state.type === 'once' && (
        <div className="task-form-field">
          <label className="field-label" htmlFor="schedule-once-at">Run at</label>
          <input
            id="schedule-once-at"
            className="input"
            type="datetime-local"
            value={state.onceAt}
            onChange={(e) => update('onceAt', e.target.value)}
          />
        </div>
      )}

      <div className="task-form-row">
        <div className="task-form-field" style={{ flex: 1 }}>
          <label className="field-label" htmlFor="schedule-timezone">Timezone</label>
          <select
            id="schedule-timezone"
            className="select"
            value={tzSelectValue}
            onChange={(e) => update('timezone', e.target.value)}
          >
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            <option value="Other…">Other…</option>
          </select>
        </div>
        {state.timezone === 'Other…' && (
          <div className="task-form-field" style={{ flex: 1 }}>
            <label className="field-label" htmlFor="schedule-custom-tz">IANA name</label>
            <input
              id="schedule-custom-tz"
              className="input"
              type="text"
              placeholder="Europe/Paris"
              value={state.customTimezone}
              onChange={(e) => update('customTimezone', e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="task-form-row">
        <div className="task-form-field">
          <label className="field-label" htmlFor="schedule-action-type">Action</label>
          <select
            id="schedule-action-type"
            className="select"
            value={state.actionType}
            onChange={(e) => update('actionType', e.target.value as EditorState['actionType'])}
          >
            {ACTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="task-form-field" style={{ flex: 2 }}>
          <label className="field-label" htmlFor="schedule-action-target">Target</label>
          <input
            id="schedule-action-target"
            className="input"
            type="text"
            placeholder={state.actionType === 'webhook' ? 'https://...' : state.actionType === 'agent' ? 'agent name or task ref' : 'echo hi'}
            value={state.actionTarget}
            onChange={(e) => update('actionTarget', e.target.value)}
          />
        </div>
      </div>

      {state.actionType === 'agent' && (
        <div className="task-form-field">
          <label className="field-label" htmlFor="schedule-action-prompt">Prompt (what to send the agent)</label>
          <textarea
            id="schedule-action-prompt"
            className="input"
            rows={3}
            placeholder="Review open PRs for stale code review comments and nudge reviewers."
            value={state.actionPrompt}
            onChange={(e) => update('actionPrompt', e.target.value)}
          />
        </div>
      )}

      <fieldset className="schedule-budget-card">
        <legend>Budget pre-flight</legend>
        <label className="checkbox-row">
          <input
            id="schedule-skip-budget"
            type="checkbox"
            checked={state.skipIfBudgetLow}
            onChange={(e) => update('skipIfBudgetLow', e.target.checked)}
          />
          <span>Skip this run when too many background tasks are already running.</span>
        </label>
        <div className="task-form-field">
          <label className="field-label" htmlFor="schedule-max-concurrent">Max concurrent bg tasks</label>
          <input
            id="schedule-max-concurrent"
            className="input"
            type="number"
            min={1}
            max={64}
            value={state.maxConcurrent}
            onChange={(e) => update('maxConcurrent', parseInt(e.target.value, 10) || 6)}
            disabled={!state.skipIfBudgetLow}
          />
        </div>
      </fieldset>

      <label className="checkbox-row">
        <input
          id="schedule-enabled"
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => update('enabled', e.target.checked)}
        />
        <span>Enabled</span>
      </label>

      <div className="modal-footer-actions">
        <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={submitting}>
          {initial ? 'Save' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function humanizeSchedule(s: Schedule): string {
  if (s.type !== 'cron') return s.schedule;
  const parsed = parseCronFields(s.schedule);
  if (!parsed) return s.schedule;
  const dowName = DOW_OPTIONS.find((d) => d.value === parsed.dow)?.label || '';
  const hourLabel = HOUR_OPTIONS.find((h) => h.value === parsed.hour)?.label || `${parsed.hour}`;
  const minute = String(parsed.minute).padStart(2, '0');
  if (dowName === 'Every day') return `Every day at ${hourLabel} :${minute}`;
  return `Every ${dowName} at ${hourLabel} :${minute}`;
}

function formatNextRun(iso: string, tz?: string | null): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz || undefined,
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function resultTagClass(result: string): string {
  if (result === 'success') return 'tag-success';
  if (result === 'skipped') return 'tag-warning';
  return 'tag-error';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}