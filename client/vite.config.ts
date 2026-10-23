import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
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
