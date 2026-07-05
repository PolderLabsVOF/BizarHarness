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
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/recharts/')) return 'charts';
          if (id.includes('node_modules/react-markdown/') || id.includes('node_modules/remark-gfm/')) return 'markdown';
          if (id.includes('node_modules/@xyflow/')) return 'flow';
          if (id.includes('node_modules/@mdx-js/')) return 'editor';
          if (id.includes('node_modules/lucide-react/')) return 'icons';
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});