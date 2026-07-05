// src/components/EvalDiff.tsx — v5.2.0
//
// Side-by-side comparison of two eval runs. Categorizes each fixture
// as improved / regressed / unchanged and renders a summary block plus
// a list of changed fixtures.
//
// `runA` is the "before" run (typically an older baseline); `runB` is
// the "after" run (typically the newer run under review).

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Per-fixture result row embedded in a run record. */
export type EvalFixtureResult = {
  fixtureId: string;
  ok: boolean;
  checks?: { kind: string; ok: boolean; message?: string }[];
  latencyMs?: number;
};

export type EvalRunWithResults = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  suitePath?: string;
  total: number;
  passed: number;
  failed: number;
  results: EvalFixtureResult[];
};

export type EvalDiffEntry = {
  fixtureId: string;
  /** The fixture's pass/fail status in the "before" run, or null if absent. */
  before: boolean | null;
  /** The fixture's pass/fail status in the "after" run, or null if absent. */
  after: boolean | null;
  /** Bucket label derived from before/after. */
  change: 'same' | 'improved' | 'regressed' | 'added' | 'removed';
};

export type EvalDiffProps = {
  runA: EvalRunWithResults;
  runB: EvalRunWithResults;
  /**
   * Optional override for the section heading. Defaults to
   * "Regression Analysis".
   */
  title?: string;
};

/**
 * Pure helper: compute the diff entries from two runs. Exported so
 * tests can exercise the categorization logic without rendering.
 */
export function computeEvalDiff(
  runA: EvalRunWithResults,
  runB: EvalRunWithResults,
): EvalDiffEntry[] {
  const mapA = new Map(runA.results.map((r) => [r.fixtureId, r]));
  const mapB = new Map(runB.results.map((r) => [r.fixtureId, r]));
  const ids = new Set<string>([...mapA.keys(), ...mapB.keys()]);

  const out: EvalDiffEntry[] = [];
  for (const id of ids) {
    const a = mapA.get(id);
    const b = mapB.get(id);
    const before = a ? a.ok : null;
    const after = b ? b.ok : null;

    let change: EvalDiffEntry['change'];
    if (a && b) {
      if (before === after) change = 'same';
      else if (before === false && after === true) change = 'improved';
      else change = 'regressed';
    } else if (b && !a) {
      change = 'added';
    } else {
      change = 'removed';
    }

    out.push({ fixtureId: id, before, after, change });
  }
  // Stable sort: regressions first, then improvements, then others.
  const order: Record<EvalDiffEntry['change'], number> = {
    regressed: 0,
    improved: 1,
    added: 2,
    removed: 3,
    same: 4,
  };
  out.sort((x, y) => {
    const d = order[x.change] - order[y.change];
    if (d !== 0) return d;
    return x.fixtureId.localeCompare(y.fixtureId);
  });
  return out;
}

export function EvalDiff({ runA, runB, title = 'Regression Analysis' }: EvalDiffProps): ReactNode {
  const diff = computeEvalDiff(runA, runB);

  const improved = diff.filter((d) => d.change === 'improved').length;
  const regressed = diff.filter((d) => d.change === 'regressed').length;
  const unchanged = diff.filter((d) => d.change === 'same').length;
  const changed = diff.filter((d) => d.change !== 'same');

  return (
    <div className="eval-diff" data-testid="eval-diff">
      <h3 className="eval-diff-title">{title}</h3>
      <div className="eval-diff-subtitle muted">
        Comparing <code className="mono">{runA.id}</code> →{' '}
        <code className="mono">{runB.id}</code>
      </div>

      <div className="eval-diff-stats" aria-label="Diff summary">
        <span className="eval-diff-stat improved">
          <span className="eval-diff-stat-icon" aria-hidden>+</span>
          {improved} improved
        </span>
        <span className="eval-diff-stat regressed">
          <span className="eval-diff-stat-icon" aria-hidden>−</span>
          {regressed} regressed
        </span>
        <span className="eval-diff-stat unchanged muted">
          {unchanged} unchanged
        </span>
      </div>

      {changed.length === 0 ? (
        <p className="eval-diff-empty muted">No fixture-level changes between these runs.</p>
      ) : (
        <ul className="eval-diff-list" role="list">
          {changed.map((d) => (
            <li
              key={d.fixtureId}
              data-fixture-id={d.fixtureId}
              className={cn('eval-diff-row', `is-${d.change}`)}
            >
              <span className="eval-diff-fixture mono">{d.fixtureId}</span>
              <span className="eval-diff-arrow" aria-hidden>→</span>
              <span className="eval-diff-states">
                <span className={cn('eval-diff-state', d.before ? 'is-pass' : 'is-fail')}>
                  {d.before === null ? '—' : d.before ? 'pass' : 'fail'}
                </span>
                <span className="eval-diff-arrow-small" aria-hidden>→</span>
                <span className={cn('eval-diff-state', d.after ? 'is-pass' : 'is-fail')}>
                  {d.after === null ? '—' : d.after ? 'pass' : 'fail'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}