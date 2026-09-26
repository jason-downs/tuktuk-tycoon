# Tuk-Tuk Tycoon: Chiang Mai

Start as a humble tuk-tuk driver renting a tired three-wheeler at Tha Phae Gate. Haggle fares with backpackers,
monks, market vendors and digital nomads, learn the one-way moat, hire drivers and grow the biggest tuk-tuk company
in Lanna — on a street-accurate map of Chiang Mai built from OpenStreetMap.

## Play

```bash
npm install
npm run dev
```

Open http://localhost:5317.

## Develop

- `npm run dev` — dev server on port 5317
- `npm test` — Vitest (node env; loads the real map data from `public/data`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck + production bundle in `dist/`
- `npm run map:fetch` / `npm run map:build` — refetch OSM data from Overpass (set `OVERPASS_URL` to use a mirror) and
  rebuild `public/data`; `node scripts/fetch-glyphs.mjs` refreshes the map-label glyphs

Stack: Vite, TypeScript, React 19, MapLibre GL 6. See [docs/design.md](docs/design.md) for the game design and code
structure, and [docs/research](docs/research) for the fact-checked research behind places, fares, costs, festivals and
culture.

## Credits

- Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
- Map label glyphs: Noto Sans (SIL Open Font License), served by OpenFreeMap.
