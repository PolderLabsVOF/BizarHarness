import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Avatar — user/agent representation. Falls back to initials when no image.
 *
 * Sizes: xs (20) | sm (24) | md (32) | lg (40) | xl (56).
 * Renders a <span> by default; use `asChild` to swap for a button/link.
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string;
  size?: AvatarSize;
  /** Override the generated initials. */
  initials?: string;
  /** Optional status dot (online/offline/busy). */
  status?: 'online' | 'offline' | 'busy' | 'away';
}

const SIZE_PX: Record<AvatarSize, number> = { xs: 20, sm: 24, md: 32, lg: 40, xl: 56 };
const SIZE_FS: Record<AvatarSize, string> = {
  xs: 'var(--fs-12)',
  sm: 'var(--fs-12)',
  md: 'var(--fs-13)',
  lg: 'var(--fs-14)',
  xl: 'var(--fs-18)',
};

const STATUS_FG = {
  online: 'var(--success)',
  offline: 'var(--fg-subtle)',
  busy: 'var(--danger)',
  away: 'var(--warning)',
} as const;

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === undefined) return '?';
  if (parts.length === 1) {
    const first = parts[0] ?? '';
    return first.slice(0, 2).toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return `${first}${last}`.toUpperCase();
}

// Deterministic color from name — used as fallback when no image.
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const FALLBACK_PALETTE = [
  'oklch(0.65 0.15 240)',
  'oklch(0.65 0.15 30)',
  'oklch(0.65 0.15 140)',
  'oklch(0.65 0.15 320)',
  'oklch(0.65 0.15 80)',
  'oklch(0.65 0.15 200)',
];

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(props, ref) {
  const { name, src, size = 'md', initials, status, className, style, ...rest } = props;
  const px = SIZE_PX[size];
  const init = initials ?? deriveInitials(name);
  const fallbackBg = FALLBACK_PALETTE[hashName(name) % FALLBACK_PALETTE.length];

  return (
    <span
      ref={ref}
      className={cx('v8-avatar', `v8-avatar--${size}`, className)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
        background: fallbackBg,
        color: 'white',
        fontSize: SIZE_FS[size],
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
      aria-label={name}
      {...rest}
    >
      {src !== undefined ? (
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        init
      )}
      {status !== undefined && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: Math.max(6, Math.floor(px * 0.28)),
            height: Math.max(6, Math.floor(px * 0.28)),
            borderRadius: 'var(--radius-pill)',
            background: STATUS_FG[status],
            border: '2px solid var(--surface-0)',
          }}
        />
      )}
    </span>
  );
});

/**
 * AvatarStack — overlapping avatars. Use for "assigned to N people" lists.
 */
export interface AvatarStackProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  size?: AvatarSize;
  max?: number;
}

export const AvatarStack = forwardRef<HTMLDivElement, AvatarStackProps>(function AvatarStack(
  props,
  ref,
) {
  const { children, size = 'sm', className, style, ...rest } = props;
  return (
    <div
      ref={ref}
      className={cx('v8-avatar-stack', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        ...style,
      }}
      {...rest}
    >
      <StackedChildren size={size}>{children}</StackedChildren>
    </div>
  );
});

function StackedChildren({ children, size }: { children: ReactNode; size: AvatarSize }) {
  const px = SIZE_PX[size];
  return (
    <>
      {Array.isArray(children)
        ? children.map((child, i) => (
            <span
              key={i}
              style={{
                marginLeft: i === 0 ? 0 : -Math.floor(px * 0.3),
                border: '2px solid var(--surface-0)',
                borderRadius: 'var(--radius-pill)',
                display: 'inline-flex',
              }}
            >
              {child}
            </span>
          ))
        : <span style={{ border: '2px solid var(--surface-0)', borderRadius: 'var(--radius-pill)' }}>{children}</span>}
    </>
  );
}