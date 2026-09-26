// The documentation against the code and data it describes: the npm scripts,
// data files and source paths the docs name must exist, the 3D module map must
// list real files, design.md's event list and feature-area letters must cover
// what the code and docs use, the build budgets architecture.md quotes must be
// the ones the tests assert, and the map and city counts the docs quote must
// match the shipped public/data (within a few per cent, so a re-bake that moves
// them fails here until the docs follow).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, ROOT), 'utf8');
const exists = (rel: string): boolean => existsSync(new URL(rel, ROOT));

/** Markdown under a directory, recursively, as root-relative paths. */
function markdownIn(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const rel = `${dir}${e.name}`;
    if (e.isDirectory()) out.push(...markdownIn(`${rel}/`));
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** Every Markdown file the project keeps: the README, the project instructions and docs/. */
const DOCS = ['README.md', 'CLAUDE.md', ...markdownIn('docs/')];
/** Docs that describe the code as it stands (the research notes cite sources, not code). */
const CODE_DOCS = DOCS.filter((d) => !d.startsWith('docs/research/'));

/** TypeScript sources under a directory, recursively, as root-relative paths. */
function sourcesIn(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    const rel = `${dir}${e.name}`;
    if (e.isDirectory()) out.push(...sourcesIn(`${rel}/`));
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts);

/** A number as the docs write it: "7,983", "3.5k", "1.5". */
function num(s: string): number {
  const t = s.replace(/,/g, '');
  return t.endsWith('k') ? parseFloat(t) * 1000 : parseFloat(t);
}

/** The first match of `re` in `text`, failing with the doc name when the phrase is missing. */
function quoted(text: string, re: RegExp, doc: string): RegExpMatchArray {
  const m = text.match(re);
  expect(m, `${doc} should state ${re}`).not.toBeNull();
  return m!;
}

function expectNear(stated: number, actual: number, label: string, tolerance = 0.05): void {
  expect(Math.abs(stated - actual) / actual, `${label}: docs say ${stated}, data has ${actual}`).toBeLessThanOrEqual(tolerance);
}

describe('docs name things that exist', () => {
  it('names only npm scripts that package.json defines', () => {
    const missing: string[] = [];
    for (const doc of DOCS) {
      for (const m of read(doc).matchAll(/npm run ([\w:-]+)/g)) if (!scripts.includes(m[1])) missing.push(`${doc}: npm run ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('names only public/data files that exist', () => {
    const missing: string[] = [];
    for (const doc of DOCS) {
      for (const m of read(doc).matchAll(/public\/data\/([\w.\-/]*)/g)) {
        const file = m[1].replace(/[./]+$/, '');
        if (file && !exists(`public/data/${file}`)) missing.push(`${doc}: public/data/${file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('points only at source paths that exist', () => {
    const missing: string[] = [];
    for (const doc of CODE_DOCS) {
      for (const m of read(doc).matchAll(/`((?:src|scripts|tests|docs|public)\/[^`\s]*)`/g)) {
        const path = m[1];
        if (/[*<{]/.test(path)) continue;
        if (!exists(path.replace(/\/$/, ''))) missing.push(`${doc}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('lists only real files in the 3D module map', () => {
    const doc = read('docs/3d/architecture.md');
    const block = quoted(doc, /## 2\. Module layout\s+```\n([\s\S]*?)```/, 'docs/3d/architecture.md')[1];
    const stack: { indent: number; dir: string }[] = [];
    const listed: string[] = [];
    for (const line of block.split('\n')) {
      if (!line.trim()) continue;
      const indent = line.length - line.trimStart().length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const dir = stack.length ? stack[stack.length - 1].dir : '';
      // Names come first, separated by single spaces; two or more spaces start the description.
      const names = line.trim().split(/\s{2,}/)[0].split(' ');
      if (names.length === 1 && names[0].endsWith('/')) {
        stack.push({ indent, dir: `${dir}${names[0]}` });
        continue;
      }
      for (const n of names) if (/\.(ts|tsx|mjs)$/.test(n) && !n.includes('*')) listed.push(`${dir}${n}`);
    }
    expect(listed.length).toBeGreaterThan(50);
    expect(listed.filter((f) => !exists(f))).toEqual([]);
  });
});

describe('docs agree with the code', () => {
  it("lists every event the code emits among design.md's built-in events", () => {
    const doc = 'docs/design.md';
    const list = quoted(read(doc).replace(/\s+/g, ' '), /Built-in events: (.*?)\. - \*\*/, doc)[1];
    const listed = new Set([...list.matchAll(/`(\w+)`/g)].map((m) => m[1]));
    const emitted = new Set<string>();
    for (const file of sourcesIn('src/')) for (const m of read(file).matchAll(/\bemit\(\s*'([\w-]+)'/g)) emitted.add(m[1]);
    expect(emitted.size).toBeGreaterThan(5);
    expect([...emitted].filter((e) => !listed.has(e)).sort()).toEqual([]);
  });

  it('refers to design.md feature areas by the name and letters design.md gives them', () => {
    const areas = new Set([...read('docs/design.md').split('## Feature areas')[1].matchAll(/^- \*\*([A-Z])\. /gm)].map((m) => m[1]));
    expect(areas.size).toBeGreaterThan(3);
    const wrong: string[] = [];
    for (const doc of CODE_DOCS) {
      const text = read(doc);
      for (const m of text.matchAll(/\b[Ww]orkstream [A-Z]\b|\b[A-Z] workstream\b/g)) wrong.push(`${doc}: "${m[0]}" (design.md calls these feature areas)`);
      for (const m of text.matchAll(/\b[Ff]eature area ([A-Z])\b/g)) if (!areas.has(m[1])) wrong.push(`${doc}: "${m[0]}" is not a design.md feature area`);
    }
    expect(wrong).toEqual([]);
  });

  it('quotes the build budgets the world3d tests assert', () => {
    const doc = 'docs/3d/architecture.md';
    const table = quoted(read(doc), /\*\*Build budgets the tests hold\*\*[^\n]*\n\n((?:\|.*\n)+)/, doc)[1];
    const rows = table.trim().split('\n').slice(2);
    expect(rows.length).toBeGreaterThan(5);
    const wrong: string[] = [];
    for (const row of rows) {
      const [, content, budget] = row.split('|');
      const file = `tests/${quoted(budget, /`([\w-]+)`/, doc)[1]}.test.ts`;
      const asserted = new Set([...read(file).matchAll(/toBeLessThan\(([\d_.]+)\)/g)].map((m) => Number(m[1].replace(/_/g, ''))));
      for (const m of budget.matchAll(/< ([\d.]+) ?(M|k|s)?/g)) {
        // Millions and thousands of triangles or instances; seconds of CPU are asserted in milliseconds.
        const scale = m[2] === 'M' ? 1e6 : m[2] ? 1e3 : 1;
        if (!asserted.has(Math.round(parseFloat(m[1]) * scale))) wrong.push(`${content.trim()}: "${m[0]}" is not a budget ${file} asserts`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('docs quote the shipped data', () => {
  it('gives the road graph, place and landmark counts design.md states', () => {
    const doc = 'docs/design.md';
    const text = read(doc).replace(/\s+/g, ' ');
    const graph = JSON.parse(read('public/data/graph.json')) as {
      nodes: number[];
      edges: [number, number, number, number, number, number, number[], number?, number?][];
      portals: unknown[];
      signals: number[];
    };
    const pois = JSON.parse(read('public/data/pois.json')) as unknown[];
    const landmarks = JSON.parse(read('src/content/landmarks.json')) as unknown[];
    const roadKm = graph.edges.reduce((sum, e) => sum + (e[8] ? 0 : e[5]), 0) / 1000;

    const g = quoted(text, /([\d,]+) nodes and ([\d,]+) edges \(([\d,]+) km of road\), with traffic signals at ([\d,]+) of its nodes/, doc);
    expectNear(num(g[1]), graph.nodes.length / 2, 'graph nodes');
    expectNear(num(g[2]), graph.edges.length, 'graph edges');
    expectNear(num(g[3]), roadKm, 'road km');
    expectNear(num(g[4]), graph.signals.length, 'signal nodes');
    expect(num(quoted(text, /(\d+) portals/, doc)[1])).toBe(graph.portals.length);
    expectNear(num(quoted(text, /about ([\d.,]+k?) named POIs/, doc)[1]), pois.length, 'POIs');
    expect(num(quoted(text, /(\d+) curated landmarks/, doc)[1])).toBe(landmarks.length);
  });

  it('gives the city3d.json counts and size architecture.md states', () => {
    const doc = 'docs/3d/architecture.md';
    const text = read(doc).replace(/\s+/g, ' ');
    const raw = readFileSync(new URL('public/data/city3d.json', ROOT));
    const city = JSON.parse(raw.toString('utf8')) as { buildings: unknown[]; roads: { ways: unknown[] }; areas: unknown[]; trees: number[]; props: number[] };

    const c = quoted(text, /([\d,]+) building footprints, ([\d,]+) road ways, ([\d,]+) areas, ([\d,]+) OSM trees and ([\d,]+) OSM street-furniture points/, doc);
    expectNear(num(c[1]), city.buildings.length, 'buildings');
    expectNear(num(c[2]), city.roads.ways.length, 'road ways');
    expectNear(num(c[3]), city.areas.length, 'areas');
    expectNear(num(c[4]), city.trees.length / 3, 'OSM trees');
    expectNear(num(c[5]), city.props.length / 3, 'OSM street furniture');

    const size = quoted(text, /The file is ([\d.]+) MB, ([\d.]+) MB gzipped/, doc);
    expectNear(num(size[1]) * 1e6, statSync(new URL('public/data/city3d.json', ROOT)).size, 'city3d.json size', 0.1);
    expectNear(num(size[2]) * 1e6, gzipSync(raw).length, 'city3d.json gzipped', 0.1);
  });
});
