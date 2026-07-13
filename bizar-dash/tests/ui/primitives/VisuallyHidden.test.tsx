/**
 * tests/ui/primitives/VisuallyHidden.test.tsx
 *
 * v8 migration — VisuallyHidden test rewritten against the v8 component.
 *
 * v7 used class `vh`; v8 uses `v8-visually-hidden`. v8 also exposes
 * `as` (ElementType) and `forceVisible` props that v7 didn't have.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from '../../../src/web/v8/ui/index.js';

describe('VisuallyHidden (v8)', () => {
  it('renders its children inside a span by default', () => {
    render(<VisuallyHidden>hidden text</VisuallyHidden>);
    const el = screen.getByText('hidden text');
    expect(el.tagName).toBe('SPAN');
  });

  it('applies the v8 visually-hidden class for SR-only styling', () => {
    render(<VisuallyHidden>sr-only</VisuallyHidden>);
    expect(screen.getByText('sr-only')).toHaveClass('v8-visually-hidden');
  });

  it('renders as a different element when `as` is provided', () => {
    render(<VisuallyHidden as="div">label</VisuallyHidden>);
    expect(screen.getByText('label').tagName).toBe('DIV');
  });

  it('does NOT apply the visually-hidden class when forceVisible is true', () => {
    render(<VisuallyHidden forceVisible>debug</VisuallyHidden>);
    const el = screen.getByText('debug');
    expect(el).not.toHaveClass('v8-visually-hidden');
  });

  it('appends the user-provided className alongside the v8 class', () => {
    render(<VisuallyHidden className="extra">label</VisuallyHidden>);
    const el = screen.getByText('label');
    expect(el).toHaveClass('v8-visually-hidden');
    expect(el).toHaveClass('extra');
  });
});