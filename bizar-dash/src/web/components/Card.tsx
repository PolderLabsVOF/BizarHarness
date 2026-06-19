// src/components/Card.tsx — wrapper card.

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: 'elevated' | 'outlined' | 'filled';
  interactive?: boolean;
  children?: ReactNode;
};

export function Card({
  variant = 'elevated',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'card',
        `card-${variant}`,
        interactive && 'card-interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('card-title', className)}>{children}</h3>;
}

export function CardMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('card-meta', className)}>{children}</div>;
}
