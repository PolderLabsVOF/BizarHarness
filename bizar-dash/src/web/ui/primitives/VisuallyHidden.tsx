/*
 * VisuallyHidden.tsx — screen-reader-only span (Wave 2A).
 *
 * Renders content that is invisible to sighted users but still announced
 * by assistive tech. Use for: skip-link targets, descriptive labels on
 * icon-only buttons that already use aria-label redundantly, hidden form
 * instructions, and decorative text that still carries semantic meaning
 * (e.g. status changes announced without a visible toast).
 */

import type { HTMLAttributes, ReactNode } from 'react';

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement> & {
  children?: ReactNode;
};

export function VisuallyHidden({
  children,
  ...rest
}: VisuallyHiddenProps): React.JSX.Element {
  return (
    <span className="vh" {...rest}>
      {children}
    </span>
  );
}
