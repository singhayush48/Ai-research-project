import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plain Vite + React config. The dev server (and `vite preview`) proxies
// /api to the Express backend, so the browser only ever talks to ONE origin:
// no CORS, and the httpOnly session cookie "just works" regardless of whether
// the app is opened as localhost or 127.0.0.1 or on another port.
const backend = `http://localhost:${process.env.VITE_API_PORT || 5000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: backend, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: backend, changeOrigin: false } },
  },
});
