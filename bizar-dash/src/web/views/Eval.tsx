// src/views/Eval.tsx — v5.2.0
//
// Main "Eval" tab view. Acts as the entry point to the eval framework
// UI: shows the recent runs summary at the top and links the user
// into EvalReport for the full per-fixture breakdown and regression
// diffing.
//
// The detailed comparison/diff lives in EvalReport.tsx; this view is
// a lighter landing page that mirrors the existing Doctor-style
// overview pattern (counts at top, recent history, call to action).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, ArrowRight, RefreshCw, ExternalLink, Clock, Plus, Trash2 } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EvalRunCard, type EvalRunSummary } from '../components/EvalRunCard';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

type EvalSchedule = {
  id: string;
  name: string;
  suitePath: string;
  cron: string;
  agent: string;
};

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const RECENT_RUNS_LIMIT = 8;

function AddScheduleForm({
  onAdded,
  onCancel,
}: {
  onAdded: (schedule: EvalSchedule) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [suitePath, setSuitePath] = useState('');
  const [cron, setCron] = useState('');
  const [agent, setAgent] = useState('thor');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !suitePath || !cron) {
      toast.error('name, suitePath, and cron are required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<EvalSchedule>('/eval/schedules', { name, suitePath, cron, agent });
      onAdded(result);
      toast.success('Schedule created');
    } catch (err) {
      toast.error(`Failed to create schedule: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="eval-schedule-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label htmlFor="sched-name">Name</label>
        <input
          id="sched-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Daily fixture check"
          required
        />
      </div>
      <div className="form-row">
        <label htmlFor="sched-suite">Suite path</label>
        <input
          id="sched-suite"
          type="text"
          value={suitePath}
          onChange={(e) => setSuitePath(e.target.value)}
          placeholder="./fixtures"
          required
        />
      </div>
      <div className="form-row">
        <label htmlFor="sched-cron">Cron</label>
        <input
          id="sched-cron"
          type="text"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          placeholder="0 8 * * *"
          required
        />
      </div>
      <div className="form-row">
        <label htmlFor="sched-agent">Agent</label>
        <input
          id="sched-agent"
          type="text"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="thor"
        />
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" size="sm" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create schedule'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EvalInner({ setActiveTab }: Props) {
  const toast = useToast();
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<'runs' | 'schedules'>('runs');
  const [schedules, setSchedules] = useState<EvalSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ runs: EvalRunSummary[] }>(`/eval/runs?limit=${RECENT_RUNS_LIMIT}`);
      if (!cancelledRef.current) setRuns(r.runs || []);
    } catch (err) {
      if (!cancelledRef.current) {
        toast.error(`Failed to load eval runs: ${(err as Error).message}`);
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [toast]);

  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const r = await api.get<{ schedules: EvalSchedule[] }>('/eval/schedules');
      if (!cancelledRef.current) setSchedules(r.schedules || []);
    } catch (err) {
      if (!cancelledRef.current) {
        toast.error(`Failed to load eval schedules: ${(err as Error).message}`);
      }
    } finally {
      if (!cancelledRef.current) setLoadingSchedules(false);
    }
  }, [toast]);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    if (subTab === 'schedules') loadSchedules();
    return () => { cancelledRef.current = true; };
  }, [load, loadSchedules, subTab]);

  const deleteSchedule = async (id: string) => {
    try {
      await api.del(`/eval/schedules/${id}`);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      toast.success('Schedule deleted');
    } catch (err) {
      toast.error(`Failed to delete schedule: ${(err as Error).message}`);
    }
  };

  const recent = runs.slice(0, RECENT_RUNS_LIMIT);
  const totals = runs.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.passed += r.passed;
      acc.failed += r.failed;
      if (r.failed === 0) acc.fullPass += 1;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, fullPass: 0 },
  );
  const overallRate = totals.total > 0 ? ((totals.passed / totals.total) * 100).toFixed(1) : '—';

  return (
    <div className="view view-eval" data-testid="eval-overview">
      <div className="view-header">
        <div className="view-header-text">
          <h1 className="view-title">
            <ClipboardCheck size={20} aria-hidden /> Eval
          </h1>
          <p className="view-subtitle muted">
            Track golden-fixture runs, catch regressions, and compare run history.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? <Spinner size="sm" /> : <RefreshCw size={12} />}
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setActiveTab('evalReport')}
            title="Open the full eval report"
          >
            <ExternalLink size={12} /> Open Eval Report
          </Button>
        </div>
      </div>

      <div className="eval-summary-grid">
        <Card className="eval-summary-card">
          <CardTitle>Recent runs</CardTitle>
          <div className="eval-summary-value">{runs.length}</div>
          <CardMeta className="muted">
            Latest {RECENT_RUNS_LIMIT} runs across all suites.
          </CardMeta>
        </Card>
        <Card className="eval-summary-card">
          <CardTitle>Fixtures run</CardTitle>
          <div className="eval-summary-value">{totals.total}</div>
          <CardMeta className="muted">
            <span className={cn('eval-rate', totals.failed === 0 ? 'is-pass' : 'is-fail')}>
              {overallRate}% pass rate
            </span>
          </CardMeta>
        </Card>
        <Card className="eval-summary-card">
          <CardTitle>Clean runs</CardTitle>
          <div className="eval-summary-value">{totals.fullPass}</div>
          <CardMeta className="muted">
            Runs where every fixture passed.
          </CardMeta>
        </Card>
        <Card className="eval-summary-card eval-summary-cta">
          <CardTitle>Compare runs</CardTitle>
          <CardMeta>
            Open the detailed report to diff two runs side-by-side and
            spot regressions fixture by fixture.
          </CardMeta>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setActiveTab('evalReport')}
            className="eval-summary-cta-btn"
          >
            Open report <ArrowRight size={12} />
          </Button>
        </Card>
      </div>

      <div className="eval-recent-section">
        <div className="eval-sub-tabs">
          <button
            type="button"
            className={cn('eval-sub-tab', subTab === 'runs' ? 'is-active' : '')}
            onClick={() => setSubTab('runs')}
          >
            <ClipboardCheck size={12} aria-hidden /> Runs
          </button>
          <button
            type="button"
            className={cn('eval-sub-tab', subTab === 'schedules' ? 'is-active' : '')}
            onClick={() => { setSubTab('schedules'); if (schedules.length === 0) loadSchedules(); }}
          >
            <Clock size={12} aria-hidden /> Schedules
          </button>
        </div>

        {subTab === 'runs' ? (
          <>
            <h2 className="eval-section-title">Recent runs</h2>
            {loading && recent.length === 0 ? (
              <div className="eval-runs-loading">
                <Spinner size="sm" />
                <span className="muted">Loading runs…</span>
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck size={28} />}
                title="No eval runs yet"
                message={
                  <>
                    Run a suite via the CLI:{' '}
                    <code className="mono">bizar eval run ./path/to/fixtures</code>.
                    Results will appear here.
                  </>
                }
              />
            ) : (
              <div className="eval-runs-list">
                {recent.map((r) => (
                  <EvalRunCard key={r.id} run={r} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="eval-section-title">Schedules</h2>
            {loadingSchedules ? (
              <div className="eval-runs-loading">
                <Spinner size="sm" />
                <span className="muted">Loading schedules…</span>
              </div>
            ) : schedules.length === 0 ? (
              <EmptyState
                icon={<Clock size={28} />}
                title="No eval schedules"
                message="Schedules let you run eval suites automatically on a cron. Add one below."
              />
            ) : (
              <div className="eval-schedules-list">
                {schedules.map((s) => (
                  <Card key={s.id} className="eval-schedule-card">
                    <div className="eval-schedule-row">
                      <div className="eval-schedule-info">
                        <CardTitle>{s.name}</CardTitle>
                        <CardMeta className="muted">
                          {s.cron} · {s.suitePath} · agent:{s.agent || 'thor'}
                        </CardMeta>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSchedule(s.id)}
                        title="Delete schedule"
                      >
                        <Trash2 size={12} aria-hidden />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
            <div className="eval-schedule-add">
              <AddScheduleForm
                onAdded={(newSchedule) => {
                  setSchedules((prev) => [...prev, newSchedule]);
                  setShowAddSchedule(false);
                }}
                onCancel={() => setShowAddSchedule(false)}
              />
              {!showAddSchedule && (
                <Button variant="secondary" size="sm" onClick={() => setShowAddSchedule(true)}>
                  <Plus size={12} aria-hidden /> Add schedule
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const Eval = React.memo(EvalInner);