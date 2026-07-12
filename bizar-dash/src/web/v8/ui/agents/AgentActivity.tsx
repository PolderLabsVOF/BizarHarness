import { forwardRef, type OlHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * AgentActivity — per-agent feed of recent actions (run started, tool
 * called, message received, etc).
 *
 * Used inside the Agent detail view.
 */

export interface AgentActivityItem {
  id: string;
  /** Icon (lucide). */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export interface AgentActivityProps extends OlHTMLAttributes<HTMLOListElement> {
  items: readonly AgentActivityItem[];
}

const TONE_BG = {
  neutral: 'var(--fg-subtle)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
} as const;

export const AgentActivity = forwardRef<HTMLOListElement, AgentActivityProps>(function AgentActivity(
  props,
  ref,
) {
  const { items, className, ...rest } = props;
  return (
    <ol
      ref={ref}
      className={cx('v8-agent-activity', className)}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
      {...rest}
    >
      {items.map((item) => {
        const tone = item.tone ?? 'neutral';
        return (
          <li
            key={item.id}
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
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: 'var(--radius-sm)',
                background: `color-mix(in oklch, ${TONE_BG[tone]} 14%, transparent)`,
                color: TONE_BG[tone],
                flexShrink: 0,
              }}
            >
              {item.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--fg)' }}>{item.title}</div>
                {item.meta !== undefined && (
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)', flexShrink: 0 }}>{item.meta}</div>
                )}
              </div>
              {item.description !== undefined && (
                <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 2 }}>
                  {item.description}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
});