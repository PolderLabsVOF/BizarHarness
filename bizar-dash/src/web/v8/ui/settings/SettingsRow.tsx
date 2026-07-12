import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * SettingsRow — one labelled option inside a SettingsSection.
 *
 * Three-column layout:
 *   ┌─ label + description ────────────  control  ─┐
 * The label column is required; the control slot
 * hosts the actual interactive (Switch, Select, Slider, custom button, etc.).
 */

export interface SettingsRowProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
  /** The control label (left column). */
  label: ReactNode;
  /** Optional one-line description (left column, below label). */
  description?: ReactNode;
  /** Right column — the interactive control. */
  control: ReactNode;
  /** Mark the row as disabled (visual + aria). */
  disabled?: boolean;
}

export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(function SettingsRow(
  props,
  ref,
) {
  const { id, label, description, control, disabled = false, className, ...rest } = props;
  // The label is announced via `aria-labelledby` rather than `<label
  // htmlFor>` because the control is generic — its DOM id is set by the
  // consumer (Switch, Select, custom input), and we'd otherwise need to
  // thread it through the props chain. `aria-labelledby` is the WAI-ARIA
  // sanctioned way to label a region without owning a native `<label>`.
  const labelId = `${id}-label`;
  return (
    <div
      ref={ref}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      className={cx('v8-settings-row', className)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--border)',
        opacity: disabled ? 0.5 : 1,
      }}
      {...rest}
    >
      <div id={labelId} style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--fs-13)',
            fontWeight: 500,
            color: 'var(--fg)',
            cursor: disabled ? 'not-allowed' : 'default',
            lineHeight: 'var(--lh-snug)',
          }}
        >
          {label}
        </span>
        {description !== undefined && (
          <p
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              margin: '4px 0 0 0',
              lineHeight: 'var(--lh-snug)',
            }}
          >
            {description}
          </p>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        style={{ flexShrink: 0, alignSelf: 'center' }}
      >
        {control}
      </div>
    </div>
  );
});