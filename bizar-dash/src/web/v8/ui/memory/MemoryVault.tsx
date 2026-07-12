import { type ReactNode } from 'react';
import { FileText, Hash } from 'lucide-react';
import { cx } from '../utils/cx.js';
import { Badge } from '../data/Badge.js';

/**
 * MemoryVault — list of memory entries (memos) grouped by scope.
 *
 * PLAN.md: memos are the durable cross-session notes the harness writes
 * down. Scopes: `project` (committed to repo) vs `global` (user-wide).
 * Each entry: content (truncated to 3 lines), tags, last-updated time,
 * scope badge.
 */

export type MemoryScope = 'project' | 'global';

export interface MemoryEntry {
  id: string;
  content: string;
  tags?: readonly string[];
  scope: MemoryScope;
  /** Relative time label ("3 days ago", "Just now"). */
  updatedAt: string;
}

export interface MemoryVaultProps {
  entries: readonly MemoryEntry[];
  /** Optional click handler — opens memo detail. */
  onOpen?: (entry: MemoryEntry) => void;
  /** Optional empty state. */
  empty?: ReactNode;
  className?: string;
}

const SCOPE_LABEL: Record<MemoryScope, string> = {
  project: 'Project',
  global: 'Global',
};

const SCOPE_TONE: Record<MemoryScope, 'accent' | 'info'> = {
  project: 'accent',
  global: 'info',
};

export function MemoryVault(props: MemoryVaultProps) {
  const { entries, onOpen, empty, className } = props;

  if (entries.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <div className={cx('v8-memory-vault', className)}>
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.id}
          onClick={() => onOpen?.(entry)}
          className={cx('v8-memory-vault__item', `v8-memory-vault__item--${entry.scope}`)}
          style={{
            display: 'block',
            width: '100%',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            textAlign: 'left',
            cursor: onOpen !== undefined ? 'pointer' : 'default',
            font: 'inherit',
            color: 'inherit',
            marginBottom: 'var(--space-2)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              marginBottom: 6,
            }}
          >
            <Badge tone={SCOPE_TONE[entry.scope]} size="sm">
              {SCOPE_LABEL[entry.scope]}
            </Badge>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-subtle)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <FileText size={12} aria-hidden="true" />
              {entry.updatedAt}
            </span>
          </div>
          <div
            style={{
              fontSize: 'var(--fs-13)',
              color: 'var(--fg)',
              lineHeight: 'var(--lh-snug)',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {entry.content}
          </div>
          {entry.tags !== undefined && entry.tags.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 'var(--space-2)',
                flexWrap: 'wrap',
              }}
            >
              <Hash size={11} aria-hidden="true" style={{ color: 'var(--fg-subtle)' }} />
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 'var(--fs-12)',
                    color: 'var(--fg-muted)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </button>
      ))}
      <style>{`
        .v8-memory-vault__item:hover { border-color: var(--accent); }
      `}</style>
    </div>
  );
}