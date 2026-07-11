// src/web/components/goals/GoalInput.tsx — plain-English goal input.
//
// v6.4.0 — F-036 (Goal Planner UI). Free-form textarea + submit
// button. The submit fires a POST to /api/goal-planner/plan and
// returns the resulting Plan to the parent via onSubmit(plan).
import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '../Button';
import { api } from '../../lib/api';
import { useToast } from '../Toast';
import type { Plan } from '../../lib/goapPlanner';

interface Props {
  onPlan?: (plan: Plan) => void;
  /** Optional: when true, the input renders in compact (toolbar) mode. */
  compact?: boolean;
}

const MAX_CHARS = 4000;

export function GoalInput({ onPlan, compact = false }: Props) {
  const toast = useToast();
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = goal.trim();
    if (!trimmed) {
      toast.error('Enter a goal first.');
      return;
    }
    if (trimmed.length > MAX_CHARS) {
      toast.error(`Goal must be ${MAX_CHARS} chars or fewer.`);
      return;
    }
    setSubmitting(true);
    try {
      const plan = await api.post<Plan>('/goal-planner/plan', { goal: trimmed });
      if (onPlan) onPlan(plan);
      toast.success(`Plan generated: ${plan.steps.length} steps.`);
    } catch (err) {
      const msg = (err as Error)?.message || 'Planner failed';
      toast.error(`Planner failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`goal-input${compact ? ' goal-input-compact' : ''}`}>
      <label className="goal-input-label" htmlFor="goal-input-textarea">
        <Sparkles size={14} aria-hidden />
        Plain-English goal
      </label>
      <textarea
        id="goal-input-textarea"
        className="goal-input-textarea"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="e.g. Research the latest advancements in quantum computing, then design and build a small demo, test it, and document the result."
        disabled={submitting}
        maxLength={MAX_CHARS}
        rows={compact ? 3 : 5}
        data-testid="goal-input-textarea"
      />
      <div className="goal-input-footer">
        <span className="goal-input-counter" data-testid="goal-input-counter">
          {goal.length} / {MAX_CHARS}
        </span>
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          loading={submitting}
          disabled={submitting || !goal.trim()}
          data-testid="goal-input-submit"
        >
          <Send size={14} aria-hidden />
          {submitting ? 'Planning…' : 'Generate plan'}
        </Button>
      </div>
    </div>
  );
}

export default GoalInput;