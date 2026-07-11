// src/web/components/goals/PlanVisualization.tsx — collapsible action tree.
//
// v6.4.0 — F-036 (Goal Planner UI). Renders the A* plan as a list of
// collapsible steps. Each step shows action, agent, deps, cost,
// and a click-to-expand description.
import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, GitBranch } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../Card';
import { Tag } from '../Tag';
import { cn } from '../../lib/utils';
import type { Plan, PlannedStep } from '../../lib/goapPlanner';

interface Props {
  plan: Plan | null;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function PlanVisualization({ plan }: Props) {
  if (!plan) {
    return (
      <Card className="plan-visualization">
        <CardTitle>Execution plan</CardTitle>
        <CardMeta>Submit a goal to generate a plan.</CardMeta>
      </Card>
    );
  }

  return (
    <Card className="plan-visualization" data-testid="plan-visualization">
      <div className="plan-viz-header">
        <CardTitle>
          <GitBranch size={14} aria-hidden /> Execution plan
        </CardTitle>
        <div className="plan-viz-badges">
          <Tag variant="info">{plan.steps.length} steps</Tag>
          <Tag variant="accent">Cost {plan.totalCost}</Tag>
          <Tag variant="success">
            <Clock size={10} aria-hidden /> {formatDuration(plan.totalDurationMs)}
          </Tag>
        </div>
      </div>
      <CardMeta className="plan-viz-goal">Goal: {plan.goal}</CardMeta>
      <ol className="plan-viz-tree" role="tree">
        {plan.steps.map((step) => (
          <PlanStepRow key={step.id} step={step} />
        ))}
      </ol>
    </Card>
  );
}

function PlanStepRow({ step }: { step: PlannedStep }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="plan-viz-row" role="treeitem" aria-expanded={open}>
      <button
        type="button"
        className="plan-viz-row-head"
        onClick={() => setOpen((v) => !v)}
        data-testid={`plan-step-${step.id}`}
      >
        <span className="plan-viz-chevron">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </span>
        <span className={cn('plan-viz-action', `is-${step.action}`)}>{step.action}</span>
        <span className="plan-viz-title">{step.title}</span>
        <span className="plan-viz-agent">@{step.agent}</span>
        <span className="plan-viz-cost">{step.estimatedCost}</span>
      </button>
      {open && (
        <div className="plan-viz-row-body" data-testid={`plan-step-${step.id}-body`}>
          <p>{step.description}</p>
          {step.deps.length > 0 && (
            <div className="plan-viz-deps">
              <strong>Deps:</strong>
              <ul>
                {step.deps.map((d) => (
                  <li key={d}>
                    <code>{d}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="plan-viz-effects">
            <strong>Effects:</strong>
            <ul>
              {step.effects.map((e) => (
                <li key={e}>
                  <code>{e}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

export default PlanVisualization;