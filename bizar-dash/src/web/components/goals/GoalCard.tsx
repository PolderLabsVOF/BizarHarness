// src/components/goals/GoalCard.tsx
//
// v6.6.0 — F-041 reusable Goal card. Extracted from Goals.tsx so the
// view stays small and the card can be tested in isolation.
//
// Renders title, status pill, priority badge, owner, target date
// (relative), and a progress bar driven by the live `progress` prop.
// Action buttons (Edit / Archive / Refine / + Add task) are wired via
// the parent-supplied callbacks so the card itself stays dumb.

import { Calendar, User as UserIcon, Bot, Target } from 'lucide-react';
import { cn, formatRelative } from '../../lib/utils';
import type { Goal, GoalProgress } from '../../lib/types';

type Props = {
  goal: Goal;
  progress: GoalProgress;
  onEdit?: (goal: Goal) => void;
  onArchive?: (goal: Goal) => void;
  onRefine?: (goal: Goal) => void;
  onAddTask?: (goal: Goal) => void;
  onOpen?: (goal: Goal) => void;
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--error, #f85149)',
  normal: 'var(--info, #58a6ff)',
  low: 'var(--muted, #888)',
};

function relativeTarget(targetDate: string | null): string | null {
  if (!targetDate) return null;
  const now = Date.now();
  const t = new Date(targetDate).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = t - now;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.round(diffMs / day);
  if (days === 0) return 'today';
  if (days > 0) {
    if (days === 1) return 'in 1 day';
    if (days < 30) return `in ${days} days`;
    const months = Math.round(days / 30);
    return months === 1 ? 'in 1 month' : `in ${months} months`;
  }
  const ago = -days;
  if (ago === 1) return '1 day ago';
  if (ago < 30) return `${ago} days ago`;
  const months = Math.round(ago / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export function GoalCard({
  goal,
  progress,
  onEdit,
  onArchive,
  onRefine,
  onAddTask,
  onOpen,
}: Props) {
  const status = goal.status || 'active';
  const target = relativeTarget(goal.targetDate || null);
  return (
    <div
      className={cn('goal-card', `goal-status-${status}`)}
      data-goal-id={goal.id}
      data-testid="goal-card"
    >
      <header className="goal-card-head">
        <span className={cn('goal-status-pill', `goal-pill-${status}`)}>
          {STATUS_LABEL[status] || status}
        </span>
        <span
          className="goal-priority-dot"
          style={{ background: PRIORITY_COLOR[goal.priority] || PRIORITY_COLOR.normal }}
          title={`Priority: ${goal.priority}`}
          aria-label={`Priority ${goal.priority}`}
        />
        <div className="goal-card-title-row">
          <Target size={14} aria-hidden />
          <h3 className="goal-card-title">{goal.title}</h3>
        </div>
        {onOpen && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onOpen(goal)}
            title="Open goal"
            aria-label="Open goal"
          >
            <Target size={12} />
          </button>
        )}
      </header>

      {goal.description && (
        <p className="goal-card-desc">{goal.description}</p>
      )}

      <div className="goal-card-meta">
        {goal.owner && (
          <span className="goal-card-meta-item" title={`Owner: ${goal.owner}`}>
            <Bot size={12} aria-hidden /> @{goal.owner}
          </span>
        )}
        {target && (
          <span className="goal-card-meta-item" title={`Target: ${goal.targetDate}`}>
            <Calendar size={12} aria-hidden /> {target}
          </span>
        )}
        {goal.parentGoalId && (
          <span className="goal-card-meta-item" title="Sub-goal">
            <UserIcon size={12} aria-hidden /> sub-goal
          </span>
        )}
      </div>

      <div className="goal-card-progress" data-testid="goal-card-progress">
        <div className="goal-card-progress-row">
          <span className="muted">
            {progress.done} / {progress.total} tasks
          </span>
          <span className="tabular-nums">{progress.percent}%</span>
        </div>
        <div
          className="goal-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-label={`${progress.percent}% complete`}
        >
          <div
            className="goal-progress-fill"
            style={{ width: `${progress.percent}%` }}
            data-testid="goal-progress-fill"
          />
        </div>
        {(progress.blocked > 0 || progress.archived > 0) && (
          <div className="muted text-xs">
            {progress.blocked > 0 && `${progress.blocked} blocked`}
            {progress.blocked > 0 && progress.archived > 0 && ' · '}
            {progress.archived > 0 && `${progress.archived} archived`}
          </div>
        )}
      </div>

      {(onEdit || onArchive || onRefine || onAddTask) && (
        <footer className="goal-card-actions">
          {onAddTask && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onAddTask(goal)}
              title="Add task linked to this goal"
              aria-label="Add task linked to this goal"
            >
              + task
            </button>
          )}
          {onRefine && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onRefine(goal)}
              title="Refine with AI"
              aria-label="Refine with AI"
            >
              AI
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onEdit(goal)}
              title="Edit goal"
              aria-label="Edit goal"
            >
              edit
            </button>
          )}
          {onArchive && status !== 'archived' && (
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              onClick={() => onArchive(goal)}
              title="Archive goal"
              aria-label="Archive goal"
            >
              archive
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

export default GoalCard;