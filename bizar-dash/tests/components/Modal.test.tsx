import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ModalProvider, useModal } from '../../src/web/components/Modal';

function ModalHarness() {
  const modal = useModal();
  return (
    <div>
      <button onClick={() => modal.open({ title: 'Dialog', children: <p>Content</p> })}>
        Open
      </button>
    </div>
  );
}

function ModalHarnessWithClose() {
  const modal = useModal();
  return (
    <div>
      <button
        onClick={() =>
          modal.open({
            title: 'Dialog',
            children: <p>Content</p>,
            footer: <button onClick={() => modal.close()}>Close</button>,
          })
        }
      >
        Open
      </button>
    </div>
  );
}

describe('Modal', () => {
  it('renders when open', async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>,
    );

    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('does not render dialog when closed', () => {
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has role="dialog"', async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>,
    );

    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>,
    );

    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when clicking the backdrop', async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>,
    );

    await user.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const backdrop = dialog.parentElement!;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
