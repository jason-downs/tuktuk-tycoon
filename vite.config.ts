/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5317, strictPort: true },
  // Many tests load and simulate the real city, so allow more than the 5 s default.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20_000 },
});
