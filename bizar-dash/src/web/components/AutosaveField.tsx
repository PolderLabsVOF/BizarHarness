// src/web/components/AutosaveField.tsx
// Generic auto-saving field wrapper with inline save status animation.

import React from 'react';
import { Check, Loader, AlertCircle } from 'lucide-react';
import { useAutosave } from '../hooks/useAutosave';

export type { AutosaveStatus } from '../hooks/useAutosave';

export function AutosaveField<T = string>({
  initialValue,
  saveFn,
  delay = 800,
  render,
  className,
}: {
  initialValue: T;
  saveFn: (value: T) => Promise<void>;
  delay?: number;
  render: (props: {
    value: T;
    onChange: (v: T) => void;
    onBlur: () => void;
  }) => React.ReactNode;
  className?: string;
}) {
  const { value, setValue, status, save, clearDebounce, hasPendingDebounceRef, pendingValueRef } = useAutosave(initialValue, saveFn, { delay });

  const handleBlur = React.useCallback(() => {
    // If a debounce is pending (user was actively typing), clear the timeout
    // and save immediately — the user is done typing.
    if (hasPendingDebounceRef.current) {
      clearDebounce();
      // pendingValueRef.current holds the typed value not yet saved by debounce
      if (pendingValueRef.current !== null) save(pendingValueRef.current);
    }
    // If no debounce is pending: do nothing (value was already saved or unchanged).
  }, [clearDebounce, hasPendingDebounceRef, save, pendingValueRef]);

  return (
    <div className={`autosave-field ${className || ''} ${status}`}>
      {render({ value, onChange: setValue, onBlur: handleBlur })}
      <span className="autosave-status" role="status" aria-live="polite">
        {status === 'saving' && <Loader className="spinning" size={12} />}
        {status === 'saved' && <Check size={12} />}
        {status === 'error' && <AlertCircle size={12} />}
      </span>
    </div>
  );
}
