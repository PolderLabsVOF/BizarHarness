/**
 * tests/autosave.test.tsx
 *
 * Tests for useAutosave hook and AutosaveField component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import React from 'react';
import { useAutosave } from '../src/web/hooks/useAutosave';
import { AutosaveField } from '../src/web/components/AutosaveField';

// ── useAutosave tests ────────────────────────────────────────────────────────

describe('useAutosave', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces save by the configured delay', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave('initial', saveFn, { delay: 500 }));

    act(() => { result.current.setValue('changed'); });
    expect(saveFn).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('changed');
  });

  it('saves immediately on flush', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave('initial', saveFn, { delay: 500 }));

    act(() => { result.current.setValue('changed'); });
    expect(saveFn).not.toHaveBeenCalled();

    await act(async () => { await result.current.flush(); });
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('changed');
  });

  it('does not save if value has not changed', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave('initial', saveFn, { delay: 500 }));

    act(() => { vi.advanceTimersByTime(600); });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('exposes status transitions: idle → saving → saved → idle', async () => {
    let resolve: (v: unknown) => void;
    const saveFn = vi.fn().mockReturnValue(new Promise(r => (resolve = r)));
    const { result } = renderHook(() => useAutosave('initial', saveFn, { delay: 500 }));

    expect(result.current.status).toBe('idle');

    act(() => { result.current.setValue('changed'); });
    expect(result.current.status).toBe('idle'); // still debouncing

    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.status).toBe('saving');

    await act(async () => { resolve!(); });
    expect(result.current.status).toBe('saved');

    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.status).toBe('idle');
  });

  it('exposes error status on save failure', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAutosave('initial', saveFn, { delay: 500 }));

    act(() => { result.current.setValue('changed'); });
    act(() => { vi.advanceTimersByTime(500); });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('flushes pending save on unmount', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave('initial', saveFn, { delay: 500 }));

    act(() => { result.current.setValue('changed'); });
    expect(saveFn).not.toHaveBeenCalled();

    unmount();
    expect(saveFn).toHaveBeenCalledTimes(1);
  });
});

// ── AutosaveField tests ───────────────────────────────────────────────────────

describe('AutosaveField', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the input passed via render prop', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    render(
      <AutosaveField
        initialValue="hello"
        saveFn={saveFn}
        render={({ value, onChange }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} />
        )}
      />,
    );
    expect(screen.getByTestId('input')).toHaveValue('hello');
  });

  it('applies idle class to container by default', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <AutosaveField
        initialValue="test"
        saveFn={saveFn}
        render={({ value, onChange }) => (
          <input value={value} onChange={e => onChange(e.target.value)} />
        )}
      />,
    );
    expect(container.querySelector('.autosave-field')).toHaveClass('autosave-field');
    expect(container.querySelector('.autosave-field')).not.toHaveClass('saving');
    expect(container.querySelector('.autosave-field')).not.toHaveClass('saved');
    expect(container.querySelector('.autosave-field')).not.toHaveClass('error');
  });

  it('shows saving state during async save', async () => {
    let resolve: (v: unknown) => void;
    const saveFn = vi.fn().mockImplementation(async () => {
      await new Promise(r => (resolve = r));
    });
    render(
      <AutosaveField
        initialValue="hello"
        saveFn={saveFn}
        render={({ value, onChange, onBlur }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        )}
      />,
    );

    fireEvent.change(screen.getByTestId('input'), { target: { value: 'changed' } });
    fireEvent.blur(screen.getByTestId('input'));

    await waitFor(() => {
      expect(document.querySelector('.autosave-field')).toHaveClass('saving');
    });

    act(() => { resolve!(); });
  });

  it('shows saved state after successful save', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    render(
      <AutosaveField
        initialValue="hello"
        saveFn={saveFn}
        render={({ value, onChange, onBlur }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        )}
      />,
    );

    fireEvent.change(screen.getByTestId('input'), { target: { value: 'changed' } });
    fireEvent.blur(screen.getByTestId('input'));

    await waitFor(() => {
      expect(document.querySelector('.autosave-field')).toHaveClass('saving');
    });

    act(() => { vi.advanceTimersByTime(50); });

    await waitFor(() => {
      expect(document.querySelector('.autosave-field')).toHaveClass('saved');
    });
  });

  it('shows error state on failed save', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));
    render(
      <AutosaveField
        initialValue="hello"
        saveFn={saveFn}
        render={({ value, onChange, onBlur }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        )}
      />,
    );

    fireEvent.change(screen.getByTestId('input'), { target: { value: 'changed' } });
    fireEvent.blur(screen.getByTestId('input'));

    await waitFor(() => {
      expect(document.querySelector('.autosave-field')).toHaveClass('error');
    });
  });

  it('saves immediately on blur when debounce is pending (done typing)', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    render(
      <AutosaveField
        initialValue="hello"
        delay={800}
        saveFn={saveFn}
        render={({ value, onChange, onBlur }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        )}
      />,
    );

    fireEvent.change(screen.getByTestId('input'), { target: { value: 'typing...' } });
    // Blur immediately — since user is done typing, save fires immediately
    // (debounce is pending but blur triggers immediate save instead)
    fireEvent.blur(screen.getByTestId('input'));

    // saveFn should be called immediately on blur
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('typing...');

    // Debounce timer should have been cleared — no duplicate save
    act(() => { vi.advanceTimersByTime(800); });
    expect(saveFn).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('saves pending value on unmount', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <AutosaveField
        initialValue="test"
        saveFn={saveFn}
        render={({ value, onChange }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} />
        )}
      />,
    );

    // Simulate user typing (schedules debounce)
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'unsaved' } });

    // Unmount before debounce fires
    unmount();

    // saveFn should have been called with the pending value
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(saveFn).toHaveBeenCalledWith('unsaved');
  });

  it('renders status icon when saving', async () => {
    let resolve: (v: unknown) => void;
    const saveFn = vi.fn().mockImplementation(async () => {
      await new Promise(r => (resolve = r));
    });
    render(
      <AutosaveField
        initialValue="hello"
        saveFn={saveFn}
        render={({ value, onChange, onBlur }) => (
          <input data-testid="input" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        )}
      />,
    );

    fireEvent.change(screen.getByTestId('input'), { target: { value: 'changed' } });
    fireEvent.blur(screen.getByTestId('input'));

    await waitFor(() => {
      expect(document.querySelector('.autosave-status')).toBeInTheDocument();
    });

    act(() => { resolve!(); });
  });
});
