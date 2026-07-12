import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ViewHeader } from '../../../src/web/ui/layout/ViewHeader';

describe('ViewHeader', () => {
  it('renders title and subtitle', () => {
    render(<ViewHeader title="Tasks" subtitle="Live kanban board" />);
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Live kanban board')).toBeInTheDocument();
  });

  it('renders the actions slot', () => {
    render(
      <ViewHeader
        title="Tasks"
        actions={<button>Refresh</button>}
      />,
    );
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('renders an eyebrow row above the title when provided', () => {
    const { container } = render(
      <ViewHeader title="Overview" eyebrow={<span>Dashboard</span>} />,
    );
    const eyebrow = container.querySelector('.bizar-view-header__eyebrow');
    expect(eyebrow).toBeInTheDocument();
    expect(eyebrow?.textContent).toBe('Dashboard');
  });

  it('uses <h1> for the page title (not a panel-level h3)', () => {
    const { container } = render(<ViewHeader title="Overview" />);
    const h1 = container.querySelector('h1');
    expect(h1).toBeInTheDocument();
    expect(h1?.textContent).toBe('Overview');
  });

  it('accepts an extra className for view-specific tweaks', () => {
    const { container } = render(<ViewHeader title="X" className="agents-header" />);
    expect(container.querySelector('.bizar-view-header')).toHaveClass('agents-header');
  });

  it('renders nothing in the actions slot when not provided', () => {
    const { container } = render(<ViewHeader title="No actions" />);
    expect(container.querySelector('.bizar-view-header__actions')).not.toBeInTheDocument();
  });
});