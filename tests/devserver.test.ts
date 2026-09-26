// The dev server's file watcher skips the agent worktrees under the project's
// own .claude/ folder and nothing else, so a checkout that is itself one of
// those worktrees still reloads on its own edits.
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config, { inAgentDir } from '../vite.config';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Whether the dev server's watcher skips a file, by the matchers the config gives it. */
function ignored(file: string): boolean {
  const matchers = [config.server?.watch?.ignored ?? []].flat();
  return matchers.some((m) => (typeof m === 'function' ? m(file) : typeof m === 'string' ? matchesGlob(file, m) : m.test(file)));
}

describe('dev server watcher', () => {
  it("watches this checkout's own files, wherever the checkout lives", () => {
    expect(ignored(join(ROOT, 'src/main.tsx'))).toBe(false);
    expect(ignored(join(ROOT, 'index.html'))).toBe(false);
    expect(ignored(join(ROOT, 'public/data/graph.json'))).toBe(false);
  });

  it("skips the agent worktrees in this checkout's .claude folder", () => {
    expect(ignored(join(ROOT, '.claude'))).toBe(true);
    expect(ignored(join(ROOT, '.claude/worktrees/other/src/main.tsx'))).toBe(true);
  });

  it('matches only the .claude folder directly under the root it is given', () => {
    const skip = inAgentDir('/work/app/.claude/worktrees/wf-1');
    expect(skip('/work/app/.claude/worktrees/wf-1/src/main.tsx')).toBe(false);
    expect(skip('/work/app/.claude/worktrees/wf-1/.claude/worktrees/wf-2/src/main.tsx')).toBe(true);
    expect(skip('/work/app/.claude/worktrees/wf-1/.claude-notes/a.md')).toBe(false);
  });
});
