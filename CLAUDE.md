# Tuk-Tuk Tycoon: Chiang Mai

Browser tycoon game on a street-accurate OpenStreetMap map of Chiang Mai. Vite + TypeScript + React 19 + MapLibre GL 6.

## Commands

- `npm run dev` — dev server on http://localhost:5317 (launch config `tuktuk-dev`)
- `npm test` — Vitest (tests/**/*.test.ts, node env; loads the real map data from public/data)
- `npm run typecheck` — `tsc --noEmit` (TypeScript 7)
- `npm run build` — typecheck + production bundle
- `npm run map:fetch` / `npm run map:build` — refetch OSM (set `OVERPASS_URL` for a mirror) and rebuild public/data; `node scripts/fetch-glyphs.mjs` refreshes map-label glyphs

## Layout

- `src/sim/` — pure simulation, no DOM. `Game` (game.ts) owns `state: GameState` (plain JSON, saved verbatim) plus runtime helpers. Core systems: demand.ts, vehicles.ts/movement.ts, dispatch.ts (ride life-cycle), ai.ts (fleet drivers), economy.ts (ledger + 04:00 daily settlement).
- `src/content/` — data with research citations (archetypes, vehicles, upgrades, paints, zones, tips, landmarks.json).
- `src/map/` — MapLibre style + `MapView` (canvas overlay for tuk-tuks/passengers).
- `src/ui/` — React. `useGame(game, select)` re-renders at ~5 Hz; `ui` store holds selection/panel state.
- `docs/research/` — fact-checked research notes; cite them when adding numbers. `docs/design.md` — game design and the extension contract.

## Conventions

- Sim coordinates are metres (x east, y north) around the map origin; convert with `graph.projection`.
- Game time is seconds since 00:00 Sun 1 Nov 2026 (see clock.ts). 1× speed = 30 game s per real s.
- New subsystems implement `GameSystem` and register in `src/sim/systems.ts`; keep their state in `game.state.systems[<id>]` and default it when missing (old saves).
- New panels register in `src/ui/panels.tsx`; always-on UI layers in `src/ui/overlays.tsx`; map drawing via `registerPainter` (src/map/painters.ts).
- Hooks on Game: `demandModifiers`, `fareModifiers`, `speedModifiers`, `ratingModifiers`, `sightRules`, `extraChargers`, events via `game.on('trip' | 'day' | 'notice' | 'haggle' | …)`.
- Money only moves through `earn` / `spend` in economy.ts so the ledger stays correct.
- Numbers from research are marked `[research]`, pacing choices `[pacing]` (see src/sim/balance.ts).
- In dev builds the running game is `window.__game`.
