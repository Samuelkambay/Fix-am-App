import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The browser calls `${VITE_API_URL}` (default `/api/v1`). In dev and preview, `/api` is proxied to the
// backend so there are no CORS or mixed-origin issues. Override the proxy target with API_PROXY_TARGET.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://localhost:4000';
  const proxy = { '/api': { target, changeOrigin: true } };
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 400,
    },
  };
});
