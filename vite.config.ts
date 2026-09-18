/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite configuration.
 *
 * - The frontend is a pure static bundle. Vercel serves it, and the API lives
 *   beside it as serverless functions under `api/`.
 * - `/api` is proxied during a plain `npm run dev` so frontend code can always use
 *   same-origin relative URLs (`/api/...`) in both dev and production. Running
 *   `vercel dev` instead serves the game AND the API on one port, and needs no proxy.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  // Both servers bind to 0.0.0.0 so a phone on the same Wi-Fi can open
  // http://<this machine's LAN IP>:<port>/ . Vite prints the address as "Network:".
  // On Windows the firewall must allow Node on the private network the first time.
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // `npm run preview` serves the real production build; same LAN exposure so the
  // exact artefact that ships can be tested on a phone.
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2020',
    // Relative base keeps the bundle deployable from a subdirectory as well as root.
    assetsInlineLimit: 4096,
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          react: ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
}));
