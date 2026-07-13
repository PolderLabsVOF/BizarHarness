/**
 * tests/components/Toast.test.tsx
 *
 * v8 migration — Toast test rewritten against the v8 Toaster / toast API.
 *
 * v7 used a `<ToastProvider>` context with imperative `toast()` calls.
 * v8 uses Sonner directly: render `<Toaster />` once at the app root and
 * call `toast.success(...)` / `toast.error(...)` from anywhere.
 *
 * Sonner renders toasts asynchronously into a portal — assertions use
 * `findBy*` / `waitFor` rather than synchronous `getBy*`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Toaster, toast } from '../../src/web/v8/ui/index.js';

describe('Toaster (v8)', () => {
  afterEach(() => {
    // Sonner keeps toasts in state across tests unless we explicitly dismiss.
    toast.dismiss();
  });

  it('renders the Sonner Toaster container', () => {
    render(<Toaster />);
    // Sonner exposes an `aria-label="Notifications"` region for SR users.
    const region = screen.getByLabelText(/notifications/i);
    expect(region).toBeInTheDocument();
  });

  it('exposes the imperative toast surface', () => {
    expect(typeof toast.success).toBe('function');
    expect(typeof toast.error).toBe('function');
    expect(typeof toast.info).toBe('function');
    expect(typeof toast.warning).toBe('function');
    expect(typeof toast.message).toBe('function');
    expect(typeof toast.dismiss).toBe('function');
  });

  it('toast.success emits a toast with the message text', async () => {
    render(<Toaster />);
    toast.success('Saved!');
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
  });

  it('toast.error emits a toast with the error message text', async () => {
    render(<Toaster />);
    toast.error('Boom');
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });

  it('toast.dismiss removes a previously shown toast', async () => {
    render(<Toaster />);
    toast.warning('Heads up');
    const node = await screen.findByText('Heads up');
    expect(node).toBeInTheDocument();
    toast.dismiss();
    await waitFor(() => {
      expect(screen.queryByText('Heads up')).not.toBeInTheDocument();
    });
  });
});
