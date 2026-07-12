import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // The v8 dashboard is the only test surface that ships.
    include: [
      'tests/**/*.test.{ts,tsx}',
      'src/web/v8/**/*.test.{ts,tsx}',
    ],
    exclude: ['tests/**/*.test.mjs'],
  },
});
