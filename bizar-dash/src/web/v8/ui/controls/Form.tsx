import { forwardRef, type FormHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Form — top-level form surface. Currently a thin styled wrapper around <form>.
 *
 * The v8 dashboard forms are intentionally minimal — most fields are wired
 * via <Field> + native input events. For complex forms (Settings pages,
 * kanban quick-add) use react-hook-form in the consumer; this primitive
 * just provides consistent layout + a handle for future form-level tooling.
 */
export interface FormProps extends FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
}

export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(props, ref) {
  const { children, className, ...rest } = props;
  return (
    <form ref={ref} className={cx('v8-form', className)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} {...rest}>
      {children}
    </form>
  );
});