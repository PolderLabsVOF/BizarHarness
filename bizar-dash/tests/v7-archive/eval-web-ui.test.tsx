// tests/eval-web-ui.test.tsx — v5.2.0
//
// Tests for the eval framework web UI components:
//   - EvalRunCard: pass/total rendering, status pill (pass/warn/fail)
//   - EvalDiff: categorize fixtures as improved/regressed/unchanged
//
// We render with @testing-library/react in jsdom and assert on the
// status pill text + class list.

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EvalRunCard, type EvalRunSummary } from '../src/web/components/EvalRunCard';
import { EvalDiff, computeEvalDiff, type EvalRunWithResults } from '../src/web/components/EvalDiff';

const BASE_RUN: EvalRunSummary = {
  id: 'run_2026-07-05_a1b2',
  startedAt: '2026-07-05T10:00:00.000Z',
  finishedAt: '2026-07-05T10:01:00.000Z',
  suitePath: '/tmp/fixtures',
  total: 10,
  passed: 10,
  failed: 0,
};

describe('EvalRunCard', () => {
  it('renders the run id and suite path', () => {
    render(<EvalRunCard run={BASE_RUN} />);
    expect(screen.getByText(BASE_RUN.id)).toBeInTheDocument();
    // The card meta includes the suite path. The format helper prepends
    // a formatted timestamp, so we look for the suite path fragment.
    expect(screen.getByText(/fixtures/)).toBeInTheDocument();
  });

  it('renders the pass count and total in the status pill', () => {
    render(<EvalRunCard run={BASE_RUN} />);
    expect(screen.getByText('10/10 (100.0%)')).toBeInTheDocument();
  });

  it('uses the "pass" status when failed === 0', () => {
    const { container } = render(<EvalRunCard run={BASE_RUN} />);
    const pill = container.querySelector('.eval-status');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveClass('is-pass');
    expect(pill).not.toHaveClass('is-warn');
    expect(pill).not.toHaveClass('is-fail');
  });

  it('uses the "warn" status when pass rate is between 0.8 and 1.0', () => {
    const run: EvalRunSummary = { ...BASE_RUN, total: 10, passed: 9, failed: 1 };
    const { container } = render(<EvalRunCard run={run} />);
    const pill = container.querySelector('.eval-status');
    expect(pill).toHaveClass('is-warn');
    expect(screen.getByText('9/10 (90.0%)')).toBeInTheDocument();
  });

  it('uses the "fail" status when pass rate is at or below 0.8', () => {
    const run: EvalRunSummary = { ...BASE_RUN, total: 10, passed: 7, failed: 3 };
    const { container } = render(<EvalRunCard run={run} />);
    const pill = container.querySelector('.eval-status');
    expect(pill).toHaveClass('is-fail');
    expect(screen.getByText('7/10 (70.0%)')).toBeInTheDocument();
  });

  it('uses the "fail" status when there is any failure at all (10/10a vs 8/10b)', () => {
    // pass rate exactly 0.8 → still "fail" (the brief says strictly > 0.8)
    const run: EvalRunSummary = { ...BASE_RUN, total: 10, passed: 8, failed: 2 };
    const { container } = render(<EvalRunCard run={run} />);
    expect(container.querySelector('.eval-status')).toHaveClass('is-fail');
  });

  it('renders 0/0 (0.0%) without crashing when total is zero', () => {
    const run: EvalRunSummary = { ...BASE_RUN, total: 0, passed: 0, failed: 0 };
    render(<EvalRunCard run={run} />);
    expect(screen.getByText('0/0 (0.0%)')).toBeInTheDocument();
  });

  it('marks the card as selected when selected=true', () => {
    const { container } = render(<EvalRunCard run={BASE_RUN} selected />);
    const card = container.querySelector('.eval-run-card');
    expect(card).toHaveClass('eval-run-card-selected');
  });

  it('calls onClick when the card is clicked', () => {
    let clicked = false;
    const { container } = render(<EvalRunCard run={BASE_RUN} onClick={() => { clicked = true; }} />);
    const card = container.querySelector('.eval-run-card') as HTMLElement;
    card.click();
    expect(clicked).toBe(true);
  });
});

