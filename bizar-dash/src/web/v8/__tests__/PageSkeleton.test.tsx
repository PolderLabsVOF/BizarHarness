import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageSkeleton } from '../shell/PageSkeleton.js';

describe('PageSkeleton', () => {
  it('marks the region as aria-busy and polite for screen readers', () => {
    render(<PageSkeleton />);
    const busy = screen.getByRole('status');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-live', 'polite');
  });
});
