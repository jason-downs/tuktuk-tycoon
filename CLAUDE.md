# Tuk-Tuk Tycoon: Chiang Mai

Browser tycoon game on a street-accurate OpenStreetMap map of Chiang Mai. Vite + TypeScript + React 19 + three.js (the 3D city, the main view) + MapLibre GL 6 (the City map planner, loaded only when opened).

## Commands

- `npm run dev` — dev server on http://localhost:5317 (launch config `tuktuk-dev`)
- `npm test` — Vitest (tests/**/*.test.ts, node env; loads the real map data from public/data)
- `npm run typecheck` — `tsc --noEmit` (TypeScript 7)
- `npm run build` — typecheck + production bundle
- `npm run map:fetch` / `npm run map:build` — refetch OSM into data-raw/ (set `OVERPASS_URL` for a mirror) and rebuild public/data; `node scripts/fetch-glyphs.mjs` refreshes map-label glyphs
- `npm run city:build` — bake public/data/city3d.json, the 3D city's source data, from data-raw/; re-run after `map:fetch` or a bbox/origin change (`DATA_RAW` points it at another checkout's data-raw/)

## Layout

- `src/sim/` — pure simulation, no DOM. `Game` (game.ts) owns `state: GameState` (plain JSON, saved verbatim) plus runtime helpers. Core systems: demand.ts, vehicles.ts/movement.ts, dispatch.ts (ride life-cycle), ai.ts (fleet drivers), economy.ts (ledger + 04:00 daily settlement).
- `src/content/` — data with research citations (archetypes, vehicles, upgrades, paints, zones, tips, landmarks.json).
- `src/world3d/` — three.js `World3DView`, the main view: the static city built in a worker by pure-TS builders (`build/`, also run by Vitest), scene layers (`layers/`), sun, weather and festivals (`env/`), camera and HUD. See docs/3d/architecture.md.
- `src/map/` — MapLibre style + `MapView`, the City map planner (canvas overlay for tuk-tuks/passengers).
- `src/audio/` — Web Audio sound: engine, horn, coins, rain.
- `src/ui/` — React. `useGame(game, select)` re-renders at ~5 Hz; `ui` store holds selection/panel state.
- `docs/research/` — fact-checked research notes; cite them when adding numbers. `docs/design.md` — game design and the extension contract.

## Conventions

- Sim coordinates are metres (x east, y north) around the map origin; convert with `graph.projection`.
- Game time is seconds since 00:00 Sun 1 Nov 2026 (see clock.ts). 1× speed = 30 game s per real s.
- New subsystems implement `GameSystem` and register in `src/sim/systems.ts`; keep their state in `game.state.systems[<id>]` and default it when missing (old saves).
- New panels register in `src/ui/panels.tsx`; always-on UI layers in `src/ui/overlays.tsx`; 2D overlay drawing via `registerPainter` (src/map/painters.ts), which draws on the City map and on the 3D view's HUD. 3D scene objects implement `WorldLayer` (src/world3d/layers/types.ts); static city geometry comes from the builders in src/world3d/build/ (no three.js, no DOM).
- Hooks on Game: `demandModifiers`, `fareModifiers`, `speedModifiers`, `ratingModifiers`, `sightRules`, `extraChargers`, `edgePenalty`, `speedCaps`, `clockOverride`, events via `game.on('trip' | 'day' | 'notice' | 'haggle' | …)`.
- Money only moves through `earn` / `spend` in economy.ts so the ledger stays correct.
- Numbers from research are marked `[research]`, pacing choices `[pacing]` (see src/sim/balance.ts).
- In dev builds the running game is `window.__game` and the 3D view `window.__world3d`.
