/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5317, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
