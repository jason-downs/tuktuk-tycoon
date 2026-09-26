/// <reference types="vitest/config" />
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Matches the files under `<root>/.claude/`, where agent worktrees live; their files are not this app's. Only that
 * one folder: a checkout that is itself one of those worktrees still watches its own files.
 */
export function inAgentDir(root: string): (file: string) => boolean {
  const dir = join(root, '.claude');
  return (file) => file === dir || file.startsWith(dir + sep);
}

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5317, strictPort: true, watch: { ignored: [inAgentDir(fileURLToPath(new URL('.', import.meta.url)))] } },
  // These dependencies are pre-bundled when the dev server starts. A dependency first found while the game runs makes
  // the server re-bundle, and a lazily loaded module it has already served (the City map's MapView) keeps importing the
  // old bundle, which then fails to load.
  optimizeDeps: { include: ['three', 'three/examples/jsm/utils/BufferGeometryUtils.js', 'earcut', 'maplibre-gl'] },
  // Many tests load and simulate the real city, and the suite often shares the machine with other work: the timeout
  // only catches hangs (speed budgets are asserted in CPU time by the tests themselves).
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 90_000 },
});
