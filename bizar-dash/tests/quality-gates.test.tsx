// tests/quality-gates.test.tsx — F-036 Goal Planner UI.
// Renders the QualityGates panel with empty, single, and multi
// metrics so the pass/warn/fail logic is observable.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QualityGates } from '../src/web/components/agents/QualityGates';

const baseMetrics = {
  compileCheck: false,
  testCoverage: 0,
  archScore: 0,
  evidencePresent: false,
};

describe('QualityGates', () => {
  it('renders four gate rows when metrics are empty', () => {
    render(<QualityGates plan={null} metrics={baseMetrics} />);
    const rows = screen.getAllByTestId('quality-gates-row');
    expect(rows.length).toBe(4);
    // None of the gates should be passing on a fresh install.
    expect(rows.every((r) => r.getAttribute('data-status') !== 'passed')).toBe(true);
  });

  it('renders all gates as passing when metrics are at threshold', () => {
    render(
      <QualityGates
        plan={null}
        metrics={{
          compileCheck: true,
          testCoverage: 85,
          archScore: 92,
          evidencePresent: true,
        }}
      />,
    );
    const rows = screen.getAllByTestId('quality-gates-row');
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.getAttribute('data-status') === 'passed')).toBe(true);
  });

  it('renders mixed pass/warn/fail when metrics are heterogeneous', () => {
    render(
      <QualityGates
        plan={null}
        metrics={{
          compileCheck: true,
          testCoverage: 65, // warning
          archScore: 50, // failed
          evidencePresent: false,
        }}
      />,
    );
    const rows = screen.getAllByTestId('quality-gates-row');
    const statuses = rows.map((r) => r.getAttribute('data-status'));
    expect(statuses).toContain('passed');
    expect(statuses).toContain('warning');
    expect(statuses).toContain('failed');
  });
});