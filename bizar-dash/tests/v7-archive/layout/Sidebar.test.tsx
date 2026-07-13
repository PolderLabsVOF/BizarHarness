import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from '../../../src/web/ui/layout/Sidebar';

describe('Sidebar', () => {
  it('renders group labels and items', () => {
    render(
      <Sidebar
        groups={[
          {
            label: 'Main',
            items: [
              { id: 'home', label: 'Home' },
              { id: 'settings', label: 'Settings' },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('fires onItemSelect when an item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Sidebar
        groups={[{ items: [{ id: 'home', label: 'Home' }] }]}
        onItemSelect={onSelect}
      />,
    );
    await user.click(screen.getByText('Home'));
    expect(onSelect).toHaveBeenCalledWith('home');
  });

  it('marks the active item with aria-current', () => {
    render(
      <Sidebar
        activeId="settings"
        groups={[
          {
            items: [
              { id: 'home', label: 'Home' },
              { id: 'settings', label: 'Settings' },
            ],
          },
        ]}
      />,
    );
    const settingsBtn = screen.getByRole('button', { name: 'Settings' });
    expect(settingsBtn).toHaveAttribute('aria-current', 'page');
  });

  it('disables items when disabled prop is set', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Sidebar
        groups={[
          { items: [{ id: 'home', label: 'Home', disabled: true }] },
        ]}
        onItemSelect={onSelect}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Home' });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders href items as anchor links', () => {
    render(
      <Sidebar
        groups={[{ items: [{ id: 'docs', label: 'Docs', href: '/docs' }] }]}
      />,
    );
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toHaveAttribute('href', '/docs');
  });

  it('renders footer slot at the bottom', () => {
    const { container } = render(
      <Sidebar
        groups={[{ items: [{ id: 'home', label: 'Home' }] }]}
        footer={<button>Logout</button>}
      />,
    );
    const footer = container.querySelector('.bizar-sidebar__footer');
    expect(footer).toBeInTheDocument();
    expect(footer?.contains(screen.getByText('Logout'))).toBe(true);
  });
});
