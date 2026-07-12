import { type ReactNode } from 'react';
import { ChevronRight, Power } from 'lucide-react';
import { cx } from '../utils/cx.js';
import { Badge, type BadgeTone } from '../data/Badge.js';

/**
 * LibraryItem — generic inventory card used by the Skill/MCP/Hook libraries.
 *
 * PLAN.md: each "library" lists the same three facts about an installable
 * resource: identity (name + slug), status (enabled/disabled/error), and
 * provenance (description, version, last-used, owner). LibraryItem renders
 * those facts consistently so all three libraries feel like one product.
 */

export type LibraryStatus = 'enabled' | 'disabled' | 'error';

export interface LibraryItemProps {
  id: string;
  /** Display name (e.g. "Frigg — Codebase Q&A"). */
  name: string;
  /** Identifier (e.g. "frigg", "semble", "PreToolUse:check-arch"). */
  slug: string;
  status: LibraryStatus;
  description?: string;
  /** One-line metadata row (e.g. "v1.2.0 · used 14× today · @anthropic"). */
  meta?: string;
  /** Optional trailing action area (toggle, menu trigger, etc). */
  actions?: ReactNode;
  /** Click handler — opens detail. */
  onOpen?: () => void;
  className?: string;
}

const STATUS_LABEL: Record<LibraryStatus, string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  error: 'Error',
};

const STATUS_TONE: Record<LibraryStatus, BadgeTone> = {
  enabled: 'success',
  disabled: 'neutral',
  error: 'danger',
};

export function LibraryItem(props: LibraryItemProps) {
  const { name, slug, status, description, meta, actions, onOpen, className } = props;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx('v8-library-item', `v8-library-item--${status}`, className)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        width: '100%',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        textAlign: 'left',
        cursor: onOpen !== undefined ? 'pointer' : 'default',
        font: 'inherit',
        color: 'inherit',
        transition: 'border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          marginTop: 2,
          borderRadius: 'var(--radius-sm)',
          background:
            status === 'enabled'
              ? 'color-mix(in oklch, var(--success) 14%, transparent)'
              : status === 'error'
                ? 'color-mix(in oklch, var(--danger) 14%, transparent)'
                : 'var(--surface-2)',
          color:
            status === 'enabled' ? 'var(--success)' : status === 'error' ? 'var(--danger)' : 'var(--fg-muted)',
          flexShrink: 0,
        }}
      >
        <Power size={14} aria-hidden="true" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              color: 'var(--fg)',
              lineHeight: 'var(--lh-snug)',
            }}
          >
            {name}
          </span>
          <code
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-subtle)',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            }}
          >
            {slug}
          </code>
        </div>
        {description !== undefined && (
          <div
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              marginTop: 2,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {description}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            marginTop: 6,
          }}
        >
          {meta !== undefined ? (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>{meta}</span>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Badge tone={STATUS_TONE[status]} size="sm">
              {STATUS_LABEL[status]}
            </Badge>
            {actions}
            <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--fg-subtle)' }} />
          </div>
        </div>
      </div>
      <style>{`
        .v8-library-item:hover {
          border-color: var(--accent);
          background: var(--surface-2);
        }
      `}</style>
    </button>
  );
}