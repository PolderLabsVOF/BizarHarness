// tests/dep-graph.test.tsx — F-036 Goal Planner UI.
// Renders the DependencyGraph component with and without a plan.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DependencyGraph } from '../src/web/components/agents/DependencyGraph';
import type { Plan } from '../src/web/lib/goapPlanner';

function makePlan(): Plan {
  return {
    id: 'plan_x',
    goal: 'Build it, test it, deploy it.',
    steps: [
      { id: 's1', action: 'build', title: 'Build the artifact', agent: 'Thor', description: 'Construct the artifact end-to-end.', effects: ['artifact_built'], deps: [], status: 'pending', estimatedCost: 3, estimatedDurationMs: 120000 },
      { id: 's2', action: 'test', title: 'Run the tests', agent: 'Forseti', description: 'Run the test suite.', effects: ['tests_passing'], deps: ['s1'], status: 'pending', estimatedCost: 2, estimatedDurationMs: 60000 },
      { id: 's3', action: 'deploy', title: 'Deploy to production', agent: 'Heimdall', description: 'Promote the artifact to production.', effects: ['deployed'], deps: ['s2'], status: 'pending', estimatedCost: 2, estimatedDurationMs: 60000 },
    ],
    totalCost: 7,
    totalDurationMs: 240000,
    goalEffects: ['artifact_built', 'tests_passing', 'deployed'],
  };
}

describe('DependencyGraph', () => {
  it('renders an empty-state card when no plan is supplied', () => {
    render(<DependencyGraph plan={null} />);
    expect(screen.getByTestId('dep-graph')).toBeInTheDocument();
    expect(screen.getByText(/Submit a goal/i)).toBeInTheDocument();
  });

  it('renders the canvas when a plan is supplied', () => {
    render(<DependencyGraph plan={makePlan()} />);
    expect(screen.getByTestId('dep-graph-canvas')).toBeInTheDocument();
  });

  it('renders three step nodes when a three-step plan is supplied', () => {
    render(<DependencyGraph plan={makePlan()} />);
    const nodes = document.querySelectorAll('.dep-node');
    expect(nodes.length).toBe(3);
  });
});