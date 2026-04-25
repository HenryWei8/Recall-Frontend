import { defineConfig } from 'vite';
import path from 'path';

// Override at runtime: GX10_URL=http://<ip>:8081 npm run dev
const GX10_URL = process.env.GX10_URL ?? 'http://10.30.199.103:8081';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: GX10_URL, changeOrigin: true },
    },
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
});
