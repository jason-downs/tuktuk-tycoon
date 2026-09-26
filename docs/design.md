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
4. **Readable at a glance.** A warm Lanna-styled 3D city, clear icons, a calm HUD, and speed controls from ½× to 8×.

## Pacing targets (1× = 30 game seconds per real second; a game day is 48 real minutes at 1×)

| Milestone | Target (real time, typical player) |
|---|---|
| First ride completed | 3–4 min, driving by hand (a hand-driven ride takes about 3 real minutes, `docs/plan-3d.md`) |
| First cheap upgrade (garland, cushions, phone mount) | 3–6 min |
| First hired driver (in a second rented tuk-tuk) | 10–20 min |
| First owned tuk-tuk | 25–45 min |
| 5 tuk-tuks | ~1 h (using 2–4× speed) |
| 20+ tuk-tuks, depots, contracts | 2–3 h |

The typical player drives by hand until drivers will join (five rides, ~15 min), then manages at 2–4×. Lung Daeng's
three tuk-tuks carry the first hires; idle owners rent only to a Fleet boss, so the fourth and fifth tuk-tuks come on
hire-purchase (10 % down). When they come depends on how the player spends: the first owned tuk-tuk arrives at
~25–37 min and the fifth at ~40 min for a player who puts every baht into tuk-tuks, ~70–80 min for one who signs up
for services as soon as they open. As a Fleet boss (5 tuk-tuks, 2 owned, ฿30k) owners rent 4, then 12 to a Company
and 20 to a Tycoon, and the fleet grows in steps — buy to meet the next rank, save the net worth it asks for, fill its
rentals — to about 10 tuk-tuks at 1¼–1½ h, 20 at 2–2½ h and 30 at about 3 h.

A hired driver on the day shift works all 12 hours (~55 rides) and nets the company ~฿3,500 a day in a rented
tuk-tuk, ~฿2,300 while it is on hire-purchase and ~฿4,000 once it is paid off; long and night shifts carry fatigue into
the next day. Past five tuk-tuks the player's own tuk-tuk earns under a third of the company's takings. Real tuk-tuks
pay for themselves in more than a year, so capital prices stay realistic while a game day holds many more rides than a
real one. Balance is checked with headless simulations: `tests/balance.test.ts` plays this typical player, both ways of
spending, and asserts the targets.

While you steer your own tuk-tuk in Drive mode, the clock slows to 4 game seconds per real second (3–5 from the drive
clock chip in the top bar), so the streets pass at a believable speed. It runs at 1× while you are parked, loading or on GPS
autodrive, and fast-forwards while you are out of town (`src/sim/driveClock.ts`). The economy per game day is the same
in both modes.

## What exists

- **Map data** (`scripts/`, `public/data/`). `npm run map:fetch` downloads the OSM extracts into `data-raw/`,
  `npm run map:build` turns them into the road graph, the places and the flat-map layers, and `npm run city:build`
  bakes `city3d.json`, the semantic data the 3D city is generated from.
  - The playable area is central Chiang Mai, lon 98.950–99.020 and lat 18.762–18.808 (`scripts/bbox.mjs`).
  - The road graph is the largest strongly connected component of the drivable OSM network inside it, with one-way
    streets honoured: 7,983 nodes and 9,718 edges (588 km of road), with traffic signals at 103 of its nodes.
  - 16 portals on the edge of the area lead to out-of-town destinations such as Doi Suthep, the Zoo and the Night
    Safari. A tuk-tuk taking a passenger there leaves through a portal and comes back in the same way while the clock
    runs on (`src/sim/offmap.ts`).
  - There are about 3.5k named POIs and 89 curated landmarks; `Place` merges the two.
- **Demand** (`src/sim/demand.ts`): Poisson street hails. Each place's weight is shaped by the hour-of-day profile of its
  category, landmark timetables (walking streets, night bazaar…) and the month (MOTS visitor index). Archetype mixes
  come from the kind of origin; destinations use archetype affinities with a distance kernel.
- **Rides** (`src/sim/dispatch.ts`): claim → drive to pickup → haggle (player dialog, or AI policy) → trip → payment,
  tip and rating → reputation. The platform takes a cut on app rides. Money splits depend on the driver's pay model.
- **Fleet AI** (`src/sim/ai.ts`): shifts, zones, request scoring, refuelling, cruising to busy ranks.
- **Economy** (`src/sim/economy.ts`): ledger by category, and a daily settlement at 04:00 covering rent, wages,
  rent-from-drivers and upkeep, booked to the business day that closed.
- **Vehicles** (`src/sim/vehicles.ts`): route following, fuel, wear, breakdowns.
- **Drive and Manage** (`src/sim/manual.ts`, `src/sim/driveClock.ts`, `src/ui/mode.ts`): in Drive mode you steer your
  own tuk-tuk along the road graph (throttle, brake, lane and exit choice at junctions, U-turns, GPS autodrive) and pick
  passengers up at the kerb. Tab switches to Manage mode, which puts your tuk-tuk on autopilot and gives you a free
  camera and the speed buttons. Traffic signals (`src/sim/signals.ts`) stop simulated vehicles at red; the tuk-tuk you
  steer can run one, at a cost.
