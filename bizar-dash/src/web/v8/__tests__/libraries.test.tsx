import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LibraryItem } from '../ui/libraries/LibraryItem';
import { LibraryGrid } from '../ui/libraries/LibraryGrid';

describe('LibraryItem', () => {
  it('renders name, slug, status, description, meta', () => {
    const { container } = render(
      <LibraryItem
        id="s1"
        name="Frigg"
        slug="frigg"
        status="enabled"
        description="Read-only codebase Q&A."
        meta="v1.2.0 · used 14× today"
      />,
    );
    expect(container.textContent).toContain('Frigg');
    expect(container.textContent).toContain('Read-only codebase Q&A.');
    expect(container.textContent).toContain('v1.2.0 · used 14× today');
    expect(container.querySelector('code')?.textContent).toBe('frigg');
  });

  it('shows the disabled status badge', () => {
    render(<LibraryItem id="s1" name="x" slug="x" status="disabled" />);
    expect(screen.getByText(/disabled/i)).toBeInTheDocument();
  });

  it('shows the error status badge', () => {
    render(<LibraryItem id="s1" name="x" slug="x" status="error" />);
    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it('invokes onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<LibraryItem id="s1" name="x" slug="x" status="enabled" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /x/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders actions slot', () => {
    const { container } = render(
      <LibraryItem
        id="s1"
        name="Semble"
        slug="semble"
        status="enabled"
        actions={<button type="button">Toggle</button>}
      />,
    );
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('Toggle');
  });
});

describe('LibraryGrid', () => {
  it('renders children inside a grid container', () => {
    const { container } = render(
      <LibraryGrid>
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </LibraryGrid>,
    );
    const grid = container.firstChild as HTMLElement;
    expect(grid.style.display).toBe('grid');
    expect(grid.children).toHaveLength(3);
  });
});