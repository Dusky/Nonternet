import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev and preview, /api and /oidc go to core (CORE_URL, default http://localhost:3000). In
// compose and production, Caddy does the routing.
const core = process.env.CORE_URL ?? 'http://localhost:3000';
// The Chat app's WebSocket goes to Ergo (IRC_WS_URL, default ws://localhost:8097), as Caddy does in production.
const irc = process.env.IRC_WS_URL ?? 'ws://localhost:8097';
// The MUD window's WebSocket goes to Evennia (MUD_WS_URL, default ws://localhost:4002).
const mud = process.env.MUD_WS_URL ?? 'ws://localhost:4002';
// The Terminal window's WebSocket goes to the BBS (BBS_WS_URL, default ws://localhost:2380).
const bbs = process.env.BBS_WS_URL ?? 'ws://localhost:2380';
const proxy = { '/api': core, '/oidc': core, '/widgets': core, '^/ring/': core, '/ws/irc': { target: irc, ws: true, rewrite: () => '/' }, '/ws/mud': { target: mud, ws: true, rewrite: () => '/' }, '/ws/bbs': { target: bbs, ws: true, rewrite: () => '/' } };

// The security headers Caddy sends in production (deploy/caddy/Caddyfile.prod), sent by `vite preview` too so the
// end-to-end tests run under the same policy. The homes domain for the studio's preview frame comes from
// CSP_FRAME_SRC. A test checks this policy matches the Caddyfile.
export const CSP_BASE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': `${CSP_BASE}; frame-src ${process.env.CSP_FRAME_SRC ?? "'self' http: https:"}`,
};

export default defineConfig({
  plugins: [react()],
  // Vite's own CORS handling would answer the widget API's preflight for it, and only for localhost.
  // The API answers its own (see core routes/widgets.ts), so leave it alone.
  server: { port: 5173, proxy, cors: false },
  preview: { proxy, cors: false, headers: securityHeaders },
});
