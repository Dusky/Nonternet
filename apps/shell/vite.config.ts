import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev and preview, /api and /oidc go to core (CORE_URL, default http://localhost:3000). In
// compose and production, Caddy does the routing.
const core = process.env.CORE_URL ?? 'http://localhost:3000';
const proxy = { '/api': core, '/oidc': core, '/widgets': core };

export default defineConfig({
  plugins: [react()],
  // Vite's own CORS handling would answer the widget API's preflight for it, and only for localhost.
  // The API answers its own (see core routes/widgets.ts), so leave it alone.
  server: { port: 5173, proxy, cors: false },
  preview: { proxy, cors: false },
});
