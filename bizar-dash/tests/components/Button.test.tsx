/**
 * tests/components/Button.test.tsx
 *
 * v8 migration — Button test rewritten against the v8 API.
 *
 * v7 had CSS-class assertions (`btn-primary`, `btn-size-lg`, `btn-spinner`).
 * v8 uses semantic attributes (`aria-busy="true"`, `data-*`) and class
 * namespaced as `v8-btn--<variant>`. Assertions below target the v8
 * semantic surface; class assertions kept where they directly verify
 * the variant mapping.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../src/web/v8/ui/index.js';

describe('Button (v8)', () => {
  it('renders text and exposes role=button', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows loading state, disables interaction, marks aria-busy', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('does not fire onClick while loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button loading onClick={onClick}>Saving</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies variant class names (primary / secondary / ghost / danger / outline)', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'outline'] as const;
    for (const v of variants) {
      const { unmount } = render(<Button variant={v}>x</Button>);
      expect(screen.getByRole('button')).toHaveClass(`v8-btn--${v}`);
      unmount();
    }
  });

  it('applies size class names (sm / md / lg / icon)', () => {
    const sizes = ['sm', 'md', 'lg', 'icon'] as const;
    for (const s of sizes) {
      const { unmount } = render(<Button size={s}>x</Button>);
      expect(screen.getByRole('button')).toHaveClass(`v8-btn--${s}`);
      unmount();
    }
  });

  it('renders leftIcon and rightIcon', () => {
    render(
      <Button leftIcon={<span data-testid="li" />} rightIcon={<span data-testid="ri" />}>
        X
      </Button>,
    );
    expect(screen.getByTestId('li')).toBeInTheDocument();
    expect(screen.getByTestId('ri')).toBeInTheDocument();
  });
});