describe('EvalDiff — computeEvalDiff', () => {
  const runA: EvalRunWithResults = {
    id: 'run_a',
    startedAt: '2026-07-01T00:00:00Z',
    suitePath: '/tmp/fixtures',
    total: 3,
    passed: 2,
    failed: 1,
    results: [
      { fixtureId: 'f1', ok: false, latencyMs: 100 },
      { fixtureId: 'f2', ok: true, latencyMs: 120 },
      { fixtureId: 'f3', ok: true, latencyMs: 140 },
    ],
  };

  const runB: EvalRunWithResults = {
    id: 'run_b',
    startedAt: '2026-07-05T00:00:00Z',
    suitePath: '/tmp/fixtures',
    total: 3,
    passed: 3,
    failed: 0,
    results: [
      { fixtureId: 'f1', ok: true, latencyMs: 110 },
      { fixtureId: 'f2', ok: true, latencyMs: 115 },
      { fixtureId: 'f3', ok: true, latencyMs: 150 },
    ],
  };

  const runC: EvalRunWithResults = {
    ...runB,
    id: 'run_c',
    results: [
      { fixtureId: 'f1', ok: false, latencyMs: 110 },
      { fixtureId: 'f2', ok: true, latencyMs: 115 },
      { fixtureId: 'f3', ok: true, latencyMs: 150 },
    ],
  };

  it('identifies improvements (was failing, now passing)', () => {
    const diff = computeEvalDiff(runA, runB);
    const improved = diff.filter((d) => d.change === 'improved');
    expect(improved).toHaveLength(1);
    expect(improved[0].fixtureId).toBe('f1');
    expect(improved[0].before).toBe(false);
    expect(improved[0].after).toBe(true);
  });

  it('identifies regressions (was passing, now failing)', () => {
    const diff = computeEvalDiff(runB, runC);
    const regressed = diff.filter((d) => d.change === 'regressed');
    expect(regressed).toHaveLength(1);
    expect(regressed[0].fixtureId).toBe('f1');
    expect(regressed[0].before).toBe(true);
    expect(regressed[0].after).toBe(false);
  });

  it('lists unchanged fixtures separately', () => {
    const diff = computeEvalDiff(runA, runB);
    const unchanged = diff.filter((d) => d.change === 'same');
    expect(unchanged.map((d) => d.fixtureId).sort()).toEqual(['f2', 'f3']);
  });

  it('returns empty arrays for identical runs', () => {
    const diff = computeEvalDiff(runA, runA);
    const changed = diff.filter((d) => d.change !== 'same');
    expect(changed).toHaveLength(0);
  });
});

describe('EvalDiff — rendering', () => {
  const runA: EvalRunWithResults = {
    id: 'run_a',
    startedAt: '2026-07-01T00:00:00Z',
    suitePath: '/tmp/fixtures',
    total: 3,
    passed: 2,
    failed: 1,
    results: [
      { fixtureId: 'f1', ok: false, latencyMs: 100 },
      { fixtureId: 'f2', ok: true, latencyMs: 120 },
      { fixtureId: 'f3', ok: true, latencyMs: 140 },
    ],
  };

  const runB: EvalRunWithResults = {
    id: 'run_b',
    startedAt: '2026-07-05T00:00:00Z',
    suitePath: '/tmp/fixtures',
    total: 3,
    passed: 3,
    failed: 0,
    results: [
      { fixtureId: 'f1', ok: true, latencyMs: 110 },
      { fixtureId: 'f2', ok: true, latencyMs: 115 },
      { fixtureId: 'f4', ok: true, latencyMs: 200 },
    ],
  };

  it('renders the diff container with a heading', () => {
    render(<EvalDiff runA={runA} runB={runB} />);
    expect(screen.getByTestId('eval-diff')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Regression Analysis');
  });

  it('renders the improved/regressed/unchanged counters', () => {
    render(<EvalDiff runA={runA} runB={runB} />);
    // f1: false → true = improved
    // f2: true → true = unchanged
    // f3: true → true (only in A) → removed
    // f4: true (only in B) → added
    expect(screen.getByText(/1 improved/)).toBeInTheDocument();
    expect(screen.getByText(/0 regressed/)).toBeInTheDocument();
    expect(screen.getByText(/1 unchanged/)).toBeInTheDocument();
  });

  it('renders improved and regressed rows with their fixture ids', () => {
    render(<EvalDiff runA={runA} runB={runB} />);
    const improvedRow = screen.getByText('f1').closest('.eval-diff-row');
    expect(improvedRow).not.toBeNull();
    expect(improvedRow).toHaveClass('is-improved');
  });

  it('shows the empty state when no fixtures changed', () => {
    // Pass the same run for both A and B — no changes.
    render(<EvalDiff runA={runA} runB={runA} />);
    expect(screen.getByText(/No fixture-level changes/)).toBeInTheDocument();
  });
});