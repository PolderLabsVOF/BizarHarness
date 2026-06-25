// src/components/CollapsibleSection.tsx — collapsible section.
//
// Stores its open/closed state in local component state (no need to
// persist across the dashboard right now — these are visual aids).
//
// Usage:
//   <CollapsibleSection title="Advanced" defaultOpen={false}>
//     <p>Hidden until expanded.</p>
//   </CollapsibleSection>

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

type Props = {
  title: ReactNode;
  /** Optional right-aligned controls (e.g. a button) shown next to the title. */
  actions?: ReactNode;
  /** Initial open state. Default: false. */
  defaultOpen?: boolean;
  /** Controlled open state. If set, the parent owns the state. */
  open?: boolean;
  /** Called when the user toggles the section (only in uncontrolled mode). */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  actions,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const toggle = () => {
    if (isControlled) {
      onOpenChange?.(!controlledOpen);
    } else {
      setInternalOpen((v) => !v);
    }
  };

  return (
    <div className="collapsible-section">
      <div
        className="collapsible-section-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <ChevronRight size={14} className={cn('collapsible-section-toggle', open && 'is-open')} />
          <span className="collapsible-section-title">{title}</span>
        </div>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
      {open && <div className="collapsible-section-body">{children}</div>}
    </div>
  );
}