// src/views/EvalReport.tsx — v5.2.0
//
// Eval report dashboard view. Two columns:
//
//   ┌────────────────┬───────────────────────────────────┐
//   │ Runs list      │ Detail panel                       │
//   │ (EvalRunCard)  │   - Run metadata + summary         │
//   │                │   - Per-fixture pass/fail table    │
//   │                │   - Optional EvalDiff (when a      │
//   │                │     baseline run is selected)      │
//   └────────────────┴───────────────────────────────────┘
//
// Data sources:
//   GET /api/eval/runs                       — list of recent runs
//   GET /api/eval/runs/:id                   — full run record
//   GET /api/eval/runs/:id/compare/:otherId  — diff between two runs

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, RefreshCw, ArrowLeftRight, X } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EvalRunCard, type EvalRunSummary } from '../components/EvalRunCard';
import {
  EvalDiff,
  computeEvalDiff,
  type EvalRunWithResults,
  type EvalFixtureResult,
} from '../components/EvalDiff';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

function RunDetail({
  run,
  onClearCompare,
  compareRun,
  onClearSelection,
  runsForDiff,
}: {
  run: EvalRunWithResults;
  onClearCompare: () => void;
  compareRun: string | null;
  onClearSelection: () => void;
  runsForDiff: EvalRunWithResults[];
}) {
  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(1) : '0.0';
  const sortedResults = [...run.results].sort((a, b) => {
    // Failures first, then by fixture id
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.fixtureId.localeCompare(b.fixtureId);
  });

  return (
    <div className="eval-run-detail" data-testid="eval-run-detail">
      <Card className="eval-run-detail-header">
        <div className="eval-run-detail-header-row">
          <CardTitle>
            <ClipboardCheck size={14} aria-hidden /> {run.id}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClearSelection} title="Close detail">
            <X size={12} /> Close
          </Button>
        </div>
        <CardMeta>
          {formatTime(run.startedAt)}
          {run.finishedAt ? ` → ${formatTime(run.finishedAt)}` : ''} · {run.suitePath}
        </CardMeta>
        <div className="eval-run-detail-summary">
          <span className={cn('eval-status', run.failed === 0 ? 'is-pass' : 'is-fail')}>
            {run.passed}/{run.total} ({passRate}%)
          </span>
          <span className="muted">
            {run.failed} failed · {run.passed} passed
          </span>
        </div>
      </Card>

      {compareRun ? (
        <Card className="eval-diff-card">
          {(() => {
            const baseRun = runsForDiff.find((r) => r.id === compareRun);
            if (!baseRun) {
              return (
                <div className="eval-diff-missing muted">
                  Baseline run <code>{compareRun}</code> not loaded. Pick another from the list.
                </div>
              );
            }
            // Show "before" as the baseline (older) and "after" as the
            // currently-selected run (newer). Re-derive before/after
            // from the diff helper to drive the heading.
            const diff = computeEvalDiff(baseRun, run);
            const improved = diff.filter((d) => d.change === 'improved').length;
            const regressed = diff.filter((d) => d.change === 'regressed').length;
            return (
              <>
                <div className="eval-diff-card-head">
                  <span className="eval-diff-card-title">
                    <ArrowLeftRight size={14} aria-hidden /> Comparing {baseRun.id} → {run.id}
                  </span>
                  <Button variant="ghost" size="sm" onClick={onClearCompare}>
                    <X size={12} /> Clear baseline
                  </Button>
                </div>
                <div className="eval-diff-stats" aria-label="Diff summary">
                  <span className="eval-diff-stat improved">+{improved} improved</span>
                  <span className="eval-diff-stat regressed">−{regressed} regressed</span>
                </div>
                <EvalDiff runA={baseRun} runB={run} />
              </>
            );
          })()}
        </Card>
      ) : (
        <Card className="eval-baseline-hint">
          <CardMeta>
            Tip: click another run in the list to use it as a baseline for diffing.
          </CardMeta>
        </Card>
      )}

      <Card className="eval-fixtures-card">
        <CardTitle>Fixtures ({run.results.length})</CardTitle>
        {sortedResults.length === 0 ? (
          <CardMeta className="muted">No fixture results in this run.</CardMeta>
        ) : (
          <ul className="eval-fixtures-list" role="list">
            {sortedResults.map((r) => (
              <li
                key={r.fixtureId}
                className={cn('eval-fixture-row', r.ok ? 'is-pass' : 'is-fail')}
              >
                <span
                  className={cn('eval-fixture-pill', r.ok ? 'is-pass' : 'is-fail')}
                  aria-label={r.ok ? 'pass' : 'fail'}
                >
                  {r.ok ? '✓' : '✗'}
                </span>
                <span className="eval-fixture-id mono">{r.fixtureId}</span>
                {!r.ok && r.checks ? (
                  <span className="eval-fixture-fails muted">
                    {r.checks
                      .filter((c) => !c.ok)
                      .map((c) => c.message)
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
                {r.latencyMs != null ? (
                  <span className="eval-fixture-latency muted">{Math.round(r.latencyMs)}ms</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EvalReportInner({ setActiveTab }: Props) {
  const toast = useToast();
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvalRunWithResults | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compareDetail, setCompareDetail] = useState<EvalRunWithResults | null>(null);
  const cancelledRef = useRef(false);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const r = await api.get<{ runs: EvalRunSummary[] }>('/eval/runs');
      if (!cancelledRef.current) setRuns(r.runs || []);
    } catch (err) {
      if (!cancelledRef.current) {
        toast.error(`Failed to load eval runs: ${(err as Error).message}`);
      }
    } finally {
      if (!cancelledRef.current) setLoadingRuns(false);
    }
  }, [toast]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const r = await api.get<EvalRunWithResults>(`/eval/runs/${encodeURIComponent(id)}`);
        if (!cancelledRef.current) setDetail(r);
      } catch (err) {
        if (!cancelledRef.current) {
          toast.error(`Failed to load run ${id}: ${(err as Error).message}`);
          setDetail(null);
        }
      } finally {
        if (!cancelledRef.current) setDetailLoading(false);
      }
    },
    [toast],
  );

  const loadCompareDetail = useCallback(
    async (id: string) => {
      try {
        const r = await api.get<EvalRunWithResults>(`/eval/runs/${encodeURIComponent(id)}`);
        if (!cancelledRef.current) setCompareDetail(r);
      } catch (err) {
        if (!cancelledRef.current) {
          toast.error(`Failed to load run ${id}: ${(err as Error).message}`);
          setCompareDetail(null);
        }
      }
    },
    [toast],
  );

  // Initial fetch
  useEffect(() => {
    cancelledRef.current = false;
    loadRuns();
    return () => { cancelledRef.current = true; };
  }, [loadRuns]);

  const selectRun = async (id: string) => {
    if (id === selectedRunId) return;
    setSelectedRunId(id);
    setCompareRunId(null);
    setCompareDetail(null);
    await loadDetail(id);
  };

  const useAsBaseline = async (id: string) => {
    if (id === selectedRunId) return;
    setCompareRunId(id);
    await loadCompareDetail(id);
  };

  // Build the runsForDiff array — only the full records we actually
  // have loaded (selected + baseline). Anything else is unavailable
  // and the detail panel will show a "not loaded" hint.
  const runsForDiff: EvalRunWithResults[] = [];
  if (compareDetail) runsForDiff.push(compareDetail);
  if (detail) runsForDiff.push(detail);

  return (
    <div className="view view-eval-report" data-testid="eval-report">
      <div className="view-header">
        <div className="view-header-text">
          <h1 className="view-title">
            <ClipboardCheck size={20} aria-hidden /> Eval Reports
          </h1>
          <p className="view-subtitle muted">
            Browse eval runs, inspect per-fixture results, and diff two runs to spot regressions.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={loadRuns} disabled={loadingRuns}>
            {loadingRuns ? <Spinner size="sm" /> : <RefreshCw size={12} />}
            {loadingRuns ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="eval-grid">
        <div className="eval-runs-list">
          {loadingRuns && runs.length === 0 ? (
            <div className="eval-runs-loading">
              <Spinner size="sm" />
              <span className="muted">Loading runs…</span>
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={28} />}
              title="No eval runs yet"
              message={
                <>
                  Run a suite via the CLI:{' '}
                  <code className="mono">bizar eval run ./path/to/fixtures</code>.
                </>
              }
            />
          ) : (
            runs.map((r) => (
              <div key={r.id} className="eval-run-card-wrap">
                <EvalRunCard
                  run={r}
                  selected={r.id === selectedRunId}
                  onClick={() => selectRun(r.id)}
                />
                {selectedRunId && r.id !== selectedRunId ? (
                  <button
                    type="button"
                    className="eval-baseline-btn"
                    onClick={() => useAsBaseline(r.id)}
                    title="Use this run as a baseline for diffing"
                  >
                    <ArrowLeftRight size={10} aria-hidden />
                    Use as baseline
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="eval-detail">
          {detailLoading && !detail ? (
            <div className="eval-detail-loading">
              <Spinner size="sm" />
              <span className="muted">Loading run details…</span>
            </div>
          ) : detail ? (
            <RunDetail
              run={detail}
              compareRun={compareRunId}
              runsForDiff={runsForDiff}
              onClearCompare={() => { setCompareRunId(null); setCompareDetail(null); }}
              onClearSelection={() => { setSelectedRunId(null); setDetail(null); setCompareRunId(null); setCompareDetail(null); }}
            />
          ) : (
            <Card className="eval-detail-empty">
              <EmptyState
                icon={<ClipboardCheck size={28} />}
                title="Select a run"
                message="Pick an eval run from the list to view fixture-by-fixture results, latency, and per-check failure details."
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export const EvalReport = React.memo(EvalReportInner);
export type { EvalFixtureResult };