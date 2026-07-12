import { type ReactNode } from 'react';
import { Box } from '../ui/primitives/Box.js';
import { Inline } from '../ui/primitives/Inline.js';

/**
 * StatusBar — bottom 32px alert bar. Only visible when there is an active alert.
 *
 * Color comes from the alert `tone`. Default: warning yellow.
 *
 * Wired to AlertManager in Sprint S9 (Polish). For F-043 this is rendered
 * as a no-op placeholder so the shell composes correctly.
 */

export type StatusBarTone = 'info' | 'success' | 'warning' | 'danger';

export interface StatusBarProps {
  tone?: StatusBarTone;
  children?: ReactNode;
  /** Optional right-aligned actions (e.g. "Dismiss", "View"). */
  actions?: ReactNode;
}

const TONE_BG: Record<StatusBarTone, string> = {
  info: 'oklch(from var(--info) l c h / 0.10)',
  success: 'oklch(from var(--success) l c h / 0.10)',
  warning: 'oklch(from var(--warning) l c h / 0.10)',
  danger: 'oklch(from var(--danger) l c h / 0.10)',
};

const TONE_BORDER: Record<StatusBarTone, string> = {
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export function StatusBar({ tone = 'warning', children, actions }: StatusBarProps): JSX.Element {
  return (
    <Box
      role="status"
      aria-live="polite"
      className="v8-status-bar"
      style={{
        height: 'var(--statusbar-h)',
        flexShrink: 0,
        background: TONE_BG[tone],
        borderTop: `1px solid ${TONE_BORDER[tone]}`,
        paddingLeft: 'var(--space-4)',
        paddingRight: 'var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 'var(--fs-12)',
        color: 'var(--fg-muted)',
      }}
    >
      <Inline align="center" gap={2}>
        {children}
      </Inline>
      {actions && <Inline align="center" gap={2}>{actions}</Inline>}
    </Box>
  );
}