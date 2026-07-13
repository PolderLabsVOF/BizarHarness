// tests/goap-planner.test.ts — F-036 Goal Planner UI.
// Verifies the pure-TS A* planner: clause split, verb mapping,
// dependency link, total cost rollup.
import { describe, it, expect } from 'vitest';
import {
  planGoal,
  splitGoalClauses,
  extractVerb,
  clauseToAction,
  planDependencyEdges,
  type Plan,
} from '../src/web/lib/goapPlanner';

describe('goapPlanner — clauses', () => {
  it('splits a multi-clause goal on sentence boundaries', () => {
    const clauses = splitGoalClauses('Research quantum. Then build a demo. Finally deploy it.');
    expect(clauses.length).toBe(3);
  });

  it('extracts the leading verb after stripping polite prefixes', () => {
    expect(extractVerb('Research the topic')).toBe('research');
    expect(extractVerb('Please build it')).toBe('build');
    expect(extractVerb('We should test the change')).toBe('test');
  });

  it('maps known verbs to action templates with effects', () => {
    const t = clauseToAction('Deploy the artifact');
    expect(t.name).toBe('deploy');
    expect(t.effect).toBe('deployed');
  });
});

describe('goapPlanner — planGoal', () => {
  it('produces a plan with at least one step for a simple goal', () => {
    const plan = planGoal('Research quantum computing.');
    expect(plan.id.length).toBeGreaterThan(0);
    expect(plan.goal).toBe('Research quantum computing.');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.totalCost).toBeGreaterThan(0);
    expect(plan.totalDurationMs).toBeGreaterThan(0);
  });

  it('links dep steps via effect-to-id resolution', () => {
    const plan = planGoal('Design, build, test, and deploy the API.');
    // Build depends on design_drafted (from the design step).
    const build = plan.steps.find((s) => s.action === 'build' || s.action === 'implement');
    expect(build).toBeDefined();
    expect(build!.deps.length).toBeGreaterThan(0);
  });

  it('returns a plan whose dependency edges cover the dep list', () => {
    const plan: Plan = planGoal('Plan it, build it, test it.');
    const edges = planDependencyEdges(plan);
    expect(edges.length).toBeGreaterThan(0);
    // Every edge must reference a known step id.
    const ids = new Set(plan.steps.map((s) => s.id));
    for (const e of edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('caps step count at 8 to keep A* tractable', () => {
    const goal = 'Research. Investigate. Analyze. Plan. Design. Architect. Build. Implement. Create. Add. Test. Review. Document. Deploy. Commit. Publish.';
    const plan = planGoal(goal);
    expect(plan.steps.length).toBeLessThanOrEqual(8);
  });
});