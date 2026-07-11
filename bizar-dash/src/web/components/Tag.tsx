// src/components/Tag.tsx — pill for tags.

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

export type TagVariant =
  | "neutral"
  | "info"
  | "accent"
  | "primary"
  | "success"
  | "warning"
  | "error";

export type TagProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  className?: string;
  variant?: TagVariant;
  onRemove?: () => void;
};

export function Tag({ children, className, variant, onRemove, ...rest }: TagProps) {
  return (
    <span
      className={cn('tag', variant ? `tag-${variant}` : undefined, className)}
      {...rest}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          className="tag-remove"
          aria-label={`Remove ${typeof children === 'string' ? children : 'tag'}`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}