// src/components/Spinner.tsx — loading indicator.

import { cn } from '../lib/utils';

export type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
};

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      className={cn('spinner', `spinner-${size}`, className)}
      role="status"
      aria-label={label || 'Loading'}
    />
  );
}
