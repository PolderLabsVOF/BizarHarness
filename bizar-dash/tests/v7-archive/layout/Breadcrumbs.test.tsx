import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Breadcrumbs } from '../../../src/web/ui/layout/Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders all crumb labels', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Settings', href: '/settings' },
          { label: 'Account' },
        ]}
      />,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('renders the last item with aria-current="page"', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Current' },
        ]}
      />,
    );
    const current = screen.getByText('Current');
    expect(current.closest('[aria-current="page"]')).not.toBeNull();
  });

  it('renders href items as anchors', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/home' },
          { label: 'Current' },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: 'Home' });
    expect(link).toHaveAttribute('href', '/home');
  });

  it('fires onClick when a non-current crumb is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Breadcrumbs
        items={[
          { label: 'Settings', onClick },
          { label: 'Account' },
        ]}
      />,
    );
    await user.click(screen.getByText('Settings'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a custom separator between crumbs', () => {
    const { container } = render(
      <Breadcrumbs
        items={[
          { label: 'A' },
          { label: 'B' },
        ]}
        separator={<span>/</span>}
      />,
    );
    const seps = container.querySelectorAll('.bizar-breadcrumbs__separator');
    expect(seps).toHaveLength(1);
    expect(seps[0].textContent).toBe('/');
  });

  it('renders nothing when items is empty', () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container.querySelector('.bizar-breadcrumbs')).toBeInTheDocument();
    expect(
      container.querySelectorAll('.bizar-breadcrumbs__item').length,
    ).toBe(0);
  });
});
