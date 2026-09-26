// Downloads the SDF glyph ranges MapLibre needs to draw every label in the
// game's map data, from OpenFreeMap's font server (Noto Sans, SIL OFL 1.1),
// into public/fonts/<fontstack>/<start>-<end>.pbf.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';


const SOURCE = 'https://tiles.openfreemap.org/fonts';
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold'];
const DATA = new URL('../public/data/', import.meta.url);
const OUT = new URL('../public/fonts/', import.meta.url);

const codepoints = new Set();
const addText = (t) => {
  if (typeof t !== 'string') return;
  for (const ch of t) codepoints.add(ch.codePointAt(0));
};
// Only GeoJSON layers carry map labels; POI names are drawn by the browser.
for (const file of await readdir(DATA)) {
  if (!file.endsWith('.geojson')) continue;
  const json = JSON.parse(await readFile(new URL(file, DATA), 'utf8'));
  for (const f of json.features) addText(f.properties?.n);
}
const landmarks = JSON.parse(await readFile(new URL('../src/content/landmarks.json', import.meta.url), 'utf8'));
for (const l of landmarks) addText(l.name);
// ASCII and Latin-1 are always needed for UI-ish labels.
for (let c = 32; c < 256; c++) codepoints.add(c);

const ranges = [...new Set([...codepoints].map((c) => Math.floor(c / 256) * 256))].sort((a, b) => a - b);
console.log(`${codepoints.size} code points in ${ranges.length} ranges: ${ranges.map((r) => `${r}-${r + 255}`).join(', ')}`);

for (const font of FONTS) {
  const dir = new URL(`${encodeURIComponent(font)}/`, OUT);
  await mkdir(dir, { recursive: true });
  for (const start of ranges) {
    const name = `${start}-${start + 255}.pbf`;
    const url = `${SOURCE}/${encodeURIComponent(font)}/${name}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'tuktuk-tycoon-map-builder/0.1' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(new URL(name, dir), buf);
    console.log(`${font} ${name} ${buf.length} B`);
  }
}
