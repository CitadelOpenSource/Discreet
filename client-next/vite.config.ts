import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    wasm(),          // Native WASM import support
    topLevelAwait(), // Allows `await init()` at module scope
  ],
  base: '/app/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
    // App shell includes auth, WebSocket, routing, encryption — cannot be further split
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      external: ['discreet-crypto'],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router'))
              return 'vendor-react';
            if (id.includes('lucide') || id.includes('react-icons'))
              return 'vendor-icons';
            if (id.includes('i18n'))
              return 'vendor-i18n';
            return 'vendor';
          }
        },
      },
    },
  },
});
