import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev and preview, /api and /oidc go to core (CORE_URL, default http://localhost:3000). In
// compose and production, Caddy does the routing.
const core = process.env.CORE_URL ?? 'http://localhost:3000';
const proxy = { '/api': core, '/oidc': core };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
