import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Box } from '../../../src/web/ui/primitives/Box';

describe('Box', () => {
  it('renders a div by default', () => {
    const { container } = render(<Box>hello</Box>);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('box');
  });

  it('renders the requested semantic tag', () => {
    const { container } = render(<Box as="section">x</Box>);
    expect(container.firstChild?.nodeName).toBe('SECTION');
  });

  it('composes padding/margin/bg/border classes from props', () => {
    const { container } = render(
      <Box p={3} m={2} bg="1" border="subtle" rounded="md" data-testid="b" />,
    );
    const el = screen.getByTestId('b');
    expect(el).toHaveClass('box-p-3', 'box-m-2', 'box-bg-1', 'box-border-subtle', 'box-rounded-md');
  });

  it('renders zero values without falsy-skip', () => {
    const { container } = render(<Box p={0} m={0} data-testid="b" />);
    const el = screen.getByTestId('b');
    expect(el).toHaveClass('box-p-0', 'box-m-0');
  });

  it('composes display and position classes', () => {
    const { container } = render(
      <Box display="flex" position="relative" data-testid="b" />,
    );
    const el = screen.getByTestId('b');
    expect(el).toHaveClass('box-d-flex', 'box-pos-relative');
  });

  it('passes through arbitrary HTML attributes', () => {
    const { container } = render(
      <Box id="x" aria-label="region" data-foo="bar" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.id).toBe('x');
    expect(el.getAttribute('aria-label')).toBe('region');
    expect(el.getAttribute('data-foo')).toBe('bar');
  });
});
