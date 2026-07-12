// tests/ui/navigation/CommandPalette.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CommandPalette } from '../../../src/web/ui/navigation/CommandPalette';

const ITEMS = [
  {
    id: 'a1',
    type: 'agent' as const,
    label: 'Odin Agent',
    description: 'Mid-tier orchestrator',
    onSelect: vi.fn(),
  },
  {
    id: 't1',
    type: 'task' as const,
    label: 'Build dashboard',
    onSelect: vi.fn(),
  },
  {
    id: 'm1',
    type: 'mod' as const,
    label: 'Headroom',
    onSelect: vi.fn(),
  },
];

describe('CommandPalette', () => {
  it('does not render when open is false', () => {
    const { container } = render(
      <CommandPalette open={false} onClose={() => {}} items={ITEMS} />,
    );
    expect(container.querySelector('.bd-cmdk')).toBeNull();
  });

  it('renders when open is true', () => {
    render(<CommandPalette open={true} onClose={() => {}} items={ITEMS} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows all items initially grouped by type', () => {
    render(<CommandPalette open={true} onClose={() => {}} items={ITEMS} />);
    expect(screen.getByText('Odin Agent')).toBeInTheDocument();
    expect(screen.getByText('Build dashboard')).toBeInTheDocument();
    expect(screen.getByText('Headroom')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Mods')).toBeInTheDocument();
  });

  it('filters items by fuzzy match on label/description', async () => {
    render(<CommandPalette open={true} onClose={() => {}} items={ITEMS} />);
    await userEvent.type(
      screen.getByPlaceholderText('Search anything…'),
      'orchestrator',
    );
    // Only "Odin Agent" (description contains "orchestrator") survives.
    expect(screen.getByText('Odin Agent')).toBeInTheDocument();
    expect(screen.queryByText('Build dashboard')).toBeNull();
    expect(screen.queryByText('Headroom')).toBeNull();
  });

  it('shows "No results" when no items match', async () => {
    render(<CommandPalette open={true} onClose={() => {}} items={ITEMS} />);
    await userEvent.type(
      screen.getByPlaceholderText('Search anything…'),
      'zzzzzzz',
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('arrow keys cycle through visible items', async () => {
    render(<CommandPalette open={true} onClose={() => {}} items={ITEMS} />);
    await userEvent.type(screen.getByPlaceholderText('Search anything…'), 'a');
    // After filtering 'a' we may still see multiple results — just check
    // that pressing ArrowDown moves activeIndex.
    const before = document.querySelector('.bd-cmdk__item--active');
    await userEvent.keyboard('{ArrowDown}');
    const after = document.querySelector('.bd-cmdk__item--active');
    // Active highlight class moved from one item to the next.
    expect(before).not.toBe(after);
  });

  it('clicking an item triggers onSelect and closes the palette', async () => {
    const onClose = vi.fn();
    render(
      <CommandPalette open={true} onClose={onClose} items={ITEMS} />,
    );
    await userEvent.click(screen.getByText('Headroom'));
    expect(ITEMS[2].onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the palette', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} onClose={onClose} items={ITEMS} />);
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    // The keydown handler is on the .bd-cmdk wrapper; dispatch from there.
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
