// src/components/Card.tsx — wrapper card.
//
// v8.0 — Minimalist overhaul. Stripped decorative icon boxes and
// `--accent-bg` fills. Variants are flat styling (background / radius /
// border) — content is owned by `children` and, for the metric pattern,
// by the dedicated `MetricCard` component which composes Card with
// variant="metric".

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

export type CardVariant = 'elevated' | 'outlined' | 'filled' | 'metric';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
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