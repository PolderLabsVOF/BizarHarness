import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/web'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Single dashboard entry — v8. The legacy v7 (index.html) and v7
      // mobile (mobile.html) entries were removed in the v8 cutover.
      input: {
        main: resolve(__dirname, 'src/web/v8.html'),
      },
      // Code-split views so the initial bundle only ships what the
      // Overview needs. Manual chunks are safe in v8 (no shared
      // legacy state).
      output: {
        manualChunks(id) {
          if (id.includes('/v8/views/')) return 'v8-views';
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
