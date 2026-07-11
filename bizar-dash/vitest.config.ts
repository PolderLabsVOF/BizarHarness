import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // tests/ is the canonical location; src/web/components/agents/ covers
    // feature-scoped component tests (e.g. F-035 RoutingDecisions.test.tsx).
    include: ['tests/**/*.test.{ts,tsx}', 'src/web/components/agents/**/*.test.{ts,tsx}'],
    exclude: ['tests/**/*.test.mjs'],
  },
});
