import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5199,
    proxy: {
      '/api': { target: 'http://localhost:8099', changeOrigin: true },
    },
  },
});
