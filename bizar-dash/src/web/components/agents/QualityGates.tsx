// src/web/components/agents/QualityGates.tsx — pass/fail rubric display.
//
// v6.4.0 — F-036 (Goal Planner UI). Scores the four L09 rubric
// dimensions (Correctness / Arch compliance / Test coverage /
// Verification evidence) against the live plan. Each gate turns
// green when the supplied metric meets the threshold documented in
// `templates/evaluator-rubric.md`.
import { Shield, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../Card';
import { Tag } from '../Tag';
import type { Plan } from '../../lib/goapPlanner';

interface Metrics {
  /** 0 or 1 — whether `make check` is green. */
  compileCheck: boolean;
  /** Percentage of touched tests passing. */
  testCoverage: number;
  /** Percentage of arch-rules passing. */
  archScore: number;
  /** Verification evidence (commit hash or test output) present. */
  evidencePresent: boolean;
}

interface GateRow {
  name: string;
  status: 'passed' | 'warning' | 'failed';
  value?: number | boolean;
  threshold?: number | boolean;
  detail: string;
}

interface Props {
  plan: Plan | null;
  metrics: Metrics;
}

function evaluate(metrics: Metrics): GateRow[] {
  const compile: GateRow = metrics.compileCheck
    ? { name: 'Compile check', status: 'passed', value: true, threshold: true, detail: 'make check is green.' }
    : { name: 'Compile check', status: 'failed', value: false, threshold: true, detail: 'Typecheck error — fix before marking passing.' };

  const coverage: GateRow = metrics.testCoverage >= 80
    ? { name: 'Test coverage', status: 'passed', value: metrics.testCoverage, threshold: 80, detail: 'Coverage meets the B-grade threshold.' }
    : metrics.testCoverage >= 60
      ? { name: 'Test coverage', status: 'warning', value: metrics.testCoverage, threshold: 80, detail: 'Coverage is below the B-grade threshold.' }
      : { name: 'Test coverage', status: 'failed', value: metrics.testCoverage, threshold: 80, detail: 'Coverage is critical.' };

  const arch: GateRow = metrics.archScore >= 90
    ? { name: 'Arch compliance', status: 'passed', value: metrics.archScore, threshold: 90, detail: 'All non-trivial arch-rules satisfied.' }
    : metrics.archScore >= 70
      ? { name: 'Arch compliance', status: 'warning', value: metrics.archScore, threshold: 90, detail: 'Minor arch-rule violations.' }
      : { name: 'Arch compliance', status: 'failed', value: metrics.archScore, threshold: 90, detail: 'Multiple arch-rule violations.' };

  const evidence: GateRow = metrics.evidencePresent
    ? { name: 'Verification evidence', status: 'passed', value: true, threshold: true, detail: 'Test output + commit hash captured.' }
    : { name: 'Verification evidence', status: 'failed', value: false, threshold: true, detail: 'No evidence recorded yet.' };

  return [compile, coverage, arch, evidence];
}

function GateIcon({ status }: { status: GateRow['status'] }) {
  if (status === 'passed') return <CheckCircle2 size={14} className="qg-icon is-pass" />;
  if (status === 'warning') return <AlertTriangle size={14} className="qg-icon is-warn" />;
  return <XCircle size={14} className="qg-icon is-fail" />;
}

function GateTag({ status }: { status: GateRow['status'] }) {
  if (status === 'passed') return <Tag variant="success">passed</Tag>;
  if (status === 'warning') return <Tag variant="warning">warning</Tag>;
  return <Tag variant="error">failed</Tag>;
}

export function QualityGates({ plan, metrics }: Props) {
  const gates = evaluate(metrics);
  const passing = gates.filter((g) => g.status === 'passed').length;
  return (
    <Card className="qg-panel" data-testid="quality-gates">
      <div className="qg-header">
        <CardTitle>
          <Shield size={14} aria-hidden /> Quality gates
        </CardTitle>
        <Tag variant={passing === gates.length ? 'success' : passing > 0 ? 'warning' : 'error'}>
          {passing}/{gates.length} passing
        </Tag>
      </div>
      <CardMeta>
        L09 rubric (Correctness / Arch compliance / Test coverage / Verification evidence) —{' '}
        {plan ? `evaluating against plan with ${plan.steps.length} steps.` : 'awaiting plan.'}
      </CardMeta>
      <ul className="qg-list" data-testid="quality-gates-list">
        {gates.map((gate) => (
          <li
            key={gate.name}
            className={`qg-row is-${gate.status}`}
            data-testid="quality-gates-row"
            data-status={gate.status}
          >
            <div className="qg-row-head">
              <GateIcon status={gate.status} />
              <span className="qg-name">{gate.name}</span>
              <GateTag status={gate.status} />
            </div>
            <div className="qg-row-body">
              <span className="qg-detail">{gate.detail}</span>
              {typeof gate.value === 'number' && (
                <span className="qg-threshold">
                  current: {gate.value}% · threshold: {gate.threshold}%
                </span>
              )}
              {typeof gate.value === 'boolean' && (
                <span className="qg-threshold">
                  current: {String(gate.value)} · threshold: {String(gate.threshold)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default QualityGates;