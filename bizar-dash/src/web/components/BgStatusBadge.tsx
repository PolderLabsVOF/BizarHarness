// src/components/BgStatusBadge.tsx — status pill for background agent instances.
// Maps BackgroundStatus values to badge kinds from StatusBadge.

import { StatusBadge, type StatusBadgeProps } from './StatusBadge';

const STATUS_KIND: Record<string, StatusBadgeProps['kind']> = {
  pending: 'info',
  running: 'accent',
  done: 'success',
  failed: 'error',
  killed: 'neutral',
  timed_out: 'warning',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  killed: 'Killed',
  timed_out: 'Timed out',
};

export function BgStatusBadge({ status, dot }: { status: string; dot?: boolean }) {
  const kind = STATUS_KIND[status] || 'neutral';
  const label = STATUS_LABELS[status] || status;
  return (
    <StatusBadge kind={kind} dot={dot}>
      {label}
    </StatusBadge>
  );
}
