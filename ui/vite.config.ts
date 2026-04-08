import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/jobs': 'http://localhost:3000',
      '/schemas': 'http://localhost:3000',
      '/settings': 'http://localhost:3000',
      '/outputs': 'http://localhost:3000',
      '/chat': 'http://localhost:3000',
      '/entities': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
