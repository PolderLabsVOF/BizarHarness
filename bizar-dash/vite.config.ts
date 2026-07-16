import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/web'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Single dashboard entry. The legacy v7 (index.html) and v7
      // mobile (mobile.html) entries were removed in the v8 cutover;
      // the SPA is now built as `index.html` so the server's
      // dist/index.html fallback path resolves correctly.
      //
      // NOTE: this file is shadowed by the repo-root vite.config.ts when
      // `npm run build:dash` is invoked from the repo root (vite walks
      // up looking for a config and finds the root one first). The two
      // files are kept in sync so the dash subdir can also be built in
      // isolation.
      input: {
        main: resolve(__dirname, 'src/web/index.html'),
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
    // Surfaced via `import.meta.env.VITE_APP_VERSION` so the sidebar
    // footer renders the actual package version (kept in sync via the
    // release pipeline).
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      process.env['BIZAR_APP_VERSION'] ?? pkg.version,
    ),
  },
  server: {
    port: 5174,
    strictPort: false,
    // v8 dashboard calls /api/* and /ws over the browser's same origin
    // (port 5174). In dev we proxy those to the backend on PORT (4098
    // by default) so the React app talks to the running server. In prod
    // the backend serves /api/* itself.
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || `http://127.0.0.1:${process.env.PORT || '4098'}`,
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_BACKEND_URL || `http://127.0.0.1:${process.env.PORT || '4098'}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
