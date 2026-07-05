import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ToastContainer, ToastProvider, useToast } from '../../src/web/components/Toast';

function ToastHarness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.show('Info message')}>Show Info</button>
      <button onClick={() => toast.success('Success!')}>Show Success</button>
      <button onClick={() => toast.error('Error!')}>Show Error</button>
    </div>
  );
}

describe('ToastContainer', () => {
  it('renders toast with message', () => {
    render(
      <ToastContainer
        toasts={[{ id: 1, kind: 'info', message: 'Test toast' }]}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Test toast')).toBeInTheDocument();
  });

  it('has role="alert" and aria-live="assertive"', () => {
    render(
      <ToastContainer
        toasts={[{ id: 1, kind: 'info', message: 'Accessible toast' }]}
        onDismiss={() => {}}
      />,
    );
    const toast = screen.getByRole('alert');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('ToastProvider + useToast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays a toast when show is called', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();
  });

  it('displays multiple toasts stacked', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Success'));
    await user.click(screen.getByText('Show Error'));

    expect(screen.getByText('Success!')).toBeInTheDocument();
    expect(screen.getByText('Error!')).toBeInTheDocument();
  });

  it('auto-dismisses after the default timeout', () => {
    // Use fireEvent (synchronous) instead of userEvent to avoid
    // timer conflicts with vi.useFakeTimers
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Show Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText('Info message')).not.toBeInTheDocument();
  });

  it('dismisses a toast when dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Info message')).not.toBeInTheDocument();
  });
});
