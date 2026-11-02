import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { brandAssets } from './vite-brand.ts';

/**
 * The API in dev (apps/server, `pnpm dev`); production puts nginx in front of both. Plan links (/k/<token>) go to
 * the server like in production: it sends this dev server's page back with the plan's link preview.
 */
const API = 'http://127.0.0.1:5310';
const PROXY = { '/api': API, '/auth': API, '/healthz': API, '/k/': API };

export default defineConfig({
  plugins: [react(), brandAssets()],
  server: { port: 5311, strictPort: true, proxy: PROXY },
  preview: { port: 5311, strictPort: true, proxy: PROXY },
  build: {
    target: 'es2022',
    // Fonts stay as files: the CSP (font-src 'self') refuses data: fonts, so an inlined font subset would silently
    // fall back to a system font.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    sourcemap: true,
  },
});
