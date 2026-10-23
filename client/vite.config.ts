import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  // MapLibre 6 loads its worker from a file beside its own; pre-bundling moves it away from that file.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // Serve processed map/audio assets from the repo-level /assets folder.
  publicDir: resolve(__dirname, '../assets'),
  build: {
    rollupOptions: {
      input: {
        sim: resolve(__dirname, 'index.html'),
        instructor: resolve(__dirname, 'instructor.html'),
      },
    },
  },
});
