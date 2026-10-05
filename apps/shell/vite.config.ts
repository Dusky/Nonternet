import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  // The React Compiler (1.0) memoizes components and hooks at build time, so screens re-render only what changed
  // without hand-written useMemo/useCallback (decided 2026-10-04, docs/17 P13).
  plugins: [
    react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } }),
    // The service worker (src/sw/sw.ts, docs/10), built with the list of the shell's own files to keep. The manifest
    // is not made here: core serves it from the site config (/api/v1/site/manifest.webmanifest), so the name is never
    // built in. The shell registers the worker itself (main.tsx).
    VitePWA({
      strategies: 'injectManifest', srcDir: 'src/sw', filename: 'sw.ts', manifest: false, injectRegister: false,
      injectManifest: { globPatterns: ['index.html', 'assets/index-*.{js,css}', 'assets/vendor-*.js', 'assets/widgets-*.js'] },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // The libraries every page needs go in one file that rarely changes, so a new release of our own code does not make
        // browsers fetch React again, and the main file is just our code.
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@tanstack|use-sync-external-store)\//.test(id)) return 'vendor';
          // The interface widgets (React Aria, toasts, the palette): also on every page, also rarely changing.
          if (/node_modules\/(react-aria|react-aria-components|react-stately|@react-aria|@react-stately|@react-types|@internationalized|@swc\/helpers|sonner|cmdk|@radix-ui)\//.test(id)) return 'widgets';
          return undefined;
        },
      },
    },
    // The editor (CodeMirror, about 570 KB) is its own file, fetched only when someone opens a file in the studio; anything bigger than
    // that, or any other file over 500 KB, is still warned about.
    chunkSizeWarningLimit: 600,
  },
  // Vite's own CORS handling would answer the widget API's preflight for it, and only for localhost.
  // The API answers its own (see core routes/widgets.ts), so leave it alone.
  server: { port: 5173, proxy, cors: false },
  preview: { proxy, cors: false, headers: securityHeaders },
});
