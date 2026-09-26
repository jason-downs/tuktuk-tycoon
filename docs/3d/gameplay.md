# Gameplay, controls and integration for the 3D Chiang Mai

> The gameplay, controls and integration design for the 3D game: the playable area and out-of-town trips, Drive and Manage modes, the drive clock, traffic realism and the management view. The code follows it, and the module names and APIs below are the ones the code uses; tuned numbers live in `src/sim/balance.ts`, `src/content/offmap.ts` and the modules named, which are the reference. How the city is drawn is in [architecture.md](architecture.md); the approved plan is [docs/plan-3d.md](../plan-3d.md). The measurements in §0 were taken on the wide map the plan started from.

## 0. Key findings

- **The central box is already in `data-raw/`.** No Overpass refetch is needed except one small query for traffic signals. `data-raw/` covers 98.90–99.055 / 18.73–18.85.
- **Size of the new area** (98.950–99.020 × 18.762–18.808):
  - 7.38 × 5.09 km = 37.6 km², which is 17 % of today's 217 km².
  - 8,076 of 28,546 nodes, 9,781 edges and 597 km of road (313 km residential, 153 km service).
  - 3,313 of 4,386 POIs, and 78 % of the total origin weight.
  - Only **5 of the 16 LPG pumps**.
- **Trips get shorter.** In a Monte-Carlo run of the current demand kernel:
  - The mean road trip falls from 4.67 km to 3.31 km, and the mean street fare from about ฿124 to about ฿100.
  - Trips over 5 km fall from ~37 % to ~6 %.
- **20 of the 88 landmarks fall outside:**
  - Just outside (under ~350 m): CMU main gate, Kad Na Mor, Wat Chet Yot, Ang Kaew, Baan Kang Wat.
  - Further out: Zoo, Huay Kaew waterfall, Khruba monument, National Museum, Doi Suthep, Wat Pha Lat, Bhubing Palace, Night Safari, Royal Park Rajapruek, Wat Doi Kham, Promenada, Bangkok Hospital, Stadium 700.
  - Grand Canyon and Huay Tung Tao are already silently dropped today, because they lie outside even the wide box.
  - Several places sit almost on the edge: Central Festival (65 m inside), Jing Jai (10 m), CMU Rajabhat (80 m) and Arcade 2/3 (~250 m).
- **Two worktrees depend on places that will be off-map:**
  - B's `src/sim/mountain.ts` climb rule tests a place's real lon/lat against `DOI_SUTHEP_SLOPES`. Without off-map destinations it becomes dead code.
  - D's `src/sim/events.ts` `toPoint` (Bo Sang) looks for the nearest place within 5 km. Nothing is that close on the new map, so the pool resolves to null and the event's inbound rides silently switch off.
- **Traffic data:** `lanes` is tagged on 48 % of raw road ways.

## 1. Shrinking the playable area

### 1.1 Data pipeline
- **`scripts/bbox.mjs`** holds two boxes.
  - `BBOX` is the wide fetch box that `fetch-osm.mjs` uses; roads beyond the play area supply portal routes.
  - `PLAY_BBOX = { south: 18.762, west: 98.950, north: 18.808, east: 99.020 }`.
  - `ORIGIN` (`scripts/build-map.mjs`) is the centre of `BBOX` (18.79, 98.9775), which keeps 3D float32 vertices within ±4.5 km.
