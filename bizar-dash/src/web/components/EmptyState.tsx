// src/components/EmptyState.tsx — friendly empty / error placeholder.

import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../lib/utils';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('empty-state', className)}>
      <div className="empty-icon">{icon ?? <Inbox size={32} />}</div>
      <div className="empty-title">{title}</div>
      {message && <div className="empty-message">{message}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
