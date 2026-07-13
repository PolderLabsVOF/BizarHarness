/**
 * tests/components/Dialog.test.tsx
 *
 * v8 migration — Modal test rewritten against the v8 Dialog API.
 *
 * v7 had a `ModalProvider` + `useModal()` imperative hook.
 * v8 replaced that with Radix Dialog primitives: declarative
 * `<Dialog><DialogTrigger/><DialogContent/></Dialog>`.
 *
 * The useModal hook has no v8 equivalent (declarative > imperative);
 * its tests were absorbed here as direct Dialog assertions.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import * as UiExports from '../../src/web/v8/ui/index.js';
import { Dialog, DialogTrigger, DialogContent } from '../../src/web/v8/ui/index.js';

function ControlledDialog({ open: openInit = false }: { open?: boolean }) {
  const [open, setOpen] = useState(openInit);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button>Open</button>
      </DialogTrigger>
      <DialogContent title="Dialog">
        <p>Content</p>
        <DialogTrigger asChild>
          <button onClick={() => setOpen(false)}>Close</button>
        </DialogTrigger>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog (v8)', () => {
  it('does not render dialog content when closed', () => {
    render(<ControlledDialog open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('renders dialog content when open', () => {
    render(<ControlledDialog open={true} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('opens the dialog when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog when the trigger inside fires onOpenChange(false)', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog open={true} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes the dialog title via Radix Title (accessible name)', () => {
    render(<ControlledDialog open={true} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Dialog');
  });
});

describe('Dialog imperative surface (v8)', () => {
  it('keeps Radix Dialog as the only modal mechanism (no useModal hook needed)', () => {
    // Sanity check: v8 intentionally does not export a `useModal` hook.
    // Declarative Dialog is the canonical pattern. This test documents
    // the decision so a future contributor doesn't reintroduce the hook.
    expect((UiExports as Record<string, unknown>).useModal).toBeUndefined();
  });
});