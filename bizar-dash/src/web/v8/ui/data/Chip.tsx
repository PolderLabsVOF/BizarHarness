import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Chip — filter pill with an optional remove button.
 *
 * Different from Badge: Badge is a status indicator (read-only).
 * Chip is interactive — clickable for selection, removable for filters.
 */

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual tone. */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
  /** When true, render with selected styling (used for filter chips). */
  selected?: boolean;
  /** When provided, render a close button that invokes this handler. */
  onRemove?: () => void;
  children: ReactNode;
}

const TONE_BG: Record<NonNullable<ChipProps['tone']>, string> = {
  neutral: 'var(--surface-1)',
  info: 'color-mix(in oklch, var(--info) 14%, var(--surface-1))',
  success: 'color-mix(in oklch, var(--success) 14%, var(--surface-1))',
  warning: 'color-mix(in oklch, var(--warning) 14%, var(--surface-1))',
  danger: 'color-mix(in oklch, var(--danger) 14%, var(--surface-1))',
  accent: 'color-mix(in oklch, var(--accent) 14%, var(--surface-1))',
};

const TONE_BORDER: Record<NonNullable<ChipProps['tone']>, string> = {
  neutral: 'var(--border)',
  info: 'color-mix(in oklch, var(--info) 30%, var(--border))',
  success: 'color-mix(in oklch, var(--success) 30%, var(--border))',
  warning: 'color-mix(in oklch, var(--warning) 30%, var(--border))',
  danger: 'color-mix(in oklch, var(--danger) 30%, var(--border))',
  accent: 'color-mix(in oklch, var(--accent) 30%, var(--border))',
};

export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(props, ref) {
  const { tone = 'neutral', selected, onRemove, children, className, style, ...rest } = props;
  const isInteractive = selected !== undefined || onRemove !== undefined;
  return (
    <span
      ref={ref}
      className={cx('v8-chip', `v8-chip--${tone}`, selected === true && 'is-selected', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        height: 24,
        padding: '0 8px',
        background: selected === true ? `color-mix(in oklch, var(--accent) 18%, var(--surface-1))` : TONE_BG[tone],
        border: '1px solid',
        borderColor: selected === true ? 'var(--accent)' : TONE_BORDER[tone],
        borderRadius: 'var(--radius-pill)',
        fontSize: 'var(--fs-12)',
        fontWeight: 500,
        color: selected === true ? 'var(--accent)' : 'var(--fg)',
        cursor: isInteractive === true ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {children}
      {onRemove !== undefined && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            marginLeft: 2,
            marginRight: -4,
            padding: 0,
            background: 'transparent',
            border: 0,
            borderRadius: 'var(--radius-sm)',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={10} aria-hidden="true" />
        </button>
      )}
    </span>
  );
});