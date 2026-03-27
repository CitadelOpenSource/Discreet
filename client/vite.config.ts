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
    fs: {
      allow: ['..'], // Allow serving discreet-crypto/pkg/ and discreet-kernel/pkg/ from parent directory
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  worker: {
    format: 'es',  // Module workers for kernel WASM isolation
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
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('/react-is/') ||
              id.includes('/use-sync-external-store/')
            ) {
              return 'vendor-react';
            }
            if (
              id.includes('/i18next/') ||
              id.includes('/react-i18next/') ||
              id.includes('/i18next-browser-languagedetector/')
            ) {
              return 'vendor-i18n';
            }
            return 'vendor';
          }
        },
      },
    },
  },
});
