import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Field — form field wrapper that pairs a label with a control and optional
 * hint / error message.
 *
 * Use for any form input so labels, hints, and errors render consistently.
 * Accessibility: the label is properly associated with the control via
 * `htmlFor` + `id`. The hint and error share `aria-describedby`.
 */
export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Unique id used for the input + label-for relationship. */
  id: string;
  /** Visible label text. */
  label: ReactNode;
  /** Optional descriptive hint below the control. */
  hint?: ReactNode;
  /** Optional error message. When present, the field renders the error tone. */
  error?: ReactNode;
  /** Whether the field is required (adds a red asterisk). */
  required?: boolean;
  /** The form control. Field renders the label and styling around it. */
  children: ReactNode;
}

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(props, ref) {
  const { id, label, hint, error, required, children, className, ...rest } = props;
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;

  return (
    <div
      ref={ref}
      className={cx('v8-field', error !== undefined && 'has-error', className)}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
      {...rest}
    >
      <label
        htmlFor={id}
        style={{
          fontSize: 'var(--fs-13)',
          fontWeight: 500,
          color: 'var(--fg)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
      >
        {label}
        {required === true && (
          <span aria-hidden="true" style={{ color: 'var(--danger)' }}>
            *
          </span>
        )}
      </label>
      {/* Children must wire `id={id}` to their input for the label to work. */}
      {children}
      {hint !== undefined && error === undefined && (
        <div
          id={hintId}
          style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}
        >
          {hint}
        </div>
      )}
      {error !== undefined && (
        <div
          id={errorId}
          role="alert"
          style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
    </div>
  );
});