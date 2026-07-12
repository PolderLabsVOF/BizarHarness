import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Badge — small status pill.
 *
 * Tones: neutral | info | success | warning | danger | accent.
 * Sizes: sm (16px) | md (20px).
 * Optional `dot` renders a leading colored dot.
 */
export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
}

const TONE_FG: Record<BadgeTone, string> = {
  neutral: 'var(--fg-muted)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

const TONE_BG: Record<BadgeTone, string> = {
  neutral: 'color-mix(in oklch, var(--fg-muted) 12%, transparent)',
  info: 'color-mix(in oklch, var(--info) 14%, transparent)',
  success: 'color-mix(in oklch, var(--success) 14%, transparent)',
  warning: 'color-mix(in oklch, var(--warning) 14%, transparent)',
  danger: 'color-mix(in oklch, var(--danger) 14%, transparent)',
  accent: 'color-mix(in oklch, var(--accent) 14%, transparent)',
};

const TONE_DOT: Record<BadgeTone, string> = {
  neutral: 'var(--fg-muted)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(props, ref) {
  const { tone = 'neutral', size = 'md', dot, children, className, style, ...rest } = props;
  const height = size === 'sm' ? 18 : 22;
  return (
    <span
      ref={ref}
      className={cx('v8-badge', `v8-badge--${tone}`, `v8-badge--${size}`, className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        height,
        padding: '0 8px',
        borderRadius: 'var(--radius-pill)',
        background: TONE_BG[tone],
        color: TONE_FG[tone],
        fontSize: size === 'sm' ? 'var(--fs-12)' : 'var(--fs-13)',
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot === true && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--radius-pill)',
            background: TONE_DOT[tone],
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
});