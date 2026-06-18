// src/components/StatusBadge.tsx — small colored pill.

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type StatusBadgeProps = {
  kind?: 'success' | 'warning' | 'error' | 'info' | 'accent' | 'neutral';
  children: ReactNode;
  className?: string;
  dot?: boolean;
};

export function StatusBadge({
  kind = 'neutral',
  children,
  className,
  dot = false,
}: StatusBadgeProps) {
  return (
    <span className={cn('badge', `badge-${kind}`, className)}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
