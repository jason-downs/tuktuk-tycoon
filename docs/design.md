# Tuk-Tuk Tycoon: Chiang Mai — design & code contract

## Pillars

1. **Real Chiang Mai.** The streets, one-ways, moat, temples, markets and landmarks are real (OpenStreetMap, verified
   against `docs/research/landmarks.md`). Fares, costs, festivals, weather, people and language come from the
   fact-checked notes in `docs/research/`. When a number is invented for pacing, say so (`[pacing]`), and cite the
   research note when it isn't (`[research]`).
2. **Humble start, growing empire.** You begin as one driver renting Lung Daeng's tired tuk-tuk. You end running a
   fleet with drivers, depots, app contracts and hotel partnerships.
3. **Every ride is a little story.** Passengers have archetypes, lines of dialogue, patience, and a price they'll
   accept. Haggling is a real decision: gouging pays today and costs stars tomorrow.
4. **Readable at a glance.** A warm Lanna-styled map, clear icons, a calm HUD, and speed controls from ½× to 8×.

## Pacing targets (1× = 30 game seconds per real second; a game day is 48 real minutes at 1×)

| Milestone | Target (real time, typical player) |
|---|---|
| First ride completed | < 1 min |
| First cheap upgrade (garland, cushions, phone mount) | 3–6 min |
| First hired driver (in a second rented tuk-tuk) | 10–20 min |
| First owned tuk-tuk | 25–45 min |
| 5 tuk-tuks | ~1 h (using 2–4× speed) |
| 20+ tuk-tuks, depots, contracts | 2–3 h |

Real tuk-tuks pay for themselves in more than a year, so capital prices stay realistic while a game day holds many
more rides than a real one. Hire-purchase and renting make early growth possible. Balance is checked with headless
simulations (`tests/`).

## What exists (foundation)

- **Map & graph** (`scripts/`, `public/data/`): the road graph is the largest strongly connected component of the
  drivable OSM network (28.5k nodes, 34k edges), with one-way streets honoured. There are ~4.4k named POIs and 88
  curated landmarks; `Place` merges the two.
- **Demand** (`src/sim/demand.ts`): Poisson street hails. Each place's weight is shaped by the hour-of-day profile of its
  category, landmark timetables (walking streets, night bazaar…) and the month (MOTS visitor index). Archetype mixes
  come from the kind of origin; destinations use archetype affinities with a distance kernel.
- **Rides** (`src/sim/dispatch.ts`): claim → drive to pickup → haggle (player dialog, or AI policy) → trip → payment,
  tip and rating → reputation. The platform takes a cut on app rides. Money splits depend on the driver's pay model.
- **Fleet AI** (`src/sim/ai.ts`): shifts, zones, request scoring, refuelling, cruising to busy ranks.
- **Economy** (`src/sim/economy.ts`): ledger by category, and a daily settlement at 04:00 covering rent, wages,
  rent-from-drivers and upkeep.
- **Vehicles** (`src/sim/vehicles.ts`): route following, fuel, wear, breakdowns.
- **UI**: MapView (MapLibre plus a canvas overlay), top bar with speed controls, player card, request card, haggle
  dialog, fleet and finance panels, toasts, and a title screen with save/continue.

## Code contract (read before changing things)

- `src/sim/` is pure TypeScript with no DOM access. `Game.state: GameState` must stay plain JSON: it is saved verbatim
  to localStorage.
- **New subsystem**:
  - Implement `GameSystem { id, update(game, dt), init?(game) }` and register it in `src/sim/systems.ts`.
  - Keep its state in `game.state.systems[id]` behind a typed accessor in your module.
  - Default any missing fields in `init`, so older saves still load.
  - Add fields to `GameState` itself only when several systems need them.
- **Hooks on `Game`** (push functions in `init`):
  - `demandModifiers(place, cal)` and `fareModifiers(origin, cal)`
  - `speedModifiers(roadClass, cal)`
  - `ratingModifiers(vehicle, trip)`
  - `sightRules(vehicle, request)`
  - `extraChargers()`
- **Events**:
  - Subscribe with `game.on(name, fn)`, emit with `game.emit(name, payload)`.
  - Built-in events: `trip` (a `TripResult`), `day` (the closing `DayBook`), `notice`, `haggle`, `speed`, `pause`,
    `frame`, `change`.
