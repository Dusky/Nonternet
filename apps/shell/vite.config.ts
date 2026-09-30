import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev and preview, /api and /oidc go to core (CORE_URL, default http://localhost:3000). In
// compose and production, Caddy does the routing.
const core = process.env.CORE_URL ?? 'http://localhost:3000';
// The Chat app's WebSocket goes to Ergo (IRC_WS_URL, default ws://localhost:8097), as Caddy does in production.
const irc = process.env.IRC_WS_URL ?? 'ws://localhost:8097';
// The MUD window's WebSocket goes to Evennia (MUD_WS_URL, default ws://localhost:4002).
const mud = process.env.MUD_WS_URL ?? 'ws://localhost:4002';
const proxy = { '/api': core, '/oidc': core, '/widgets': core, '^/ring/': core, '/ws/irc': { target: irc, ws: true, rewrite: () => '/' }, '/ws/mud': { target: mud, ws: true, rewrite: () => '/' } };

export default defineConfig({
  plugins: [react()],
  // Vite's own CORS handling would answer the widget API's preflight for it, and only for localhost.
  // The API answers its own (see core routes/widgets.ts), so leave it alone.
  server: { port: 5173, proxy, cors: false },
  preview: { proxy, cors: false },
});
