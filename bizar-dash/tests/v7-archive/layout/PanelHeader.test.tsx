import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PanelHeader } from '../../../src/web/ui/layout/PanelHeader';

describe('PanelHeader', () => {
  it('renders title and description', () => {
    render(<PanelHeader title="Title" description="Description" />);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(
      <PanelHeader
        title="Title"
        actions={<button>Save</button>}
      />,
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('renders children before the title when provided', () => {
    const { container } = render(
      <PanelHeader title="After">
        <span data-testid="child">Before</span>
      </PanelHeader>,
    );
    expect(container.querySelector('.bizar-panel__header-text')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });
});