- **3D view** (`src/world3d/`): `World3DView` is the game's main view. It shows a three.js city generated in a Web
  Worker from `city3d.json` and split into 800 m tiles, with a chase camera in Drive mode and a free camera in Manage
  mode. Its layers draw the environment (sun path, sky, weather, festivals, night lights), vehicles, passengers,
  crowds, signals and markers, and a 2D HUD canvas carries badges and labels. See
  [docs/3d/architecture.md](3d/architecture.md).
- **City map** (`src/map/`): `MapView` (MapLibre plus a canvas overlay) is loaded the first time it is opened. M opens
  it as a planner that takes the 3D view's place until it is closed; `?view=map` makes it the main view.
- **UI** (`src/ui/`): top bar with speed controls, the Drive/Manage toggle and the drive clock; player card, request
  card and haggle dialog; the fleet, hire, garage, business, goals, finance and calendar panels; minimap, GPS line,
  toasts, tutorial coach and help; and a title screen with save/continue.

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
  - `extraChargers()`: the company's own EV chargers (depots), which charge at the home rate; the malls' public
    chargers cost more.
  - `edgePenalty(edge)`: per-edge routing time multiplier (road closures; Infinity forbids). The events system owns it;
    the game hands it to the shared router every step, and vehicles on a penalised edge slow down (at most ×1/5).
  - `speedCaps(vehicle)`: upper bounds on a vehicle's speed right now, in m/s (a red light ahead); the lowest applies.
  - `clockOverride(game)`: replaces the speed buttons' time scale while set (the drive clock owns it); return null to
    use the speed buttons.
- **Events**:
  - Subscribe with `game.on(name, fn)`, emit with `game.emit(name, payload)`.
  - Built-in events: `trip` (a `TripResult`), `day` (the closing `DayBook`; whatever its listeners earn or spend is
    booked to that day), `notice`, `haggle`, `speed`, `pause`, `frame`, `change`, `manual`, `uturn`, `rank`, `goal`,
    `tutorial`, `mode` (the UI's Drive/Manage switch).
- **Garage** (`src/sim/garage.ts`, `src/sim/mountain.ts`):
  - Workshop work (service, fitting, respray, EV kit) puts a vehicle in a `broken` task with a `work` label, and the
    garage system ends it. Like a breakdown, the vehicle takes no rides meanwhile.
  - `climbBlocked(game, v, req)`: an LPG tuk-tuk without the mountain rebuild can't take a ride that starts or ends up
    Doi Suthep. The fleet AI and `claimRequest` honour it.
  - Vehicle models with `convertedFrom` are the garage's EV conversions and are never sold new.
- **Money** goes only through `earn(game, amount, category)` / `spend(...)` in `economy.ts`, never through
  `state.cash` directly, so the ledger stays correct.
- **Requests**:
  - Create them with `makeRequest(game, from, to, archetype, channel, cal)` and push them onto `game.state.requests`.
  - Use channels `app`, `hotel` and `regular` for company-sourced rides. Every fleet tuk-tuk can see those; setting
    `fixedFare` skips haggling.
- **UI**:
  - Panels register in `src/ui/panels.tsx`.
  - Always-on layers go in `src/ui/overlays.tsx`.
  - 2D overlay drawing uses `registerPainter` in `src/map/painters.ts`. Painters run on the flat map and on the 3D
    view's HUD canvas; `src/world3d/hud.ts` skips the ones the 3D scene replaces with objects of its own.
  - Things drawn in the 3D scene implement `WorldLayer` (`src/world3d/layers/types.ts`) and are added with
    `ViewContext.addLayer`. The static city is generated by the builders in `src/world3d/build/`, run in order by
    `buildCity` (`src/world3d/build/world.ts`), which is pure TypeScript with no three.js.
  - Read game data with `useGame(game, g => …)`. Its result is compared shallowly, so return primitives, flat objects
    or strings.
  - UI state lives in `ui` (`src/ui/store.ts`).
  - Put each feature's CSS in its own file, imported by its component, to keep `styles.css` stable. Reuse the
    existing classes (`card`, `btn`, `list-row`, `eyebrow`, `hint`, …) and the CSS variables.
- **Content**: data tables go in `src/content/` with a comment naming the research source.
- **Tests**: Vitest in `tests/`. `tests/helpers.ts` loads the real graph. `tests/sim.test.ts` shows how to build a
  `World` and run a headless game.
- **Dev handles**: `window.__game` (the game) and `window.__world3d` (the 3D view) in dev builds.

## Feature areas

- **A. Fleet (vehicles, drivers, hiring)**:
  - Vehicle market:
    - Rent more of Lung Daeng's tuk-tuks: at most 3, ฿350/day each, rusty model.
    - Rent idle owners' plated tuk-tuks at ฿400/day: one for a lone driver, more as the company's rank grows
      (`RANKS` ownerRentals).
    - Buy the models in `content/vehicles.ts`, or take hire-purchase: 15 % down, daily instalments.
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
  - EV conversion kit, 200k (economics.md "Suggested game numbers"; the §4 prototype cost ≈340k).
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
- **F. Balance & QA**: a headless balance harness against the pacing targets (`tests/balance.test.ts`), performance
  with 50+ tuk-tuks, a full review and play-testing.
