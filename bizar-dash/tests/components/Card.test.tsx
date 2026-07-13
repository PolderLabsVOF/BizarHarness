/**
 * tests/components/Card.test.tsx
 *
 * v8 migration — Card test rewritten against the v8 API.
 *
 * v7 exported `Card / CardTitle / CardMeta` with `variant` strings.
 * v8 exports `Card / CardHeader / CardBody / CardFooter` with the same
 * variant set; `CardTitle` → `CardHeader title={...}`,
 * `CardMeta` → `CardHeader description={...}`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardBody, CardFooter } from '../../src/web/v8/ui/index.js';

describe('Card (v8)', () => {
  it('renders children', () => {
    render(<Card>Hello</Card>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('has the v8 card base class', () => {
    const { container } = render(<Card>Test</Card>);
    expect(container.firstChild).toHaveClass('v8-card');
  });

  it('applies variant class names', () => {
    const variants = ['default', 'elevated', 'ghost', 'outlined'] as const;
    for (const v of variants) {
      const { unmount } = render(<Card variant={v}>x</Card>);
      expect(screen.getByText('x')).toHaveClass(`v8-card--${v}`);
      unmount();
    }
  });

  it('renders CardHeader with title + description, and CardBody / CardFooter slots', () => {
    render(
      <Card>
        <CardHeader title="My Title" description="Meta info" />
        <CardBody>Body content</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
    expect(screen.getByText('Meta info')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('marks the card as interactive when interactive prop is true', () => {
    const { container } = render(<Card interactive>Clickable</Card>);
    expect(container.firstChild).toHaveClass('is-interactive');
  });

  it('removes padding when flush prop is true', () => {
    const { container } = render(<Card flush>Flush</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.padding).toBe('0px');
  });
});