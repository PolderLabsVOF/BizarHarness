import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Alert — inline contextual message.
 *
 * Tones: info | success | warning | danger.
 *
 * Use cases: empty states, inline help text, error banners inside forms.
 * For status pulses (topbar live indicator) use a small dot, not an Alert.
 */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
} as const;

const TONE_BG = {
  info: 'color-mix(in oklch, var(--info) 12%, var(--surface-1))',
  success: 'color-mix(in oklch, var(--success) 12%, var(--surface-1))',
  warning: 'color-mix(in oklch, var(--warning) 12%, var(--surface-1))',
  danger: 'color-mix(in oklch, var(--danger) 12%, var(--surface-1))',
} as const;

const TONE_FG = {
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
} as const;

const TONE_BORDER = {
  info: 'color-mix(in oklch, var(--info) 30%, var(--border))',
  success: 'color-mix(in oklch, var(--success) 30%, var(--border))',
  warning: 'color-mix(in oklch, var(--warning) 30%, var(--border))',
  danger: 'color-mix(in oklch, var(--danger) 30%, var(--border))',
} as const;

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Optional right-aligned action (button). */
  action?: ReactNode;
  /** Override the leading icon. Pass `false` to hide. */
  icon?: ReactNode | false;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(props, ref) {
  const { tone = 'info', title, children, action, icon, className, ...rest } = props;
  const showIcon = icon !== false;
  const IconNode = icon === false ? null : (icon ?? React.createElement(ICON[tone], { size: 16, 'aria-hidden': true }));
  return (
    <div
      ref={ref}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cx('v8-alert', `v8-alert--${tone}`, className)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: TONE_BG[tone],
        border: '1px solid',
        borderColor: TONE_BORDER[tone],
        borderRadius: 'var(--radius)',
        color: 'var(--fg)',
      }}
      {...rest}
    >
      {showIcon && IconNode !== null && (
        <span style={{ color: TONE_FG[tone], flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
          {IconNode}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {title !== undefined && (
          <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{title}</div>
        )}
        {children !== undefined && (
          <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{children}</div>
        )}
      </div>
      {action !== undefined && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{action}</div>
      )}
    </div>
  );
});