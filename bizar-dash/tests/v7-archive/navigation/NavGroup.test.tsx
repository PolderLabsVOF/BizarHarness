// tests/ui/navigation/NavGroup.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Folder, Settings } from 'lucide-react';
import { NavGroup } from '../../../src/web/ui/navigation/NavGroup';

const ITEMS = [
  { label: 'First', icon: Settings, href: '/first' },
  { label: 'Second', icon: Settings, href: '/second' },
];

describe('NavGroup', () => {
  it('renders the group label', () => {
    render(<NavGroup label="Workspace" items={ITEMS} />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('projects each item through NavLink', () => {
    render(<NavGroup label="W" items={ITEMS} />);
    expect(screen.getByRole('link', { name: /first/i })).toHaveAttribute(
      'href',
      '/first',
    );
    expect(screen.getByRole('link', { name: /second/i })).toHaveAttribute(
      'href',
      '/second',
    );
  });

  it('toggles open/closed on header click', async () => {
    const { container } = render(
      <NavGroup label="W" items={ITEMS} defaultOpen={true} />,
    );
    // Start open
    expect(container.querySelector('.bd-nav-group--open')).toBeInTheDocument();
    // Click to close
    await userEvent.click(screen.getByText('W'));
    expect(container.querySelector('.bd-nav-group--open')).toBeNull();
    // Click to open
    await userEvent.click(screen.getByText('W'));
    expect(container.querySelector('.bd-nav-group--open')).toBeInTheDocument();
  });

  it('does not toggle when collapsible is false', async () => {
    const { container } = render(
      <NavGroup label="W" items={ITEMS} collapsible={false} />,
    );
    expect(container.querySelector('.bd-nav-group--non-collapsible')).toBeInTheDocument();
    await userEvent.click(screen.getByText('W'));
    // Header click is a no-op when not collapsible.
    expect(container.querySelector('.bd-nav-group--non-collapsible')).toBeInTheDocument();
  });
});
