import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Panel } from '../../../src/web/ui/layout/Panel';

describe('Panel', () => {
  it('renders title and body content', () => {
    render(<Panel title="Summary">body text</Panel>);
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('body text')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <Panel title="Title" description="A short description.">
        body
      </Panel>,
    );
    expect(screen.getByText('A short description.')).toBeInTheDocument();
  });

  it('renders actions slot when provided', () => {
    render(
      <Panel title="Title" actions={<button>Action</button>}>
        body
      </Panel>,
    );
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('does not render a header block when no header fields are set', () => {
    const { container } = render(<Panel>body</Panel>);
    expect(container.querySelector('.bizar-panel__header')).not.toBeInTheDocument();
    expect(container.querySelector('.bizar-panel__body')).toBeInTheDocument();
  });

  it('applies the filled variant modifier', () => {
    const { container } = render(<Panel variant="filled">body</Panel>);
    const panel = container.querySelector('.bizar-panel');
    expect(panel?.className).toContain('bizar-panel--filled');
  });

  it('applies the padding modifier on the body', () => {
    const { container } = render(<Panel padding={2}>body</Panel>);
    const body = container.querySelector('.bizar-panel__body');
    expect(body?.className).toContain('bizar-panel__padding--2');
  });

  it('renders as a <section> element', () => {
    const { container } = render(<Panel title="t">b</Panel>);
    expect(container.querySelector('section.bizar-panel')).toBeInTheDocument();
  });
});
