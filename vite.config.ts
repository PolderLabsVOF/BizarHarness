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
      input: {
        main: resolve(__dirname, 'bizar-dash/src/web/index.html'),
        mobile: resolve(__dirname, 'bizar-dash/src/web/mobile.html'),
      },
      output: {
        // No manualChunks: any function-form split here is brittle
        // because rollup's chunk graph tracks shared dependencies and
        // can route modules that import each other into separate
        // chunks, producing circular imports
        // (vendor → react-vendor → flow → vendor) that surface as
        // "can't access property 'useState', et is undefined" at boot.
        // Rollup's default heuristic + the per-entry chunks (`main`,
        // `mobile`) produce a working build without that footgun.
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});