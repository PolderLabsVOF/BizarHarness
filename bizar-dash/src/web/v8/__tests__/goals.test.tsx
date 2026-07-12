import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalCard } from '../ui/goals/GoalCard';
import { KeyResult } from '../ui/goals/KeyResult';

describe('GoalCard', () => {
  it('renders title, description, status, and progress', () => {
    render(
      <GoalCard
        id="g1"
        title="Ship v8 dashboard"
        description="Rewrite the dashboard from scratch with a real component library."
        status="on-track"
        progress={0.42}
      />,
    );
    expect(screen.getByText(/Ship v8 dashboard/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Rewrite the dashboard from scratch with a real component library\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/on track/i)).toBeInTheDocument();
    expect(screen.getByText(/42% complete/i)).toBeInTheDocument();
  });

  it('shows key results counter when provided', () => {
    render(
      <GoalCard
        id="g1"
        title="g"
        status="at-risk"
        progress={0.2}
        keyResultsDone={2}
        keyResultsTotal={5}
      />,
    );
    expect(screen.getByText(/2 \/ 5 key results/i)).toBeInTheDocument();
  });

  it('shows due + owner labels', () => {
    render(
      <GoalCard
        id="g1"
        title="g"
        status="on-track"
        progress={0.1}
        due="Q3 2026"
        ownerName="alex"
      />,
    );
    expect(screen.getByText(/Q3 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/alex/i)).toBeInTheDocument();
  });

  it('invokes onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<GoalCard id="g1" title="g" status="on-track" progress={0} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /g/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders done status without progress display errors', () => {
    render(<GoalCard id="g1" title="Shipped" status="done" progress={1} />);
    expect(screen.getByText(/100% complete/i)).toBeInTheDocument();
  });
});

describe('KeyResult', () => {
  it('renders title with status icon and toggles on click', async () => {
    const onToggle = vi.fn();
    render(
      <KeyResult id="kr1" title="Publish RFC" status="in-progress" progress={0.5} onToggle={onToggle} />,
    );
    expect(screen.getByText(/publish rfc/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /mark as done/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the "mark as not done" label when status is done', () => {
    render(<KeyResult id="kr1" title="Done thing" status="done" progress={1} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /mark as not done/i })).toBeInTheDocument();
  });

  it('hides the progress bar when not-started', () => {
    const { container } = render(
      <KeyResult id="kr1" title="Plan ahead" status="not-started" progress={0} />,
    );
    expect(container.querySelector('.v8-progress')).toBeNull();
  });

  it('shows metric and assignee captions', () => {
    render(
      <KeyResult
        id="kr1"
        title="metric kr"
        status="in-progress"
        progress={0.47}
        metric="47 / 100"
        assignee="sam"
      />,
    );
    expect(screen.getByText(/47 \/ 100/i)).toBeInTheDocument();
    expect(screen.getByText(/@sam/i)).toBeInTheDocument();
  });
});