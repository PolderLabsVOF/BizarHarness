import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Tooltip } from '../../../src/web/ui/feedback/Tooltip';

describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the popup on pointerEnter after the default delay', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hello world">
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText('trigger'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hello world');
  });

  it('hides the popup on pointerLeave', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hi">
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText('trigger'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByText('trigger'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('sets aria-describedby on the wrapped child while open', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="hi">
        <button>trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('trigger');
    expect(trigger).not.toHaveAttribute('aria-describedby');
    fireEvent.pointerEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const popup = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(popup.id);
  });

  it('respects a custom delay', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="lazy" delay={500}>
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText('trigger'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('applies a side modifier to the popup', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tooltip content="hi" side="bottom">
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText('trigger'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const popup = container.querySelector('.bizar-tooltip__popup--bottom');
    expect(popup).toBeInTheDocument();
  });

  it('does not show the popup before the delay elapses', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="soon" delay={100}>
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText('trigger'));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
