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
import { ClipboardCheck, ArrowRight, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { EvalRunCard, type EvalRunSummary } from '../components/EvalRunCard';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const RECENT_RUNS_LIMIT = 8;

function EvalInner({ setActiveTab }: Props) {
  const toast = useToast();
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);

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
      </div>
    </div>
  );
}

export const Eval = React.memo(EvalInner);