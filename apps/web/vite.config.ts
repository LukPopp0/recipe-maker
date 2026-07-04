import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    // Proxy targets the backend dev server; port matches the PORT default
    // in server/src/env.ts.
    proxy: {
      '/api': 'http://localhost:8787',
      '/images': 'http://localhost:8787',
      '/ingredient-images': 'http://localhost:8787',
    },
  },
});
