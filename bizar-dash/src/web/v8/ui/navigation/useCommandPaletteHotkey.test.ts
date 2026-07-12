import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCommandPaletteHotkey } from './CommandPalette.js';

/**
 * useCommandPaletteHotkey — wires ⌘K / Ctrl+K to toggle the palette.
 *
 * These tests directly exercise the hook (no DOM mount required). The hook
 * attaches a window keydown listener on mount and removes it on unmount.
 */

describe('useCommandPaletteHotkey', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    expect(result.current[0]).toBe(false);
  });

  it('opens when Meta+K is pressed', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(result.current[0]).toBe(true);
  });

  it('opens when Ctrl+K is pressed', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(result.current[0]).toBe(true);
  });

  it('toggles on a second ⌘K press', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('closes on Escape', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('ignores K without Meta/Ctrl', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    });
    expect(result.current[0]).toBe(false);
  });

  it('exposes a setter that can toggle externally', () => {
    const { result } = renderHook(() => useCommandPaletteHotkey());
    const [, setOpen] = result.current;
    act(() => setOpen(true));
    expect(result.current[0]).toBe(true);
  });

  it('removes its listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useCommandPaletteHotkey());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
