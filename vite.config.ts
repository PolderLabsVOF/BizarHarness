import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'bizar-dash/src/web'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'bizar-dash/dist'),
    emptyOutDir: true,
    sourcemap: 'hidden',
    rollupOptions: {
      // Single dashboard entry — v8. The legacy v7 (index.html) and v7
      // mobile (mobile.html) entries were removed in the v8 cutover.
      input: {
        main: resolve(__dirname, 'bizar-dash/src/web/v8.html'),
      },
      output: {
        // We DON'T manually group v8 views — each `React.lazy()` is
        // already a separate chunk. Grouping them here would defeat the
        // code-split. We do group large third-party deps so they aren't
        // duplicated across many chunks.
        manualChunks(id) {
          if (id.includes('node_modules/@dnd-kit')) return 'dnd-kit';
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/cmdk')) return 'cmdk';
          return undefined;
        },
      },
    },
    // Lift the chunk-size ceiling for code-split views: a single
    // kanban view with dnd-kit + recharts is bigger than 500 kB
    // unminified, but gzip shrinks it well under the warning line.
    chunkSizeWarningLimit: 800,
  },
  define: {
    // Surfaced via `import.meta.env.VITE_BUILD_SHA` so the sidebar
    // footer can render the real git SHA instead of "build placeholder".
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(
      process.env['BIZAR_BUILD_SHA'] ?? 'dev',
    ),
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});