import { Box } from '../ui/primitives/Box.js';
import { Skeleton } from '../ui/feedback/Skeleton.js';
import { Stack } from '../ui/primitives/Stack.js';

/**
 * PageSkeleton — a non-blocking fallback for the lazy Router Suspense
 * boundary. Renders five skeleton rows that approximate the visual
 * weight of a typical view header + the first body row.
 */
export function PageSkeleton(): JSX.Element {
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{ padding: 'var(--space-5) var(--space-6)' }}
    >
      <Stack gap={5}>
        <Skeleton height={32} width="40%" />
        <Skeleton height={16} width="65%" />
        <Stack gap={2}>
          <Skeleton height={14} width="100%" />
          <Skeleton height={14} width="92%" />
          <Skeleton height={14} width="78%" />
        </Stack>
      </Stack>
    </Box>
  );
}
