// src/web/hooks/useAutosave.ts
// Debounced autosave hook for settings fields.

import { useState, useEffect, useRef, useCallback } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutosave<T>(
  initialValue: T,
  saveFn: (value: T) => Promise<void>,
  {
    delay = 800,
    onSaved,
    onError,
  }: { delay?: number; onSaved?: () => void; onError?: (e: Error) => void } = {},
) {
  const [value, setValue] = useState<T>(initialValue);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<T | null>(null);
  const lastSavedValue = useRef<T>(initialValue);
  // Tracks whether a debounce timeout is currently pending (set when timeout is scheduled, cleared when it fires)
  const hasPendingDebounceRef = useRef(false);

  const save = useCallback(
    async (v: T) => {
      setStatus('saving');
      try {
        await saveFn(v);
        lastSavedValue.current = v;
        pendingValueRef.current = null;
        setStatus('saved');
        onSaved?.();
        setTimeout(() => setStatus('idle'), 2000);
      } catch (err) {
        setStatus('error');
        onError?.(err as Error);
      }
    },
    [saveFn, onSaved, onError],
  );

  const setValueAndSave = useCallback(
    (v: T) => {
      setValue(v);
      pendingValueRef.current = v;
      hasPendingDebounceRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        hasPendingDebounceRef.current = false;
        const toSave = pendingValueRef.current;
        pendingValueRef.current = null;
        if (toSave !== null) save(toSave);
      }, delay);
    },
    [delay, save],
  );

  /**
   * Clear any pending debounce without saving.
   * Use this when you want the debounce to handle the save naturally.
   */
  const clearDebounce = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      hasPendingDebounceRef.current = false;
    }
  }, []);

  /**
   * Flush any pending save immediately (called on unmount or explicit flush).
   */
  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      hasPendingDebounceRef.current = false;
      const toSave = pendingValueRef.current;
      pendingValueRef.current = null;
      if (toSave !== null) await save(toSave);
    }
  }, [save]);

  // Cleanup on unmount: fire pending save immediately
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        const toSave = pendingValueRef.current;
        pendingValueRef.current = null;
        // Fire-and-forget: call saveFn directly to persist without awaiting
        if (toSave !== null) {
          setStatus('saving');
          saveFn(toSave)
            .then(() => { lastSavedValue.current = toSave; setStatus('saved'); onSaved?.(); })
            .catch((err: Error) => { setStatus('error'); onError?.(err); })
            .finally(() => { setTimeout(() => setStatus('idle'), 2000); });
        }
      }
    };
  }, [saveFn, onSaved, onError]);

  return { value, setValue: setValueAndSave, status, save, flush, clearDebounce, hasPendingDebounceRef, pendingValueRef };
}
