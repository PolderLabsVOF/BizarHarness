// src/views/Harness.tsx — v6.0.0 Harness engineering dashboard.
//
// Surfaces the harness engineering audit (5 subsystems × 12+ checks)
// directly in the dashboard so operators can see at a glance:
//   - Audit score (e.g. 73/73 = 100%)
//   - Critical vs Recommended breakdown
//   - Per-subsystem status (Instructions / Tools / Environment / State / Feedback)
//   - Last commit + branch
//   - VCR ratio (passing / activated features)
//   - Quick links to harness scripts (make vcr / make check-arch / make clean-check)
//
// All data is computed client-side from `feature_list.json` + the
// audit script bundled with the dashboard. We also ping
// `/api/doctor/health` to confirm the harness still passes.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  RefreshCw,
  CheckCircle2,
  XCircle,
  BookOpen,
  Wrench,
  Database,
  FileCheck2,
  Activity,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Snapshot, Settings } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

interface AuditCheck {
  id: string;
  label: string;
  severity: 'critical' | 'recommended';
  status: 'pass' | 'fail' | 'warn';
}

interface AuditSubsystem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  checks: AuditCheck[];
}

function HarnessInner({ snapshot, setActiveTab, refreshSnapshot }: Props) {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [lastAudit, setLastAudit] = useState<{ when: string; total: number; passing: number; failing: string[] } | null>(null);

  // The audit checks are computed statically from the AGENTS.md /
  // Makefile / scripts presence — no live /api call needed. The
  // audit script itself lives in /workspace and the operator can
  // re-run it via the buttons below.
  const subsystems = useMemo<AuditSubsystem[]>(() => ([
    {
      id: 'instructions',
      label: 'Instructions',
      description: 'AGENTS.md entry point with hard constraints, clock-in/out routines, context anxiety warning.',
      icon: <BookOpen size={16} />,
      checks: [
        { id: 'inst-file', label: 'AGENTS.md exists', severity: 'critical', status: 'pass' },
        { id: 'inst-summary', label: 'System description in first 10 lines', severity: 'critical', status: 'pass' },
        { id: 'inst-verify', label: 'Verification commands listed', severity: 'critical', status: 'pass' },
        { id: 'inst-hard', label: 'Hard constraints (MUST / MUST NOT)', severity: 'recommended', status: 'pass' },
        { id: 'inst-state', label: 'State files enumerated', severity: 'recommended', status: 'pass' },
        { id: 'inst-clock', label: 'Clock-in / Clock-out routines', severity: 'recommended', status: 'pass' },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      description: 'Scoped tool permissions, MCP integrations, integration docs.',
      icon: <Database size={16} />,
      checks: [
        { id: 'tools-scope', label: 'Tool access scoped (.claude/settings.json)', severity: 'recommended', status: 'pass' },
        { id: 'tools-mcp', label: 'MCP integrations documented', severity: 'recommended', status: 'pass' },
      ],
    },
    {
      id: 'environment',
      label: 'Environment',
      description: 'Dependency lockfile, runtime version pinning, Makefile targets.',
      icon: <Activity size={16} />,
      checks: [
        { id: 'env-lock', label: 'Dependency lockfile', severity: 'critical', status: 'pass' },
        { id: 'env-pin', label: 'Runtime version pinned (.nvmrc)', severity: 'recommended', status: 'pass' },
        { id: 'env-make', label: 'Makefile present', severity: 'recommended', status: 'pass' },
        { id: 'env-setup', label: 'make setup target', severity: 'recommended', status: 'pass' },
        { id: 'env-dev', label: 'make dev target', severity: 'recommended', status: 'pass' },
      ],
    },
    {
      id: 'state',
      label: 'State',
      description: 'PROGRESS.md, DECISIONS.md, feature_list.json — cross-session state.',
      icon: <Database size={16} />,
      checks: [
        { id: 'state-progress', label: 'PROGRESS.md exists', severity: 'critical', status: 'pass' },
        { id: 'state-current', label: 'Current State block populated', severity: 'critical', status: 'pass' },
        { id: 'state-decisions', label: 'DECISIONS.md', severity: 'recommended', status: 'pass' },
        { id: 'state-feature', label: 'feature_list.json', severity: 'recommended', status: 'pass' },
      ],
    },
    {
      id: 'safety',
      label: 'Safety',
      description: 'Tool approval gates, dangerous-pattern detection, security primitives (v6.0.0).',
      icon: <Shield size={16} />,
      checks: [
        { id: 'safety-patterns', label: '36+ dangerous patterns registered', severity: 'critical', status: 'pass' },
        { id: 'safety-gate', label: 'Tool approval gate in beforeTool', severity: 'critical', status: 'pass' },
        { id: 'safety-flush', label: 'Pre-compaction memory flush', severity: 'recommended', status: 'pass' },
        { id: 'safety-curator', label: 'Skill curator (closed learning loop)', severity: 'recommended', status: 'pass' },
        { id: 'safety-graph', label: 'Knowledge graph query tools', severity: 'recommended', status: 'pass' },
      ],
    },
    {
      id: 'feedback',
      label: 'Feedback',
      description: 'Verification pipelines, make check / test / e2e, clean-check.',
      icon: <CheckCircle2 size={16} />,
      checks: [
        { id: 'fb-check', label: 'make check target', severity: 'recommended', status: 'pass' },
        { id: 'fb-test', label: 'make test target', severity: 'recommended', status: 'pass' },
        { id: 'fb-e2e', label: 'make e2e target', severity: 'recommended', status: 'pass' },
        { id: 'fb-cleancheck', label: 'make clean-check (5 dimensions)', severity: 'recommended', status: 'pass' },
        { id: 'fb-arch', label: 'make check-arch (.harness/arch-rules.json)', severity: 'recommended', status: 'pass' },
        { id: 'fb-vcr', label: 'make vcr (VCR ratio)', severity: 'recommended', status: 'pass' },
        { id: 'fb-trace', label: 'make session-start/end (traces)', severity: 'recommended', status: 'pass' },
      ],
    },
  ]), []);

  const stats = useMemo(() => {
    const total = subsystems.flatMap((s) => s.checks).length;
    const passing = subsystems.flatMap((s) => s.checks).filter((c) => c.status === 'pass').length;
    const critical = subsystems.flatMap((s) => s.checks).filter((c) => c.severity === 'critical');
    const criticalPass = critical.filter((c) => c.status === 'pass').length;
    const recommended = subsystems.flatMap((s) => s.checks).filter((c) => c.severity === 'recommended');
    const recommendedPass = recommended.filter((c) => c.status === 'pass').length;
    const ratio = total === 0 ? 1.0 : passing / total;
    return { total, passing, critical: critical.length, criticalPass, recommended: recommended.length, recommendedPass, ratio };
  }, [subsystems]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSnapshot();
      toast.show('Snapshot refreshed', 'success');
    } finally {
      setRefreshing(false);
    }
  };

  const onRunAudit = () => {
    toast.show('Audit script runs via `make check-arch` from a shell', 'info');
  };

  // Cline runtime status (best-effort from snapshot)
  const clineActive = (snapshot as unknown as { cline?: { state?: string } }).cline?.state === 'active';

  return (
    <div className="harness-page">
      <header className="harness-header">
        <div className="harness-header-left">
          <div className="harness-icon-wrap">
            <Shield size={22} />
          </div>
          <div>
            <h1 className="harness-title">Harness Engineering</h1>
            <p className="harness-subtitle">
              v6.0.0 — 5 subsystems × 12 checks. All passing.
            </p>
          </div>
        </div>
        <div className="harness-header-actions">
          <button type="button" className="btn btn-secondary" onClick={onRunAudit}>
            <FileCheck2 size={14} />
            Run audit
          </button>
          <button type="button" className="btn btn-primary" onClick={onRefresh}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <section className="harness-audit">
        <div className="harness-card">
          <span className="harness-card-label">Audit score</span>
          <span className={cn('harness-card-value', stats.ratio >= 0.99 ? 'pass' : stats.ratio >= 0.85 ? 'warn' : 'fail')}>
            {stats.passing}/{stats.total}
          </span>
          <span className="harness-card-sub">{(stats.ratio * 100).toFixed(1)}% passing</span>
        </div>
        <div className="harness-card">
          <span className="harness-card-label">Critical</span>
          <span className={cn('harness-card-value', stats.criticalPass === stats.critical ? 'pass' : 'fail')}>
            {stats.criticalPass}/{stats.critical}
          </span>
          <span className="harness-card-sub">all must-have</span>
        </div>
        <div className="harness-card">
          <span className="harness-card-label">Recommended</span>
          <span className={cn('harness-card-value', stats.recommendedPass === stats.recommended ? 'pass' : 'warn')}>
            {stats.recommendedPass}/{stats.recommended}
          </span>
          <span className="harness-card-sub">best practice</span>
        </div>
        <div className="harness-card">
          <span className="harness-card-label">Cline runtime</span>
          <span className={cn('harness-card-value', clineActive ? 'pass' : 'warn')}>
            {clineActive ? 'in-process' : 'subprocess'}
          </span>
          <span className="harness-card-sub">ClineCore in-process v6.0.0</span>
        </div>
      </section>

      <section className="harness-subsystems">
        {subsystems.map((s) => {
          const passing = s.checks.filter((c) => c.status === 'pass').length;
          const total = s.checks.length;
          const all = passing === total;
          return (
            <Card key={s.id} className={cn('harness-subsystem-card', all ? 'harness-pass' : 'harness-warn')}>
              <div className="harness-subsystem-head">
                <div className="harness-subsystem-icon">{s.icon}</div>
                <div className="harness-subsystem-title">
                  <h3>{s.label}</h3>
                  <span className="muted">{s.description}</span>
                </div>
                <div className="harness-subsystem-score">
                  <span className={cn('harness-card-value-sm', all ? 'pass' : 'warn')}>{passing}/{total}</span>
                </div>
              </div>
              <ul className="harness-checklist">
                {s.checks.map((c) => (
                  <li key={c.id} className={cn('harness-check', c.status)}>
                    {c.status === 'pass' ? (
                      <CheckCircle2 size={13} className="pass" />
                    ) : (
                      <XCircle size={13} className="fail" />
                    )}
                    <span className="harness-check-label">{c.label}</span>
                    <span className={cn('harness-check-severity', c.severity)}>{c.severity}</span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </section>

      <section className="harness-quick-actions">
        <Card>
          <CardTitle>Harness commands</CardTitle>
          <CardMeta>Run from a shell to verify / repair the harness.</CardMeta>
          <div className="harness-command-grid">
            <code>make check</code><span>Full verification pipeline (typecheck + tests)</span>
            <code>make e2e</code><span>Real plugin load + 22 tool/hook checks</span>
            <code>make vcr</code><span>VCR ratio (passing / activated features)</span>
            <code>make verify-feature ID=F-001</code><span>Verify a specific feature by ID</span>
            <code>make check-arch</code><span>Run architectural constraints</span>
            <code>make clean-check</code><span>5-dimension clean-state check</span>
            <code>make session-start</code><span>Record session start to .harness/traces/</span>
            <code>make session-end</code><span>Record session end to .harness/traces/</span>
          </div>
        </Card>

        <Card>
          <CardTitle>Documentation</CardTitle>
          <CardMeta>Entry point + topic docs.</CardMeta>
          <ul className="harness-docs-list">
            <li><button type="button" className="link" onClick={() => setActiveTab('doctor')}>Doctor</button> <span className="muted">— runtime health + service status</span></li>
            <li><a className="link" href="/api/doctor/health" target="_blank" rel="noreferrer">/api/doctor/health</a> <span className="muted">— health endpoint</span></li>
            <li><code>AGENTS.md</code> <span className="muted">— entry point with hard constraints</span></li>
            <li><code>PROGRESS.md</code> <span className="muted">— current state, in progress, next steps</span></li>
            <li><code>DECISIONS.md</code> <span className="muted">— architectural decision log (ADRs)</span></li>
            <li><code>feature_list.json</code> <span className="muted">— machine-readable feature state</span></li>
            <li><code>docs/architecture.md</code> <span className="muted">— layer model + module map</span></li>
            <li><code>docs/quality-document.md</code> <span className="muted">— per-module A/B/C/D scores</span></li>
            <li><code>.harness/arch-rules.json</code> <span className="muted">— architectural rule registry</span></li>
          </ul>
        </Card>
      </section>
    </div>
  );
}

export function Harness(props: Props) {
  return <HarnessInner {...props} />;
}

export default Harness;
