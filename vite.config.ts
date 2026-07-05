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
        // Function-form manualChunks: group modules by path patterns rather than
        // requiring them to be entry-level imports (array form fails when a module
        // isn't directly reachable from the entry chunk root).
        manualChunks: (id) => {
          if (!id) return;
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('react-markdown') || id.includes('remark')) return 'markdown';
            if (id.includes('react-router')) return 'router';
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('fuse.js')) return 'fuzzy';
            if (id.includes('recharts')) return 'charts';
            if (id.includes('@xyflow')) return 'flow';
            if (id.includes('@mdx-js')) return 'editor';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});