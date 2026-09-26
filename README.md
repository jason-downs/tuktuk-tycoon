# Tuk-Tuk Tycoon: Chiang Mai

Start as a humble tuk-tuk driver renting a tired three-wheeler at Tha Phae Gate. Haggle fares with backpackers,
monks, market vendors and digital nomads, learn the one-way moat, hire drivers and grow the biggest tuk-tuk company
in Lanna — in a 3D, street-accurate central Chiang Mai generated from OpenStreetMap.

## Play

```bash
npm install
npm run dev
```

Open http://localhost:5317. Drive your own tuk-tuk (WASD, E to pick up, G for GPS autodrive), press Tab to switch to
Manage mode and run the fleet, and M to open the flat city map for planning.

## Develop

- `npm run dev` — dev server on port 5317 (`?stats` shows frame statistics; `?view=map` opens the flat map instead
  of the 3D city)
- `npm test` — Vitest (node env; loads the real map data from `public/data`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck + production bundle in `dist/`
- Map data, in pipeline order:
  - `npm run map:fetch` — download the OSM extracts from Overpass into `data-raw/`, which is not checked in (set
    `OVERPASS_URL` to use a mirror)
  - `npm run map:build` — read `data-raw/` and write the road graph, places and flat-map layers in `public/data`
  - `npm run city:build` — read `data-raw/` and the graph's origin and write the 3D city data,
    `public/data/city3d.json` (set `DATA_RAW` to read another checkout's `data-raw/`)
  - `node scripts/fetch-glyphs.mjs` — download the flat map's label glyphs for the names in `public/data` into
    `public/fonts`

Stack: Vite, TypeScript, React 19, three.js for the 3D city, and MapLibre GL 6 for the flat city map (loaded only
when it is opened). See [docs/design.md](docs/design.md) for the game design and code structure,
[docs/3d/architecture.md](docs/3d/architecture.md) for how the 3D city is built and drawn, and
[docs/research](docs/research) for the fact-checked research behind places, fares, costs, festivals and culture.

## Credits

- Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
- Map label glyphs: Noto Sans (SIL Open Font License), served by OpenFreeMap.
