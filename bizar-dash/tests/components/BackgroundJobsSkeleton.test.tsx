/**
 * tests/components/BackgroundJobsSkeleton.test.tsx
 *
 * Verifies BackgroundJobsView renders 3 skeleton rows while loading,
 * matching the visual shape of a job card (not a single big block).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BackgroundJobsView } from '../../src/web/v8/views/BackgroundJobs/BackgroundJobsView.js';

// Mock useFetch to return loading state with no instances
vi.mock('../../src/web/v8/data/useFetch.js', () => ({
  useFetch: vi.fn(() => ({ data: null, loading: true, error: null, refetch: vi.fn() })),
}));

// Mock useWsMessage
vi.mock('../../src/web/v8/data/useWebSocket.js', () => ({
  useWsMessage: vi.fn(),
}));

describe('BackgroundJobsView skeleton loading state', () => {
  it('renders between 3 and 6 skeleton rows while loading (3-4 expected)', () => {
    render(<BackgroundJobsView />);

    // The component renders Skeleton elements with role="presentation" (aria-hidden)
    // We count the skeleton divs that appear during the loading state
    const skeletons = document.querySelectorAll('[aria-hidden="true"]');

    // Filter to only the loading-pulse skeletons (the row ones have specific height ~64px)
    const rowSkeletons = Array.from(skeletons).filter((el) => {
      const style = (el as HTMLElement).style;
      return style.height === '64px';
    });

    expect(rowSkeletons.length).toBeGreaterThanOrEqual(3);
    expect(rowSkeletons.length).toBeLessThanOrEqual(6);
  });
});
