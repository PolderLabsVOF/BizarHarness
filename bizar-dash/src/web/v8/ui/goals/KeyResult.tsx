import { type ReactNode } from 'react';
import { CheckCircle2, Circle, Minus } from 'lucide-react';
import { cx } from '../utils/cx.js';
import { ProgressBar } from '../data/ProgressBar.js';

/**
 * KeyResult — a measurable sub-goal inside a Goal.
 *
 * Renders title + progress + status icon + optional metric caption
 * (e.g. "47 / 100 tasks completed").
 */

export type KeyResultStatus = 'done' | 'in-progress' | 'not-started';

export interface KeyResultProps {
  id: string;
  title: string;
  status: KeyResultStatus;
  /** 0..1 fractional progress. */
  progress: number;
  /** Optional metric caption (e.g. "47 / 100"). */
  metric?: ReactNode;
  /** Optional assignee name. */
  assignee?: string;
  onToggle?: () => void;
  className?: string;
}

const STATUS_ICON = {
  done: CheckCircle2,
  'in-progress': Minus,
  'not-started': Circle,
} as const;

const STATUS_FG = {
  done: 'var(--success)',
  'in-progress': 'var(--info)',
  'not-started': 'var(--fg-subtle)',
} as const;

export function KeyResult(props: KeyResultProps) {
  const { title, status, progress, metric, assignee, onToggle, className } = props;
  const Icon = STATUS_ICON[status];
  return (
    <div
      className={cx('v8-key-result', `v8-key-result--${status}`, className)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={status === 'done' ? 'Mark as not done' : 'Mark as done'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          marginTop: 2,
          padding: 0,
          background: 'transparent',
          border: 0,
          borderRadius: 'var(--radius-sm)',
          color: STATUS_FG[status],
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--fs-13)',
            color: status === 'done' ? 'var(--fg-muted)' : 'var(--fg)',
            fontWeight: 500,
            textDecoration: status === 'done' ? 'line-through' : 'none',
            lineHeight: 'var(--lh-snug)',
          }}
        >
          {title}
        </div>
        {status !== 'not-started' && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <ProgressBar value={progress} tone={status === 'done' ? 'success' : 'accent'} height={4} />
          </div>
        )}
        {(metric !== undefined || assignee !== undefined) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              marginTop: 6,
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-subtle)',
            }}
          >
            {metric !== undefined && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{metric}</span>}
            {assignee !== undefined && <span>@{assignee}</span>}
          </div>
        )}
      </div>
    </div>
  );
}