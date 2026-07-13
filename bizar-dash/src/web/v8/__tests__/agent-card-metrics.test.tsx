/**
 * v9.4.0 S45 — agent-card-metrics.test.tsx
 *
 * Verifies AgentCard renders the three metric rows (tasks, success,
 * lastSeen) when the corresponding props are supplied, and renders
 * nothing extra when they're not. Replaces the dead sparkline branch.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentCard } from '../ui/agents/AgentCard';

describe('AgentCard metrics (v9.4.0)', () => {
  it('renders all three metric rows when supplied; no Sparkline', () => {
    const { container } = render(
      <AgentCard
        id="a1"
        name="Atlas"
        role="researcher"
        status="busy"
        tasksSucceeded={127}
        tasksTotal={142}
        successRate={0.89}
        lastSeenMs={Date.now() - 90_000}
      />,
    );
    expect(screen.getByText(/127\s*\/\s*142/)).toBeInTheDocument();
    expect(screen.getByText(/89%\s*success/i)).toBeInTheDocument();
    expect(screen.getByText(/1m ago|just now|2m ago/i)).toBeInTheDocument();
    // No sparkline element rendered
    expect(container.querySelector('.v8-sparkline')).toBeNull();
  });

  it('renders no metric rows when no metric props are supplied', () => {
    const { container } = render(
      <AgentCard id="a1" name="Atlas" role="r" status="idle" />,
    );
    expect(container.querySelector('[data-testid="agent-card-tasks"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-card-success"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-card-lastseen"]')).toBeNull();
  });

  it('tones success-rate badge by threshold: <0.5 danger, 0.5–0.79 warning, >=0.8 success', () => {
    const { rerender } = render(
      <AgentCard id="a1" name="A" role="r" status="busy" successRate={0.3} />,
    );
    expect(screen.getByTestId('agent-card-success-badge').className).toMatch(/v8-badge--danger/);

    rerender(<AgentCard id="a1" name="A" role="r" status="busy" successRate={0.6} />);
    expect(screen.getByTestId('agent-card-success-badge').className).toMatch(/v8-badge--warning/);

    rerender(<AgentCard id="a1" name="A" role="r" status="busy" successRate={0.95} />);
    expect(screen.getByTestId('agent-card-success-badge').className).toMatch(/v8-badge--success/);
  });
});