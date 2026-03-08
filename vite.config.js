import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT || 3001;
const vitePort = parseInt(process.env.VITE_PORT || '5173');

export default defineConfig({
  plugins: [react()],
  server: {
    port: vitePort,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
});
