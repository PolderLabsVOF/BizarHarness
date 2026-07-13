// tests/goal-input.test.tsx — F-036 Goal Planner UI.
// Renders the GoalInput textarea + submit, mocks the API client,
// and verifies the planner endpoint is called with the trimmed
// goal text.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../src/web/components/Toast';
import { GoalInput } from '../src/web/components/goals/GoalInput';
import type { Plan } from '../src/web/lib/goapPlanner';

const mockApiPost = vi.fn();

vi.mock('../src/web/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

function makePlan(): Plan {
  return {
    id: 'plan_test',
    goal: 'Build it',
    steps: [
      { id: 's1', action: 'build', title: 'Build', agent: 'Thor', description: 'Build.', effects: ['artifact_built'], deps: [], status: 'pending', estimatedCost: 3, estimatedDurationMs: 120000 },
    ],
    totalCost: 3,
    totalDurationMs: 120000,
    goalEffects: ['artifact_built'],
  };
}

function wrap(node: React.ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

beforeEach(() => {
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue(makePlan());
});

describe('GoalInput', () => {
  it('renders a textarea and a submit button', () => {
    render(wrap(<GoalInput />));
    expect(screen.getByTestId('goal-input-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('goal-input-submit')).toBeInTheDocument();
    expect(screen.getByTestId('goal-input-counter').textContent).toMatch(/0 \/ 4000/);
  });

  it('submits the trimmed goal to the planner endpoint and emits the plan', async () => {
    const user = userEvent.setup();
    const onPlan = vi.fn();
    render(wrap(<GoalInput onPlan={onPlan} />));
    const textarea = screen.getByTestId('goal-input-textarea');
    await user.type(textarea, '   Research quantum.   ');
    const submit = screen.getByTestId('goal-input-submit');
    await user.click(submit);
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));
    expect(mockApiPost).toHaveBeenCalledWith('/goal-planner/plan', { goal: 'Research quantum.' });
    await waitFor(() => expect(onPlan).toHaveBeenCalledTimes(1));
    expect(onPlan.mock.calls[0][0].id).toBe('plan_test');
  });

  it('does not submit when the textarea is empty', async () => {
    const user = userEvent.setup();
    render(wrap(<GoalInput />));
    const submit = screen.getByTestId('goal-input-submit');
    expect(submit).toBeDisabled();
    await user.click(submit).catch(() => undefined);
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});