- **Money** goes only through `earn(game, amount, category)` / `spend(...)` in `economy.ts`, never through
  `state.cash` directly, so the ledger stays correct.
- **Requests**:
  - Create them with `makeRequest(game, from, to, archetype, channel, cal)` and push them onto `game.state.requests`.
  - Use channels `app`, `hotel` and `regular` for company-sourced rides. Every fleet tuk-tuk can see those; setting
    `fixedFare` skips haggling.
- **UI**:
  - Panels register in `src/ui/panels.tsx`.
  - Always-on layers go in `src/ui/overlays.tsx`.
  - Map canvas drawing uses `registerPainter` in `src/map/painters.ts`.
  - Read game data with `useGame(game, g => …)`. Its result is compared shallowly, so return primitives, flat objects
    or strings.
  - UI state lives in `ui` (`src/ui/store.ts`).
  - Put each feature's CSS in its own file, imported by its component, to keep `styles.css` stable. Reuse the
    existing classes (`card`, `btn`, `list-row`, `eyebrow`, `hint`, …) and the CSS variables.
- **Content**: data tables go in `src/content/` with a comment naming the research source.
- **Tests**: Vitest in `tests/`. `tests/helpers.ts` loads the real graph. `tests/sim.test.ts` shows how to build a
  `World` and run a headless game.
- **Dev handle**: `window.__game` in dev builds.

## Workstreams

- **A. Fleet (vehicles, drivers, hiring)**:
  - Vehicle market:
    - Rent more of Lung Daeng's tuk-tuks: at most 3, ฿350/day each, rusty model.
    - Buy the models in `content/vehicles.ts`, or take hire-purchase: 25 % down, daily instalments.
    - Sell for 60 % of purchase price, falling 5 %/year.
  - EV plate rule: Chiang Mai EV quota plates are one per person (economics.md §6), so EVs ≤ registered people.
  - Drivers:
    - Hiring pool from the 40-name roster (culture.md §11b), refreshed daily. Stats and asking pay follow
      economics.md §7: minimum wage 380, salary 400 + 10–20 % commission, or rent-out at 350/day.
    - Hiring fee 1,000.
    - Assign a vehicle, shift, zone and pay model; firing.
    - Morale and fatigue, and quitting.
  - Fleet panel with vehicle and driver detail.
- **B. Garage**:
  - Upgrades per owned or leased vehicle (extend `content/upgrades.ts`).
  - Paint jobs (`content/paints.ts`, rating bonus via `ratingModifiers`).
  - Repairs that restore condition and take time.
  - EV conversion kit, 200k (economics.md §4).
  - Garage panel.
- **C. Business & progression**:
  - Company unlocks: a ride-hailing app partnership (fictional brand) that spawns `app` requests, a dispatch radio
    (shared sightings), marketing, hotel partnerships (`hotel` requests), depots (charging, cheaper repairs), an
    airport taxi-counter permit (160 fixed fare, economics.md), tours (half-day temple loop 600 and others) and a bank
    loan.
  - Ranks and a goal chain with rewards; Business and Goals panels; a finance chart.
- **D. World**:
  - Calendar events from calendar.md §8: Songkran, Yi Peng / Loy Krathong 23–25 Nov 2026, walking streets, Flower
    Festival, Chinese New Year, dry days, long weekends, rush hour.
  - Road closures through router edge penalties (e.g. Ratchadamnoen closed during the Sunday Walking Street).
  - Weather by season: rain, storms, smoky-season haze. It affects demand, speed and ratings, and is drawn as rain and
    haze.
  - Calendar panel.
  - Ambient traffic and rival tuk-tuks/songthaews that compete for street hails.
- **E. Player experience**:
  - Tutorial coach marks and a help screen.
  - Web-Audio sound (engine putter, horn, coins, rain; mute toggle).
  - Contextual dialogue with templates (destination, time of day) built from culture.md.
  - Manual driving mode (throttle and turn choice at junctions, GPS guidance).
  - Mobile/touch polish.
- **F. Balance & QA** (after merging): a headless balance harness against the pacing targets, performance with 50+
  tuk-tuks, a full review and play-testing.
