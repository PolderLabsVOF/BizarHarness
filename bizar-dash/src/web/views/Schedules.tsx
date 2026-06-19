// src/views/Schedules.tsx — list, create, run, delete schedules for the active project.
import { useEffect, useState } from 'react';
import {
  Clock,
  Plus,
  PlayCircle,
  Trash2,
  RefreshCw,
  History,
  X,
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

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const TYPES = ['interval', 'cron', 'once'] as const;
const ACTIONS = ['command', 'agent', 'webhook'] as const;

export function Schedules({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [schedules, setSchedules] = useState<Schedule[]>(snapshot.schedules || []);
  const [loading, setLoading] = useState(!snapshot.schedules);

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

  useEffect(() => {
    if (snapshot.schedules?.length || snapshot.schedules) {
      setSchedules(snapshot.schedules || []);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.schedules]);

  const onCreate = () => {
    let nameEl: HTMLInputElement | null = null;
    let typeEl: HTMLSelectElement | null = null;
    let scheduleEl: HTMLInputElement | null = null;
    let actionTypeEl: HTMLSelectElement | null = null;
    let actionTargetEl: HTMLInputElement | null = null;
    let enabledEl: HTMLInputElement | null = null;

    modal.open({
      title: 'New schedule',
      children: (
        <div className="schedule-form">
          <label className="field-label">Name</label>
          <input
            ref={(el) => (nameEl = el)}
            className="input"
            type="text"
            placeholder="Daily backup"
            autoFocus
          />
          <div className="task-form-row">
            <div className="task-form-field">
              <label className="field-label">Type</label>
              <select ref={(el) => (typeEl = el)} className="select" defaultValue="interval">
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field">
              <label className="field-label">Schedule</label>
              <input
                ref={(el) => (scheduleEl = el)}
                className="input"
                type="text"
                placeholder="30m | 0 0 * * * | 2026-12-31T00:00:00Z"
              />
            </div>
          </div>
          <div className="task-form-row">
            <div className="task-form-field">
              <label className="field-label">Action</label>
              <select ref={(el) => (actionTypeEl = el)} className="select" defaultValue="command">
                {ACTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field" style={{ flex: 2 }}>
              <label className="field-label">Target</label>
              <input
                ref={(el) => (actionTargetEl = el)}
                className="input"
                type="text"
                placeholder='echo hi | thor | https://...'
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              ref={(el) => (enabledEl = el)}
              type="checkbox"
              defaultChecked
            />
            <span>Enabled</span>
          </label>
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const name = (nameEl?.value || '').trim();
              const type = typeEl?.value || 'interval';
              const schedule = (scheduleEl?.value || '').trim();
              const actionType = actionTypeEl?.value || 'command';
              const actionTarget = (actionTargetEl?.value || '').trim();
              if (!name) return toast.warning('Name is required.');
              if (!schedule) return toast.warning('Schedule is required.');
              if (!actionTarget) return toast.warning('Action target is required.');
              try {
                const s = await api.post<Schedule>('/schedules', {
                  name, type, schedule,
                  enabled: enabledEl?.checked !== false,
                  action: { type: actionType, target: actionTarget },
                });
                setSchedules((cur) => [...cur, s]);
                toast.success('Schedule created.');
                modal.close();
                await refreshSnapshot();
              } catch (err) {
                toast.error(`Create failed: ${(err as Error).message}`);
              }
            }}
          >
            Create
          </Button>
        </div>
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

  if (loading) {
    return (
      <div className="view-loading"><Spinner size="lg" /></div>
    );
  }

  return (
    <div className="view view-schedules">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Clock size={18} /> Schedules ({schedules.length})
          </h2>
          <p className="view-subtitle">
            Recurring tasks for the active project: <strong>{snapshot.activeProject?.name || '(none)'}</strong>.
            Service daemon runs them at the right time.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} /> New schedule
          </Button>
        </div>
      </header>

      {schedules.length === 0 ? (
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
                  <div className="schedule-card-name">{s.name}</div>
                  <div className="schedule-card-meta">
                    <code>{s.type}</code> · <code>{s.schedule}</code> ·{' '}
                    <span className={s.enabled ? 'status-on' : 'status-neutral'}>
                      {s.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                </div>
                <div className="schedule-card-actions">
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
                <code>{s.action.type} {s.action.target}</code>
              </div>
              <div className="schedule-card-times">
                <div>
                  <span className="muted">last</span>{' '}
                  {s.lastRun ? formatRelative(s.lastRun) : '—'}
                  {s.lastResult && (
                    <span className={`tag ${s.lastResult === 'success' ? 'tag-success' : 'tag-error'}`}>
                      {s.lastResult}
                    </span>
                  )}
                </div>
                <div>
                  <span className="muted">next</span>{' '}
                  {s.nextRun ? formatRelative(s.nextRun) : '—'}
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
                        <span className={`tag ${h.result === 'success' ? 'tag-success' : 'tag-error'}`}>
                          {h.result}
                        </span>
                        {h.error && <span className="muted"> — {h.error}</span>}
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
