import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, proxy: { '/api': 'http://localhost:4000' } },
  preview: { port: 5180, proxy: { '/api': 'http://localhost:4000' } },
  build: { target: 'es2019', chunkSizeWarningLimit: 300 },
});
