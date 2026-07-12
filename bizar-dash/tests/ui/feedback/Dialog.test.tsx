import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Dialog } from '../../../src/web/ui/feedback/Dialog';

describe('Dialog', () => {
  it('renders nothing when open=false', () => {
    render(
      <Dialog open={false} onClose={() => {}}>
        body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog with title and description when open', () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="Confirm delete"
        description="This cannot be undone."
      >
        Are you sure?
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Confirm delete')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t">
        body
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when persistent', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t" persistent>
        body
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the close icon is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t">
        body
      </Dialog>,
    );
    await user.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the actions slot in the footer', () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="t"
        actions={
          <>
            <button>Cancel</button>
            <button>Confirm</button>
          </>
        }
      >
        body
      </Dialog>,
    );
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('sets aria-modal and role="dialog"', () => {
    render(
      <Dialog open onClose={() => {}} title="t">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
