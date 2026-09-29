import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api goes to core. In compose and production, Caddy does the routing.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
