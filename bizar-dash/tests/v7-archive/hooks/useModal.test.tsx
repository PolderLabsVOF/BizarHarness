import { render, screen, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { ModalProvider, useModal } from '../../src/web/components/Modal';

function TestHarness() {
  const modal = useModal();
  return (
    <div>
      <button onClick={() => modal.open({ title: 'Dialog', children: <p>Content</p> })}>
        Open
      </button>
      <span data-testid="modal-open">{String(modal.isModalOpen)}</span>
    </div>
  );
}

describe('useModal', () => {
  it('isModalOpen starts as false', () => {
    render(
      <ModalProvider>
        <TestHarness />
      </ModalProvider>,
    );

    expect(screen.getByTestId('modal-open')).toHaveTextContent('false');
  });

  it('open() renders a modal dialog', async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <TestHarness />
      </ModalProvider>,
    );

    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('close() removes the dialog', async () => {
    const user = userEvent.setup();

    function HarnessWithClose() {
      const modal = useModal();
      return (
        <div>
          <button
            onClick={() =>
              modal.open({
                title: 'Dialog',
                children: <p>Content</p>,
                footer: <button onClick={() => modal.close()}>Close Modal</button>,
              })
            }
          >
            Open
          </button>
        </div>
      );
    }

    render(
      <ModalProvider>
        <HarnessWithClose />
      </ModalProvider>,
    );

    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByText('Close Modal'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns fallback api when no provider is present', () => {
    const { result } = renderHook(() => useModal());
    expect(result.current.isModalOpen).toBe(false);
    expect(result.current.open({ children: <p>test</p> })).toBe('');
    expect(() => result.current.close()).not.toThrow();
  });
});
