// src/web/mobile/MobileEval.tsx — v5.4 mobile eval view with runs and schedules tabs.
import { useEffect, useState } from 'react';
import { ClipboardCheck, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../lib/api';
import type { EvalRunSummary } from '../components/EvalRunCard';

type EvalSchedule = {
  id: string;
  name: string;
  suitePath: string;
  cron: string;
  agent: string;
};

function pickStatus(run: EvalRunSummary): 'pass' | 'warn' | 'fail' {
  if (run.total <= 0) return 'fail';
  if (run.failed === 0) return 'pass';
  if (run.passed / run.total > 0.8) return 'warn';
  return 'fail';
}

export function MobileEval() {
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [schedules, setSchedules] = useState<EvalSchedule[]>([]);
  const [tab, setTab] = useState<'runs' | 'schedules'>('runs');
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [selectedRun, setSelectedRun] = useState<EvalRunSummary | null>(null);

  useEffect(() => {
    api.get<{ runs: EvalRunSummary[] }>('/eval/runs')
      .then((r) => setRuns(r.runs ?? []))
      .catch(() => {/* best-effort */})
      .finally(() => setLoadingRuns(false));
  }, []);

  const loadSchedules = () => {
    setLoadingSchedules(true);
    api.get<{ schedules: EvalSchedule[] }>('/eval/schedules')
      .then((r) => setSchedules(r.schedules ?? []))
      .catch(() => {/* best-effort */})
      .finally(() => setLoadingSchedules(false));
  };

  useEffect(() => {
    if (tab === 'schedules' && schedules.length === 0) {
      loadSchedules();
    }
  }, [tab]);

  return (
    <div className="mobile-eval">
      <div className="mobile-eval-tabs">
        <button
          type="button"
          className={cn('mobile-eval-tab', tab === 'runs' && 'is-active')}
          onClick={() => setTab('runs')}
        >
          <ClipboardCheck size={12} aria-hidden />
          Runs
        </button>
        <button
          type="button"
          className={cn('mobile-eval-tab', tab === 'schedules' && 'is-active')}
          onClick={() => setTab('schedules')}
        >
          <Clock size={12} aria-hidden />
          Schedules
        </button>
      </div>

      {tab === 'runs' && (
        <div className="mobile-eval-runs">
          {loadingRuns ? (
            <div className="mobile-loading"><p>Loading runs…</p></div>
          ) : runs.length === 0 ? (
            <div className="mobile-empty">
              <ClipboardCheck size={32} />
              <p>No eval runs yet.</p>
            </div>
          ) : (
            runs.map((r) => {
              const status = pickStatus(r);
              return (
                <div
                  key={r.id}
                  className="mobile-eval-run-card"
                  onClick={() => setSelectedRun(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedRun(r)}
                >
                  <div className={cn('mobile-eval-status', `is-${status}`)}>
                    {r.passed}/{r.total}
                  </div>
                  <div className="mobile-eval-run-info">
                    <div className="mobile-eval-run-id">{r.id}</div>
                    <div className="mobile-eval-run-time">
                      {new Date(r.startedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'schedules' && (
        <div className="mobile-eval-schedules">
          {loadingSchedules ? (
            <div className="mobile-loading"><p>Loading schedules…</p></div>
          ) : schedules.length === 0 ? (
            <div className="mobile-empty">
              <Clock size={32} />
              <p>No eval schedules.</p>
            </div>
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="mobile-eval-schedule-card">
                <div className="mobile-eval-schedule-name">{s.name}</div>
                <div className="mobile-eval-schedule-meta">
                  {s.cron} · {s.suitePath} · agent:{s.agent || 'thor'}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {selectedRun && (
        <div className="mobile-eval-run-sheet">
          <div className="mobile-bottom-sheet-header">
            <h3>Run {selectedRun.id}</h3>
            <button
              type="button"
              className="mobile-bottom-sheet-close"
              onClick={() => setSelectedRun(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="mobile-eval-run-sheet-body">
            <div className="mobile-eval-run-sheet-row">
              <span>Suite</span>
              <span>{selectedRun.suitePath}</span>
            </div>
            <div className="mobile-eval-run-sheet-row">
              <span>Passed</span>
              <span>{selectedRun.passed}</span>
            </div>
            <div className="mobile-eval-run-sheet-row">
              <span>Failed</span>
              <span>{selectedRun.failed}</span>
            </div>
            <div className="mobile-eval-run-sheet-row">
              <span>Started</span>
              <span>{new Date(selectedRun.startedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
