/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // Agent worktrees live under .claude/ inside the project; their files are not this app's.
  server: { port: 5317, strictPort: true, watch: { ignored: ['**/.claude/**'] } },
  // Many tests load and simulate the real city, so allow more than the 5 s default.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20_000 },
});
