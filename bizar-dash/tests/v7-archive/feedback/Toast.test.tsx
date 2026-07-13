import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToastProvider, useToast } from '../../../src/web/ui/feedback/Toast';

function Harness(): React.JSX.Element {
  const t = useToast();
  return (
    <div>
      <button onClick={() => t.info('info-msg')}>info</button>
      <button onClick={() => t.success('success-msg')}>success</button>
      <button onClick={() => t.warning('warn-msg')}>warning</button>
      <button onClick={() => t.error('error-msg')}>error</button>
    </div>
  );
}

describe('Toast (Bizar design system)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders each of the four toast variants', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('info'));
    await user.click(screen.getByText('success'));
    await user.click(screen.getByText('warning'));
    await user.click(screen.getByText('error'));

    expect(screen.getByText('info-msg')).toBeInTheDocument();
    expect(screen.getByText('success-msg')).toBeInTheDocument();
    expect(screen.getByText('warn-msg')).toBeInTheDocument();
    expect(screen.getByText('error-msg')).toBeInTheDocument();
  });

  it('auto-dismisses info toasts after the default duration', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('info'));
    expect(screen.getByText('info-msg')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('info-msg')).not.toBeInTheDocument();
  });

  it('error toasts stick around longer than info toasts', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('error'));
    expect(screen.getByText('error-msg')).toBeInTheDocument();
    // 4000ms is the default for info but errors should still be visible
    // until the 6000ms mark.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('error-msg')).toBeInTheDocument();
  });

  it('dismisses on manual close button click', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByText('info'));
    expect(screen.getByText('info-msg')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.queryByText('info-msg')).not.toBeInTheDocument();
  });

  it('caps the visible queue at 5 and evicts the oldest', async () => {
    const user = userEvent.setup();
    function SpamHarness(): React.JSX.Element {
      const t = useToast();
      return (
        <button
          onClick={() => {
            for (let i = 0; i < 7; i++) t.info(`toast-${i}`);
          }}
        >
          spam
        </button>
      );
    }
    render(
      <ToastProvider>
        <SpamHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByText('spam'));
    // Only the last 5 should remain visible (indices 2..6).
    expect(screen.queryByText('toast-0')).not.toBeInTheDocument();
    expect(screen.queryByText('toast-1')).not.toBeInTheDocument();
    expect(screen.getByText('toast-2')).toBeInTheDocument();
    expect(screen.getByText('toast-6')).toBeInTheDocument();
  });

  it('useToast throws when used outside a provider', () => {
    function Orphan(): React.JSX.Element {
      useToast();
      return <></>;
    }
    // Suppress React's error boundary console output for this expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
