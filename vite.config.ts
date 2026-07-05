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
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});