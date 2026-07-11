// src/web/components/agents/RoutingDecisions.tsx —
// F-035 (MetaHarness) — 3-tier model routing transparency panel.
//
// Mirrors ruflo's [CODEMOD_AVAILABLE] / [TASK_MODEL_RECOMMENDATION]
// convention (see goal_ui/src/components/agents/ExecutionMonitor.tsx).
// Renders the most recent routing decisions emitted on the WS
// `routing:decision` channel with a tier badge (CODEMOD/TIER1/TIER2/TIER3)
// plus model + cost + latency columns.
//
// Tier color scheme (per spec):
//   CODEMOD → green   ($0 deterministic codemod intent)
//   TIER1   → blue    (model)
//   TIER2   → yellow  (model)
//   TIER3   → red     (frontier model)
//
// Pure functional React. No class components. Vanilla CSS via the
// existing main.css (.routing-decisions, .routing-tier-* classes).

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { RoutingDecision, RoutingTier, WsMessage } from '../../lib/types';

export type RoutingDecisionsProps = {
  /** Optional WebSocket subscription target. */
  subscribe?: (handler: (msg: WsMessage) => void) => () => void;
  /** Initial seed for tests / preview. */
  initial?: RoutingDecision[];
  /** Cap on visible rows (default 50). Older rows are pruned first. */
  maxRows?: number;
  /** Tier filter — undefined = all tiers. */
  filterTier?: RoutingTier | 'ALL';
  /** Compact (single-row) layout toggle. */
  compact?: boolean;
  /** Test-only callback when a decision is appended. */
  onAppend?: (d: RoutingDecision) => void;
};

const TIER_ORDER: RoutingTier[] = ['CODEMOD', 'TIER1', 'TIER2', 'TIER3'];

function tierClass(tier: RoutingTier): string {
  switch (tier) {
    case 'CODEMOD': return 'routing-tier routing-tier-codemod';
    case 'TIER1':   return 'routing-tier routing-tier-1';
    case 'TIER2':   return 'routing-tier routing-tier-2';
    case 'TIER3':   return 'routing-tier routing-tier-3';
    default:        return 'routing-tier';
  }
}

function formatCost(c: number | undefined): string {
  if (c == null || !Number.isFinite(c)) return '—';
  if (c === 0) return '$0';
  if (c < 0.0001) return '<$0.0001';
  if (c < 1)     return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function formatLatency(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

export function RoutingDecisions(props: RoutingDecisionsProps) {
  const {
    subscribe,
    initial,
    maxRows = 50,
    filterTier,
    compact = false,
    onAppend,
  } = props;

  const [decisions, setDecisions] = useState<RoutingDecision[]>(() =>
    Array.isArray(initial) ? initial.slice(0, maxRows) : [],
  );

  const onAppendRef = useRef(onAppend);
  useEffect(() => { onAppendRef.current = onAppend; }, [onAppend]);

  const handle = useCallback((msg: WsMessage) => {
    if (msg.type !== 'routing:decision') return;
    const d = msg.decision;
    if (!d || !d.id || !d.tier) return;
    setDecisions((cur) => {
      const next = [d, ...cur.filter((x) => x.id !== d.id)];
      if (next.length > maxRows) next.length = maxRows;
      return next;
    });
    onAppendRef.current?.(d);
  }, [maxRows]);

  // Wire up the WS subscription if one is provided.
  useEffect(() => {
    if (typeof subscribe !== 'function') return undefined;
    return subscribe(handle);
  }, [subscribe, handle]);

  const visible = useMemo(() => {
    if (!filterTier || filterTier === 'ALL') return decisions;
    return decisions.filter((d) => d.tier === filterTier);
  }, [decisions, filterTier]);

  // ── Empty state ──────────────────────────────────────────────────
  if (decisions.length === 0) {
    return (
      <div className="routing-decisions routing-decisions-empty" data-testid="routing-decisions-empty">
        <div className="routing-decisions-empty-title">No routing decisions yet</div>
        <div className="routing-decisions-empty-hint">
          When the SDK emits a <code>routing:decision</code> event, the
          most recent <strong>{maxRows}</strong> will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? 'routing-decisions routing-decisions-compact' : 'routing-decisions'} data-testid="routing-decisions">
      <table className="routing-decisions-table" role="table">
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col">Model</th>
            <th scope="col">Task</th>
            <th scope="col">Cost</th>
            <th scope="col">Latency</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((d) => (
            <tr key={d.id} data-testid={`routing-row-${d.id}`} className="routing-row">
              <td>
                <span className={tierClass(d.tier)} title={TIER_ORDER.includes(d.tier) ? `Tier ${d.tier}` : d.tier}>
                  {d.tier}
                </span>
              </td>
              <td className="routing-model" title={d.model}>{d.model}</td>
              <td className="routing-task">{d.task || '—'}</td>
              <td className="routing-cost">{formatCost(d.costUsd)}</td>
              <td className="routing-latency">{formatLatency(d.latencyMs)}</td>
              <td className="routing-time" title={String(d.ts)}>{formatTime(d.ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default RoutingDecisions;
