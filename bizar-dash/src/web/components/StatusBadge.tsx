// src/components/StatusBadge.tsx — small colored pill.

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * v6.0.0 — Doctor variants. 'ok' / 'warn' / 'fail' map onto
 * 'success' / 'warning' / 'error' respectively so existing CSS
 * rules cover the Doctor page without a new palette entry. The
 * `kind` union is widened (additive only) so every existing caller
 * keeps type-checking against the same set.
 */
export type StatusKind =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'accent'
  | 'neutral'
  | 'ok'
  | 'warn'
  | 'fail';

export type StatusBadgeProps = {
  kind?: StatusKind;
  children: ReactNode;
  className?: string;
  dot?: boolean;
};

/**
 * Map a doctor-style status to the underlying badge kind. Done at
 * render time so callers don't have to translate; the CSS class is
 * always one of `badge-success | badge-warning | badge-error | …`.
 */
function normalizeKind(kind: StatusKind): Exclude<StatusKind, 'ok' | 'warn' | 'fail'> {
  if (kind === 'ok') return 'success';
  if (kind === 'warn') return 'warning';
  if (kind === 'fail') return 'error';
  return kind;
}

export function StatusBadge({
  kind = 'neutral',
  children,
  className,
  dot = false,
}: StatusBadgeProps) {
  const normalized = normalizeKind(kind);
  return (
    <span className={cn('badge', `badge-${normalized}`, className)} title={`status: ${kind}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
