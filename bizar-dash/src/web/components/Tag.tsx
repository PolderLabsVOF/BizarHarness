// src/components/Tag.tsx — pill for tags.

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type TagProps = {
  children: ReactNode;
  className?: string;
  onRemove?: () => void;
};

export function Tag({ children, className, onRemove }: TagProps) {
  return (
    <span className={cn('tag', className)}>
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
