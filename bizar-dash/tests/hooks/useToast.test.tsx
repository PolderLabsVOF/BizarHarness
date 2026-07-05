import { render, screen, act, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ToastProvider, useToast } from '../../src/web/components/Toast';

function TestHarness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('Success toast body')}>Trigger Success</button>
      <button onClick={() => toast.error('Error toast body')}>Trigger Error</button>
      <button onClick={() => toast.info('Info toast body')}>Trigger Info</button>
    </div>
  );
}

describe('useToast', () => {
  it('calling success() renders a toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Trigger Success'));
    expect(screen.getByText('Success toast body')).toBeInTheDocument();
  });

  it('calling error() renders an error toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Trigger Error'));
    expect(screen.getByText('Error toast body')).toBeInTheDocument();
  });

  it('returns fallback api when no provider is present', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
    expect(result.current.isModalOpen).toBeUndefined();
    // Calling methods should not throw
    expect(() => result.current.show('test')).not.toThrow();
    expect(() => result.current.dismiss(1)).not.toThrow();
  });
});
