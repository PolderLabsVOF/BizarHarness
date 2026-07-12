import { type ReactNode } from 'react';
import { Calendar, ChevronRight } from 'lucide-react';
import { cx } from '../utils/cx.js';
import { ProgressBar } from '../data/ProgressBar.js';
import { Badge } from '../data/Badge.js';

/**
 * GoalCard — long-horizon goal surface (PLAN.md: "Goals page").
 *
 * Goals are NOT kanban cards. They are intentional commitments tracked
 * over weeks/months. Each card shows: title, why (description), status,
 * progress, due, owner, key results count.
 */

export type GoalStatus = 'on-track' | 'at-risk' | 'off-track' | 'done';

export interface GoalCardProps {
  id: string;
  title: string;
  /** Why this goal matters (the "because"). */
  description?: string;
  status: GoalStatus;
  /** 0..1 fractional progress. */
  progress: number;
  /** Due date label (e.g. "Q3 2026", "Mar 31"). */
  due?: string;
  /** Owner name (renders as Avatar when paired with avatarUrl). */
  ownerName?: string;
  ownerAvatarUrl?: string;
  /** Key results count + done count (e.g. "3 / 5 key results"). */
  keyResultsDone?: number;
  keyResultsTotal?: number;
  /** Optional badges row (priority, tags). */
  badges?: ReactNode;
  /** Click handler — opens the goal detail. */
  onOpen?: () => void;
  className?: string;
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  'off-track': 'Off track',
  done: 'Done',
};

const STATUS_TONE: Record<GoalStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  'on-track': 'success',
  'at-risk': 'warning',
  'off-track': 'danger',
  done: 'neutral',
};

export function GoalCard(props: GoalCardProps) {
  const {
    title,
    description,
    status,
    progress,
    due,
    ownerName,
    ownerAvatarUrl,
    keyResultsDone,
    keyResultsTotal,
    badges,
    onOpen,
    className,
  } = props;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx('v8-goal-card', `v8-goal-card--${status}`, className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        width: '100%',
        padding: 'var(--space-4)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        transition: 'border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: 'var(--fg)', lineHeight: 'var(--lh-snug)' }}>
            {title}
          </div>
          {description !== undefined && (
            <div
              style={{
                fontSize: 'var(--fs-13)',
                color: 'var(--fg-muted)',
                marginTop: 4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </div>
          )}
        </div>
        <Badge tone={STATUS_TONE[status]} dot>
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      <div>
        <ProgressBar
          value={progress}
          tone={status === 'on-track' ? 'success' : status === 'at-risk' ? 'warning' : status === 'off-track' ? 'danger' : 'accent'}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{Math.round(progress * 100)}% complete</span>
          {keyResultsDone !== undefined && keyResultsTotal !== undefined && (
            <span>
              {keyResultsDone} / {keyResultsTotal} key results
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
          fontSize: 'var(--fs-12)',
          color: 'var(--fg-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {due !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} aria-hidden="true" />
              {due}
            </span>
          )}
          {ownerName !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 'var(--radius-pill)',
                  background: ownerAvatarUrl !== undefined ? `url(${ownerAvatarUrl}) center/cover` : 'var(--accent)',
                  display: 'inline-block',
                }}
              />
              {ownerName}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {badges}
          <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--fg-subtle)' }} />
        </div>
      </div>
      <style>{`
        .v8-goal-card:hover {
          border-color: var(--accent);
          background: var(--surface-2);
        }
      `}</style>
    </button>
  );
}