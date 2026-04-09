import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // In production, the app is served at rohansagarwal.com/plunder/
  // Caddy strips the /plunder prefix before forwarding to Express,
  // but the browser still needs asset URLs to include /plunder/.
  base: process.env.NODE_ENV === 'production' ? '/plunder/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
});
