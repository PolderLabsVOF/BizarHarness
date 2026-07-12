import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Card — the v8 surface primitive.
 *
 * Variants:
 *   - default: bordered, --surface-1 background, used for kanban cards, settings groups.
 *   - elevated: --surface-1 background + shadow, used for popovers/dropdowns hovering over content.
 *   - ghost:    no border, transparent background, used inside other Cards (nested).
 *   - outlined: thicker border, --surface-0 background, used for group containers.
 *
 * All variants have a consistent --radius-lg corner and pad via --density-card-pad.
 * The header / body / footer slots are conventions — pass any children you want.
 */
export type CardVariant = 'default' | 'elevated' | 'ghost' | 'outlined';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Removes padding so the child fills the card edge-to-edge. */
  flush?: boolean;
  /** Adds hover lift + cursor pointer for clickable cards. */
  interactive?: boolean;
  children?: ReactNode;
}

const VARIANT_STYLE: Record<CardVariant, React.CSSProperties> = {
  default: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    boxShadow: 'none',
  },
  elevated: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-2)',
  },
  ghost: {
    background: 'transparent',
    border: '1px solid transparent',
    boxShadow: 'none',
  },
  outlined: {
    background: 'var(--surface-0)',
    border: '1px solid var(--border)',
    boxShadow: 'none',
  },
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(props, ref) {
  const { variant = 'default', flush, interactive, className, style, ...rest } = props;
  return (
    <div
      ref={ref}
      className={cx('v8-card', `v8-card--${variant}`, interactive && 'is-interactive', className)}
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: flush === true ? 0 : 'var(--density-card-pad)',
        cursor: interactive === true ? 'pointer' : undefined,
        transition: interactive === true
          ? 'border-color var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out)'
          : undefined,
        ...VARIANT_STYLE[variant],
        ...style,
      }}
      {...rest}
    />
  );
});

/** Card header — title row + optional actions. */
export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  props,
  ref,
) {
  const { title, description, action, className, style, ...rest } = props;
  return (
    <div
      ref={ref}
      className={cx('v8-card__header', className)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
        ...style,
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
        {description !== undefined && (
          <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
      {action !== undefined && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
});

/** Card body — main content slot. */
export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardBody(props, ref) {
    const { className, ...rest } = props;
    return <div ref={ref} className={cx('v8-card__body', className)} {...rest} />;
  },
);

/** Card footer — typically action buttons right-aligned. */
export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter(props, ref) {
    const { className, style, ...rest } = props;
    return (
      <div
        ref={ref}
        className={cx('v8-card__footer', className)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border)',
          ...style,
        }}
        {...rest}
      />
    );
  },
);