- **`scripts/build-map.mjs`**:
  1. Build the **full** graph as today. Then run a Dijkstra from each portal (see below) to each off-map landmark's nearest node, and write `extraM`. Off-map distances then come from the data instead of guesses.
  2. **Clip** the edges: drop edges with both ends outside the box. Cut crossing edges at the boundary with a synthetic boundary node. For dual carriageways (outbound and inbound stubs within 60 m of each other), add a hidden **virtual turnaround** edge (`virtual: 1`), so each pair stays in the strongly connected component and becomes a portal. Then run the strongly-connected-component pass. Log the in-box road km retained; the target is at least 97 %.
  3. The edge tuple carries `lanes` and the `virtual` flag: `[a, b, cls, oneway, name, len, inner, lanes, virtual]` (`GraphJSON` in `src/sim/graph.ts`).
  4. **Portals**: `portals: [{ id, name, out, in, x, y }]` in `graph.json`, and `offmap: [{ id, portal, extraM }]` for the out-of-town landmarks. The candidates below come from the actual boundary crossings of tertiary-or-bigger roads:

     | Portal | Boundary point | Off-map destinations |
     |---|---|---|
     | `huay_kaew` (NW) | 18.8078, 98.9559 | Zoo, Huay Kaew waterfall, Khruba monument, **Doi Suthep** (climb), **Wat Pha Lat** (climb), **Bhubing** (climb) |
     | `canal_w` | 18.769, 98.950 | Night Safari, Royal Park Rajapruek |
     | `hang_dong_s` | 18.7624, 98.9727 | Wat Doi Kham, Grand Canyon (optional) |
     | `superhighway_n` / `canal_n` | 18.808, 98.962–98.973 | National Museum, Stadium 700, Mae Jo (for D's Yi Peng charters, calendar.md §8) |
     | `superhighway_e` / `charoen_muang_e` | 18.80 / 18.785, 99.020 | Bangkok Hospital, Promenada, **Bo Sang** (D's `toPoint`) |

  5. **Snap-in rule**: a landmark up to 350 m outside the box snaps to an in-box kerb and stays a normal place. This covers CMU main gate, Kad Na Mor, Wat Chet Yot, Ang Kaew and Baan Kang Wat. Anything further out is off-map.
  6. POIs are kept when they lie within 400 m of a node of the clipped graph.
  7. **Scenery beyond the edge** is not in `graph.json`: the 3D build draws a far plain to the horizon and the Doi Suthep massif (`src/world3d/build/ground.ts`, `backdrop.ts`), and fog hides the end of the city.
- **Signals**: `build-map.mjs` takes the `highway=traffic_signals` nodes from the `furniture` extract and writes them to `graph.json` as `signals`.
- **Decision to confirm:** instead of the snap-in rule, nudge the box to north 18.8125 and west 98.947 (+18 % area). That would put the CMU/Zoo cluster properly inside. The default is the user's box plus the snap-in rule.

### 1.2 Off-map destinations (keep them all; drop none)
- **`src/content/offmap.ts`**: `OFFMAP_TRIPS`, keyed by landmark id, `{ roundTrip?, waitMin?, fare? }`; the portal and the road distance beyond it come from `graph.json`.
  - Doi Suthep is `fare: 400, roundTrip: true, waitMin: 60` [research, economics.md trip catalogue: "400 return"].
  - Other destinations use `streetFare(inMapRoute + extraM)`.
- **`Place.offmap?: PlaceOffmap`** in `src/sim/types.ts`: `{ portal, extraM, roundTrip, waitS, fare? }`, where `portal` indexes the graph's portals.
  - The place keeps its real `x`/`y`. That means `distanceKernel`, B's `isUpDoiSuthep` and D's `toPoint` all keep working unchanged.
  - Its `node` is the portal's `out` node.
  - `buildWorld()` in `src/data/world.ts` attaches them.
- **`VehicleTask`**: `{ kind: 'away'; until: number; trip: Trip | null; portal: number }`.
  - In `vehicles.ts` `arrive()`, the `'trip'` case calls `goAway()` instead of `completeTrip()` when the trip `leavesTown` (`src/sim/offmap.ts`).
  - A small `offmap` GameSystem (registered in `systems.ts`) finishes the trip when `time >= until`: it calls `completeTrip` so the rating covers the whole ride. It then starts an empty return leg, and finally sets the vehicle idle on `inNode`.
  - Off-map time is `extraM` at 32 km/h (18 km/h for climbs) plus `waitS` [pacing].
  - For off-map trips, `rateTrip`'s speed term rates only the driving in town: `goAway` records the time beyond the portal on the trip (`Trip.awayS`), `rateTrip` leaves it out, and a round trip's `distance` gains the drive back in from the portal. Driver fatigue counts the off-map kilometres too.
- **Filters**:
  - `originWeight` returns 0 for off-map places (they are destination-only for street demand).
  - `pickRank` in `ai.ts` excludes off-map candidates.
  - `game.chargers()` excludes Promenada. Aside: `chargers()` also includes Kad Suan Kaew, which has been closed since 2022.
  - Event `from`-pools skip off-map places.
  - `measureRequest` adds `extraM`.
  - `FleetAI.update` skips vehicles that are `away`.
  - `taskText` shows "Up Doi Suthep · back ~14:20".
- **Presentation**: off-map places appear as signposts at their portal ("⛰️ Wat Phra That Doi Suthep · 13 km"). When the player goes away, the camera parks at the portal facing the mountain backdrop, and the clock fast-forwards (§2.5).

### 1.3 Demand and balance retune (`balance.ts`, `ai.ts`)
- **`streetPerHour` stays at 150 for now.** `baseOriginTotal()` normalises to the world's own places, so the citywide rate is unchanged, which means about 28 % higher hail density per km². That helps "drive first". Let the harness choose between 120 and 150 once D's rivals are competing.
- **`sightRadius` 1,200 m** [pacing]. A wider radius would cover a fifth of the map and clutter street level. With the phone mount (×1.25) it becomes 1,500 m.
- **`typicalTripMetres` stays at 3,200 and `minTripMetres` at 700.** The box already truncates the kernel.
- **`detourFactor`** is 1.3. A value measured on the clipped graph (median of route length ÷ straight line over 300 place pairs, computed in a test) would tune it; the one-way moat probably pushes it to about 1.35–1.45.
- **`OFFMAP_DEST_WEIGHT = 0.6`, `OFFMAP_KMH = 32`, `CLIMB_KMH = 18`** (`src/content/offmap.ts`) [pacing]. Target 3–5 % of trips going off-map.
- **`pickRank` decay**: `Math.exp(-d / 2000)`.
- **Expected money effect**: the mean fare drops about 19 %, but rides per hour rise because trips are shorter and the flag fall weighs more (~30 vs ~27 THB/km). Per-hour gross should end up roughly flat. C's `business.test.ts` band ("a tuk-tuk grossing ~฿11–12k per game day") is the canary: rerun it right after the shrink.
- **Tests**: `tests/sim.test.ts` expects more than 70 landmarks (in-map plus off-map), more than 3,000 places and more than 5 LPG stations.

### 1.4 Zones (`src/content/zones.ts`, all inside the box)

| id | Name | Centre (lat, lon) | Radius |
|---|---|---|---|
| `old_city` | Old City | 18.7875, 98.9860 | 1,050 |
| `tha_phae` | Tha Phae & Night Bazaar | 18.7855, 98.9990 | 700 |
| `riverside` | Riverside, Warorot & Wat Ket | 18.7915, 99.0045 | 700 |
| `nimman` | Nimman & Maya | 18.7985, 98.9680 | 800 |
| `wualai` | Wua Lai & Chiang Mai Gate | 18.7790, 98.9870 | 700 |
| `airport` | Airport & Central Airport Plaza | 18.7690, 98.9710 | 900 |
| `chang_phueak` | Chang Phueak & Jing Jai | 18.8020, 98.9880 | 800 |
| `cmu` | Suthep Rd & CMU gate | 18.7960, 98.9580 | 900 |
| `arcade` | Arcade, Central Festival & the station | 18.7950, 99.0160 | 1,000 |

### 1.5 Saves
- `SAVE_VERSION` is 2 (`src/sim/game.ts`): arc, node and place indices belong to the clipped map.
- `SaveInfo` carries the version, and `saveIsStale` (`src/save.ts`) lets the title screen show that a save was made on an older map instead of offering "Continue".

## 2. Driving feel in 3D ("drive first")

### 2.1 Control model: on rails, with freedom to move within the lane
- **Recommendation**: keep E's graph model (`manual.ts`: throttle plus turn choice at junctions). The vehicle is always at `(arc, s)`, so routing, claims, arrival, closures and one-ways work unchanged.
- **Free steering is not recommended.** It would need mapping positions back onto the graph, one-way enforcement, collisions and pickup snapping. It is a lot more work and diverges from E.
- **A presentation-only lateral offset `d`** gives the steering feel:
  - On straights, A/D slides the tuk-tuk within its half of the road (kerb ↔ centreline) or across lanes on multi-lane one-ways.
  - In the **junction decision zone** (last `max(20 m, 1.2 s × speed)` of an arc), the same input picks the exit:
    - A → leftmost exit with turn angle > +30°.
    - D → rightmost exit (on divided roads the sharp-right median connector *is* the Thai U-turn slot).
    - No input → straightest exit.
    - Being in the left lane biases toward a left turn.
  - The chosen exit is previewed from about 40 m out as an arrow on the road and in the HUD.
- **This makes the one-way moat a real navigation puzzle**, which is what the title screen promises ("learn the one-way moat"). `outgoing()` only offers legal arcs, so wrong-way driving cannot happen.

### 2.2 Key map

| Key | Action |
|---|---|
| W/↑ | Throttle |
| S/↓ | Brake. Held for 0.5 s at a standstill: U-turn (two-way roads only, 4 game s animation). Dead-end stubs auto-U-turn. |
| A/D, ←/→ | Steer (lane position, exit choice) |
| E / Enter | Interact: pick up nearby passenger, refuel when stopped at a pump |
| H | Horn: waiting passengers within 60 m wave harder (`src/world3d/driveHud.ts`). |
| G | GPS autodrive on/off |
| Tab | Drive ↔ Manage |
| M | City map (MapLibre planner) |
| Space, 1–5, F, Esc | Pause, speed steps, follow, clear the selection (`src/ui/App.tsx`) |

- Mouse: wheel zooms, right-drag orbits, left-click selects, right-click on the ground is "drive here" (the existing `playerDriveTo`). In Manage mode WASD pans the camera.
- The haggle dialog captures keys: 1–4 pick a preset, Enter quotes, Esc declines. The global 1–5 speed keys must be ignored while it is open.

### 2.3 Speed model (in game units)
- Top speed = `targetSpeed(game, v) × 1.15`. It inherits rush hour, weather, closures, upgrades and driver skill; no new cap tables.
- Accelerate 1.6 m/s², brake 5 m/s², coast −0.8 m/s² [pacing].
- Rating needs no change: `rateTrip` already weighs speed by archetype `thrill` (backpacker +0.8, elder −0.9). Add HUD speech bubbles: "faster!" or "slow down, na!"

### 2.4 Driving on the LEFT
- The simulation keeps every vehicle on the road graph's centrelines at `(arc, s)`; the lane is presentation only.
- `src/world3d/kinematics.ts` draws traffic on the left: in the middle of the left half of a two-way road and in the leftmost lane of a one-way road, with the pose smoothed through corners and junctions (`stepKinematics`) and stopped vehicles queued along the kerb.
- `kerbPoint(game, place)` (`src/sim/manual.ts`) is where a passenger waits to be picked up: on the pavement of whichever road at the place's node, and whichever side, is nearest the POI, set back from the node, just outside the drawn kerb and facing the road. The 3D city build settles each passenger on the first of `kerbCandidates(place)` (the same spot, then others along the pavements, all within 20 m) that is clear of buildings, walls, water, carriageways and street furniture, and the view draws them there.

### 2.5 Time scale: yes, 1× is about 10× too fast for street level
- **Today**: a tuk-tuk at 24–50 km/h moves 6.7–13.9 m/s in game time. At 30 game s per real s that is 200–420 m/s on screen, roughly 900 km/h or 85 tuk-tuk lengths per second.
- **Recommendation: one clock, varied by mode — not a separate clock just for motion.**
  - A GTA-style split between the clock and motion would need a second `dt` in every system (demand Poisson, patience, `busyUntil`, breakdowns). It would break the per-game-day economy between modes and collide with every design.md feature area.
  - With a single clock the simulation and the per-game-day economy stay identical. Only the real time per game day changes.
- **`src/sim/driveClock.ts`**:
  - `DRIVE_TIME_SCALE = 4` [pacing]; `DRIVE_PACES` offers 3/4/5 as a "Driving pace" setting.
  - `DRIVE_IDLE_TIME_SCALE = 30` and `AUTODRIVE_TIME_SCALE = 30` (1×).
  - `AWAY_TIME_SCALE = 240`.
- **`Game`** gets:

  ```ts
  /** Drive mode sets this; return null to use the speed buttons. Ignored when paused. */
  clockOverride: ((g: Game) => number | null) | null = null;
  ```

  `timeScale` uses it only when `state.speed > 0` and there are no pauses.
- **Adaptive drive clock** (eased over about 0.4 real s by the drive controller):
  - 4× while the player's tuk-tuk moves under manual control.
  - 30× while `busyUntil > now` (boarding 60 s, alighting 45 s, refuelling 6 min) or while parked with no hail in sight.
  - 240× while `away`.
  - The haggle still pauses the game.
- **What this gives**:

  | Mode | Game s per real s | 1 game hour | 1 game day | On-screen speed |
  |---|---|---|---|---|
  | Drive, steering | 4 | 15 min | 6 h (pure driving) | avg ~26 m/s (~95 km/h); primary up to 42 m/s |
  | Drive, parked / boarding | 30 | 2 min | – | – |
  | Drive, GPS autodrive | 30 (1×) | 2 min | – | camera lifts to ≥ 250 m |
  | Manage ½×–8× | 15–240 | 4 min – 15 s | 96–6 min | overview |

- **Real-time cost of a ride**: about 4 km driven (0.7 km pickup + 3.3 km trip) at about 6.5 m/s is 615 game s. At 4× that is about 154 real s, plus about 4 s of fast-forwarded boarding and about 10 s of haggling: **≈ 2.8 real minutes per hand-driven ride**, versus about 24 s on autopilot at 1×. Patience windows (10–28 game min) become 2.5–7 real min; a 1.2 km pickup takes about 50 s.
- **Economy**: per game day nothing changes (rent 350/day, wages and settlement are untouched). Real-time pacing slows when you drive yourself. That creates the "manage later" pull naturally: every fleet tuk-tuk earns about 7× more per real minute in Manage mode.
- **Rewrite the pacing table in `docs/design.md`**:
  - First ride < 1 min, via a scripted hail 80 m from the start.
  - Garland (฿40) after ride 1.
  - Phone mount or cushions (฿900–1,200) after about 10 rides, which is 25–30 min driving or 10–15 min using autodrive for the trip leg.
  - First hire at about 45–60 min.
  - Manage-mode milestones as before.
- **Optional "smooth motion" clamp in Manage mode**: effective scale ≤ 0.3 × camera distance in metres, so 8× only applies when zoomed out beyond about 800 m.

### 2.6 Camera (the user's ~50° pitch)
- **Drive chase**:
  - Distance `clamp(45 + 1.2 s × on-screen speed, 35, 120)` m at 27° above the horizon, vertical FOV 40° (`src/world3d/camera.ts`).
  - Look-ahead of 0.8 s × on-screen speed (at most 30 m).
  - Yaw follows the rendered heading with a 0.35 s time constant; a U-turn swings 180° over 0.8 s.
  - A right-drag orbit re-centres after 2.5 s (with a north-up lock toggle). Zoom is free out to overview.
- **Kerbside** (during haggle): 14–25 m distance, 16° above the horizon, yaw = heading + 70°, slow 3°/s orbit.
- **Autodrive**: 220–400 m distance, 50° above the horizon.
- **Manage**: 22 m – 6 km. The view is about 40° above the horizon at follow distance, flatter close in and steeper far out (66° at 5 km); about 5 km frames the whole 7.4 km width.
- The camera target is clamped to the box plus 500 m, and fog hides the end of the backdrop.

### 2.7 GPS and autodrive
- Whenever there is a target (pickup, destination or pump), show a route ribbon on the road, turn arrows, and a HUD line such as "120 m · left onto Moon Muang Rd" (`graph.edgeName`).
- If the player takes a different exit, reroute with `sendTo` at most once per junction.
- **G, clicking a passenger, or right-clicking the map** hands the wheel to route-following. This is today's 2D click-to-go model, so it stays first-class (and is the best touch control).
- Pressing a speed button while driving engages autodrive and lifts the camera. Any WASD input takes control back and returns to the drive clock.

### 2.8 Hail → pickup → haggle → drop-off in 3D
1. **Spawn**: the passenger figure appears at `kerbPoint(place)` (party figures by `party`). Beyond about 150 m it shows as a billboard badge with a patience ring and fare hint, reusing `passengerBadge()` from `sprites.ts` as a texture. Screen-edge arrows point to the nearest 3–5 hails in sight. In drive mode the HUD shows only `game.visibleTo(playerVehicle)`, a new helper, plus company channels.
2. **Within 60 m**: the passenger waves and a speech bubble shows `req.line`.
3. **Stop within 25 m at < 1.5 m/s**: the tuk-tuk eases to the kerb and the passenger walks over (about 1 real s, animated in real time while the sim is paused). Far-kerb passengers cross the road; there is no penalty.
   - Sim: `beginKerbside(game, v, requestId)` (`src/sim/kerbside.ts`): claim → `measureRequest` → a fixed fare starts the trip, otherwise `task = 'haggle'`, `pause('haggle')`, `emit('haggle')`. Both autodrive arrival and the manual pickup call it.
4. **Haggle**: keep `HaggleDialog.tsx` logic but restyle it as a bottom-right sheet so the passenger stays visible, with the kerbside camera. Its existing 700/1100 ms timeouts line up with the climb-in and walk-away animations.
5. **Drop-off**: stop within 30 m of the destination kerb (or reach the end of the route). Passengers climb out and walk into the building.
   - The `trip` event (`TripResult`) drives the effects: a coin burst of fare + tip flying to `.stat.cash` in the top bar, stars popping above the passenger, and "+฿120 · tip ฿20 · ★★★★½".
   - Fleet trips get a small floating "+฿" only when on screen.
6. **App bookings** (fixed fare): the passenger holds a phone and boards without haggling.

### 2.9 Manual-driving API (`src/sim/manual.ts`)
- `setManual`, `setPedals(game, throttle, brake)`, `pickTurn(game, dir)`, `uTurn(game)`, `setAutodrive`, `whoDrives`, `manualControl` and `isManualDriven`.
- `chooseExit` and `previewTurn` for the exit choice and its preview; `driveManual` moves the player's tuk-tuk, and `VehicleSystem` skips it while it is driven by hand.
- Proximity pickup and refuelling through `manualInteract` (`manualPickup`, `manualRefuel`), which starts the kerbside flow with `beginKerbside` (`src/sim/kerbside.ts`); drop-off goes through `completeTrip`.
- Speed limits on any vehicle go through `game.speedCaps` (signals use it); time-scale logic goes through `clockOverride` only.

## 3. Traffic realism: worth doing vs not

**Do:**
1. **Left-lane offset and junction curves** (`src/world3d/kinematics.ts`, presentation only). Cheap, and a big win for the Thai look.
2. **Rank and kerb slots**: stopped vehicles at the same spot queue nose to tail along the kerb (`spreadParked` in `src/world3d/kinematics.ts`). This fixes the most visible overlap (stacks at Tha Phae Gate).
3. **U-turn animation** when an arc flips to `reverseArc` mid-arc (AI route starts).
4. **Ambient traffic** as instanced meshes: the rivals system's songthaews and tuk-tuks (`src/sim/rivals.ts`) plus cosmetic scooters, cars, pickups, vans and taxis near the camera (`src/world3d/traffic.ts`), which keep a gap to the vehicle ahead. The cosmetic stream is not in the simulation, so headless AI stays deterministic. Scooters make up about two-thirds of it.
5. **Player-only blocking** by the leader in the same lane: not built. `game.speedCaps` is the hook for it; bumps would match speed, with no damage.
6. **Signals at clustered OSM signal junctions**, in `src/sim/signals.ts`:
   - Stateless phases: `phase = (time + offset) mod cycle`. Cycle 90 s (Rincome 150 s: calendar.md cites "the longest wait for a green light") [pacing].
   - Approaches split into two groups by the junction axis.
   - A cap in `game.speedCaps` makes *all* simulated vehicles stop at each approach's painted stop line (`src/sim/junctionShape.ts`: past the rounded kerb corners and the zebra crossing, as the 3D streets draw them; never nearer than 6 m to the node). Seeing fleet tuk-tuks run reds in 3D would look wrong.
   - The player may run a red, with a rating hit and a chance of a police-checkpoint fine [pacing]. Research mentions checkpoints on the Superhighway, Huay Kaew and Old City exits, but not a fine amount.
   - Recheck rush-hour factors in the harness. Average added delay is about 11 s per signalised passage.

**Don't:**
- Car-following between fleet vehicles in the simulation. Overlaps on roads are rare (slots fix the ranks), and it would put balance and determinism at risk and conflict with D.
- AI lane changes, and gap acceptance at unsignalised junctions.
- Pedestrian crossings (keep only waiting passengers plus a few flavour monks and pedestrians).
- Physics, damage and parking manoeuvres.

## 4. Management mode in 3D

- **Mode semantics**:
  - Tab into Manage turns `state.autopilot` on (remembering the previous value), switches to the speed buttons and allows free camera pan.
  - Tab back turns autopilot off, snaps the camera to the player and restores the drive clock.
  - Switching is disabled during a haggle. A mid-trip handover works because `v.route` is kept.
  - Zoom is free in both modes.
- **Level of detail by camera distance** (`src/world3d/hud.ts`, `src/world3d/layers/`):
  - Vehicles and people scale up with distance so they stay legible (`max(1.3, D / 150)`).
  - Screen-space badges: passenger badges with patience ring and fare shrink with distance; landmark names show within 900 m; status icons over fleet tuk-tuks within 700 m, or always for the highlighted one.
  - Cosmetic traffic and crowds thin out and hide as the camera rises.
- **Picking**: project request, vehicle and landmark positions to the screen and take the nearest within 22–28 px. This works at every zoom and needs no raycasting against instanced meshes.
- **Selection visuals**: selection ring, route ribbon, destination and pickup beacons (`src/world3d/layers/markers.ts`).
- **Management action**: a "Dispatch nearest free tuk-tuk" button on the request card (`dispatchNearest` in `src/sim/manage.ts`).
- **Minimap** (`src/ui/Minimap.tsx`, registered in `OVERLAYS`):
  - Pre-render `graph.edges` once to an offscreen canvas at 4 m/px.
  - Drive mode: a round radar, 500 m radius, rotating with heading, showing hails, the destination arrow and fleet.
  - Manage mode: north-up map of the whole area with the camera outline; click to fly there, right-click for "drive here".
- **Keep the MapLibre map as the optional "City map" planner (M)**:
  - Lazy-load it with `import()` so the 3D build doesn't pay ~800 KB up front.
  - Use it for zones, closures, events and depots; `?view=map` makes it the main view.
  - The 3D view draws weather, lanterns, closures and rivals as scene objects and skips those 2D painters (`SKIP_2D_PAINTERS` in `src/world3d/hud.ts`); the flat map keeps them.
- **Existing UI mapping**:
  - `GameView` (`src/ui/view.ts`), `{ kind, flyTo(x, y, zoom?), destroy(), screenPoint?(x, y, h?), footprint?(), setActive?(on) }`, is implemented by both `MapView` and the 3D view; `PanelProps`, `OverlayProps` and `App` use it.
  - `flyTo` zoom converts as distance = 180 m × 2^(16 − z), so `flyTo(x, y, 16)` lands at street level.
  - Any left-drag pan sets `ui.follow = false`, like today's `dragstart`.
  - Toasts with `x`/`y` keep working through `flyTo`.
  - Add `mode: 'drive' | 'manage'` and `planner: boolean` to `UIState`.
  - Replace the `PlayerCard` hint with "WASD drive · E pick up · G autodrive · Tab manage".
  - The top bar gets a Drive/Manage toggle and a "Drive clock" chip next to the speed buttons.

## 5. Integration and merge order

**Main principle — least rework.** The 3D view implements the existing `PaintContext` on its HUD canvas (`src/world3d/hud.ts`):
- A transparent 2D overlay canvas on top of the WebGL canvas.
- `toScreen(x, y)` projects ground points through the 3D camera.
- `zoom` is the map-zoom equivalent, `16 − log2(d / 180)`.

Every 2D painter works in the 3D view — flat, but in the right place — except those the scene replaces with meshes.

**Order:**
1. **Merge A → B → C → D → E** into main (C and D can swap). After each merge, run `npm run typecheck && npm test` and a 10-minute 2D smoke test with `window.__game`. Expected conflicts are in `systems.ts`, `types.ts`, `panels.tsx` and `game.ts` (B's climb check, D's `edgePenalty`). E goes last because `manual.ts` builds on D's `movement.ts`/`routing.ts`. Tag a 2D baseline.
2. **Seams refactor (no behaviour change)**:
   - The game loop in `src/ui/loop.ts`.
   - `GameView`.
   - `clockOverride`, `speedCaps`, `visibleTo`.
   - `beginKerbside`.
3. **Map shrink**: portals, off-map destinations, `'away'` task, zones, lanes in the graph, retune, `SAVE_VERSION` 2. The 2D game must still pass here. F's balance harness runs now.
4. **3D renderer**: implements `GameView` and the `PaintContext` overlay. Parity checklist: vehicles, passengers, selection, follow, `flyTo`, routes, haggle, toasts.
5. **Drive mode**: the drive clock (`src/sim/driveClock.ts`), keys and HUD (`src/ui/drive/`, `src/ui/manual/`), camera modes (`src/world3d/camera.ts`), lanes and kerbside queues (`src/world3d/kinematics.ts`), kerbside flow and effects.
6. **Painter ports**, in this order:
   - D rivals and ambient traffic → instanced meshes. Must port: flat sprites look wrong.
   - D lanterns → rising additive emissive quads, plus krathongs on the Ping.
   - D rain/storm/haze → particles, wet-road material, fog and lightning.
   - D closures → barriers and "ถนนปิด" signs, plus walking-street stalls on Ratchadamnoen/Wua Lai when active.
   - C depots → garage building plus company sign; hotel-partner badges stay as overlays.
   - E turn indicator → road decal (the overlay stays for the HUD).
   - B paints and upgrades → tuk-tuk materials (garland, LED strips glowing at night).
   - Screen-anchored effects use `GameView.screenPoint`.
7. **Signals** (fetch query, build clustering, stop rule, rendering) and ambient IDM.
8. **3D is the default**; the planner map is behind M (or `?view=map`); the minimap is an overlay.
9. **Feature area F**: balance and QA.

**Model and view stay apart:** rivals live in the sim (`src/sim/rivals.ts`, read with `rivalsOf`) and cosmetic traffic and crowds in DOM-free modules (`src/world3d/traffic.ts`, `src/world3d/crowd.ts`), so layers and painters only draw. Weather and festivals are read from the sim (`src/sim/weather.ts`, `src/sim/events.ts`). Event pools skip off-map places (`p.offmap`).

**Tests and checks:**
- Map data (`tests/offmap.test.ts`, `tests/routing.test.ts`, `tests/sim.test.ts`): every off-map landmark has a portal with a road distance, and portals route both ways from Tha Phae Gate.
- Lanes (`tests/world3d-vehicles.test.ts`): vehicles drive on the left of travel and turn smoothly through a real junction.
- `tests/offmap.test.ts`:
  - An EV Doi Suthep trip goes portal → away → paid ฿400 → returns idle.
  - An LPG tuk-tuk is blocked by B's `climbBlocked`.
  - D's Bo Sang `toPoint` resolves.
- `tests/drive.test.ts` (headless manual driving):
  - Throttle, exit choice, U-turns only on two-way roads.
  - Stopping within 25 m emits `haggle`; drop-off completes the trip.
  - The `clockOverride` returns 4 / 30 / 240 in the right states and respects pause.
- `tests/signals.test.ts`: deterministic phases; stops at red and goes on green; trips per day within 10 % of the no-signal baseline.
- `tests/balance.test.ts` (F):
  - One autopilot tuk-tuk's gross per game day is inside C's band.
  - Mean trip about 3.3 km.
  - A scripted drive-mode bot's real time, Σ dt ÷ scale, meets the new pacing table.
- All feature-area tests (for example `fleet.test.ts`, `business.test.ts`) pass on the new map.
- **In the browser** (dev server, `window.__game`):
  - Scripted key events advance `arc`/`s` with a left offset.
  - The kerbside pickup opens the sheet; Tab toggles autopilot.
  - v2 saves round-trip; a v1 save shows the incompatibility message.
  - The planner shares the selection.
  - About 60 fps with 50 fleet + 300 ambient vehicles at district level, and ≥ 30 fps at city level on an integrated GPU.

**Risks:**
- Strongly-connected-component clipping eating one-way systems near the edges. Mitigated by the virtual turnarounds and the 97 % check.
- Only 5 LPG pumps.
- Real-time pacing when driving by hand. Tune `DRIVE_TIME_SCALE` 3–5 in play-testing.
- The `CLAUDE.md` Commands/Conventions update, which should mention the drive clock, `GameView` and off-map places. A local hook blocks editing that file without the user's explicit OK, so ask the user first.

### Critical Files for Implementation
- /Users/jason/coderepos/tuktuk/scripts/build-map.mjs (plus /Users/jason/coderepos/tuktuk/scripts/bbox.mjs)
- /Users/jason/coderepos/tuktuk/src/sim/game.ts (`clockOverride`, `speedCaps`, `visibleTo`, `timeScale`)
- /Users/jason/coderepos/tuktuk/src/sim/vehicles.ts and /Users/jason/coderepos/tuktuk/src/sim/dispatch.ts (`'away'` task, `beginKerbside`)
- /Users/jason/coderepos/tuktuk/src/data/world.ts (off-map places, portals, snap-in rule)
- /Users/jason/coderepos/tuktuk/src/map/MapView.ts together with /Users/jason/coderepos/tuktuk/src/map/painters.ts (`GameView`, the `PaintContext` overlay that the 3D view implements)
