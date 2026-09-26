# Plan: a 2.5-D, lifelike central Chiang Mai

Your choices: a tilted 3D follow-cam, a stylised low-poly look generated in code, "drive first, manage later" play, and central Chiang Mai rendered in maximum detail. The simulation, economy and management panels stay; the renderer, the camera, the controls and the playable area change.

## 1. The world you'll see

**Area:** lon 98.950–99.020, lat 18.762–18.808 (7.4 × 5.1 km). It covers the Old City and moat, Nimman/Maya, Tha Phae and the Night Bazaar, Warorot and the riverside, Wat Ket, Wua Lai, the airport and the railway station.

**Beyond the edge:** scenery only (not drivable), with Doi Suthep on the western horizon. Its gold chedi glints in the morning; in smoky season the mountain vanishes in haze.

**From OpenStreetMap data (~18.8k buildings, 101 temple grounds, all roads, water and walls in the area):**

- **Streets.** Asphalt with the real widths and lane counts. White dashed and yellow centre lines, zebra crossings, and red-and-white kerbs at junctions. One-way arrows, so the moat's one-way loop reads on the road itself. Pavements, and the painted tuk-tuk rank at Tha Phae Gate. Bridges over the moat and the Ping, the runway and the rail line.
- **Shophouses.** The dominant building type, split into 4 m bays with roll-up shutters that are open by day and shut at night. Sign bands, awnings, grilles, AC units, and water tanks on flat roofs. Wooden shophouses on Tha Phae Road, in Chinatown and in Wat Ket. Condos and cafés in Nimman, Lanna teak houses, and market halls.
  - Heights come from OSM tags where present. Otherwise they follow the city's real height limits: 12 m in the Old City, 9 m near temples.
- **Temples.**
  - Every temple ground gets a Lanna viharn with overlapping tiered roofs, gold chofa and naga bargeboards, facing its street. It also gets a chedi (bell, Lanna square or octagonal; white-and-gold, gold, or ruined brick), a compound wall, an arch gate with singha lions, and a bodhi tree.
  - 17 hand-built landmarks:
    - Tha Phae Gate and its plaza, the other four gates, and the four corner bastions.
    - Wat Chedi Luang (55 m ruined brick chedi), Wat Phra Singh, Wat Chiang Man with its elephant chedi, Wat Suan Dok with its white royal chedis, Wat Lok Molee, the teak Wat Phan Tao, and the silver Wat Sri Suphan.
    - Three Kings Monument, Warorot market, the Nawarat and Iron bridges, the Night Bazaar, MAYA / One Nimman, and CNX airport.
- **The moat.** Teal water 1.6 m below the road, brick banks, fountains, and trees on both banks. Brick city-wall remnants and the gates.
- **Street life.**
  - About 20k trees: rain trees, bodhi, palms, teak, bougainvillea.
  - Concrete power poles with tangled cables, except on the roads where Chiang Mai has buried them (the moat roads, Tha Phae and Chang Klan).
  - Street lamps, spirit houses, rows of parked motorbikes, food carts under parasols, traffic lights with countdowns, and unbranded convenience stores.
- **Traffic and people.**
  - About 55 % of ambient traffic is scooters; the rest is pickups and cars, red songthaews, rival tuk-tuks and tour vans.
  - Pedestrians include monks in saffron and CMU students in uniform.
  - Waiting passengers stand at the kerb, dressed by archetype (backpacks, bucket hats, vendor baskets…). They wave you down, and a coloured ring round their feet empties as their patience runs out.
- **Your tuk-tuk.** A detailed 3D model in any of the 11 liveries, with its lit yellow TAXI box, jasmine garland, rain curtains and LED strips. The rusty one has dents and a patched canopy.
- **Time of day.** A real sun path for 18.79° N, golden-hour light and long shadows. At night the shops glow with cool fluorescent and warm light, with bulb-lit markets, floodlit chedis and headlights.
- **Weather and season.** Afternoon storms in the wet season, smoky haze Feb–Apr, and morning mist on the moat in the cool season.
- **Festivals.**
  - Yi Peng (23–25 Nov 2026, three weeks into the game) comes first. Hanging lanterns across the streets, candles on the temple walls, krathongs drifting down the Ping, crowds at Tha Phae Gate, and the lantern parade. There are no sky lanterns over the city: the 2026 municipal programme bans them there.
  - The Sunday and Saturday walking streets fill with stall rows on schedule, and the Night Bazaar runs nightly.
  - Songkran water fights around the moat, the Flower Festival and Chinese New Year follow.

## 2. How it plays

- **Camera.**
  - About 50° tilt, following your tuk-tuk. Wheel to zoom, right-drag to orbit.
  - Close in, the view levels out so the horizon and Doi Suthep come into frame.
  - Zoomed right out, the whole central city is visible, with the fleet shown as icons.
- **Driving (early game).**
  - **Controls.** W/S for throttle and brake. A/D moves you within your lane on straights and picks your turn at the next junction; the chosen exit is previewed as an arrow on the road.
  - Traffic keeps left, as in Thailand. You can U-turn on two-way roads. H sounds the horn.
  - You can't drive the wrong way up a one-way street, so learning the moat loop becomes the puzzle.
  - A GPS ribbon on the road guides you, e.g. "120 m · left onto Moon Muang Rd".
  - G switches to autodrive; clicking a passenger or right-clicking the map also works.
- **Rides in 3D.**
  - Pull up by a waving passenger and they walk over. The camera drops to kerb level for the haggle, which becomes a side sheet so you can still see them.
  - At drop-off, coins fly to your cash counter and stars pop up.
  - Monks take the far end of the bench, and Thai passengers wai as they get out.
- **Time while you drive.**
  - At today's speed (1× = 30 game seconds per real second), a tuk-tuk would cross the screen at about 900 km/h.
  - While you steer by hand, the clock slows to **4 game seconds per real second**. It jumps to 30× while you're parked or loading, and fast-forwards during out-of-town trips.
  - The economy per game day doesn't change. A hand-driven ride takes about 3 real minutes, so driving yourself stays hands-on, and hired drivers on 2–8× speed pull the game toward managing as the fleet grows.
- **Managing (later).**
  - Tab switches to Manage: your tuk-tuk goes on autopilot and you control the speed.
  - You can pan across the city, select fleet tuk-tuks, and dispatch the nearest free one to a passenger. Zoomed out, you see status icons and dots.
  - A minimap shows a radar round you while driving and a city overview while managing.
  - The existing flat map stays as an optional "City map" planner (M), for zones, closures and events.
- **Beyond the playable area.**
  - Places just outside the edge (CMU gate, Kad Na Mor, Wat Chet Yot…) move to the nearest in-map kerb.
  - Farther places — Doi Suthep, the Zoo, the Night Safari, Royal Park, Promenada, Bo Sang — become out-of-town trips. You drive to the edge of the map (Huay Kaew Rd, the Canal Road, the Superhighway…), the clock fast-forwards while you're away, and you come back in by the same road.
  - The Doi Suthep climb still needs an EV or an engine rebuild.
- **Traffic realism.**
  - Lane-keeping, and queues at the ranks instead of stacking.
  - Signals at the ~110 OSM-mapped junctions, with Rincome's famously long red. The whole fleet stops at reds; you can run one at the risk of a fine.
  - Ambient cars follow each other.
  - Fleet tuk-tuks don't do car-following, which keeps the economy deterministic.

## 3. How it gets built

1. **Merge the five feature branches** (fleet, garage, business, world, experience), in that order, into the current 2D game, with tests and a smoke test after each merge.
2. **Seams, no behaviour change:**
   - Move the game loop out of the map view.
   - Add a `GameView` interface that both the flat map and the 3D view implement.
   - Add hooks for the drive clock, kerbside pickup, stop lines and the player's speed cap.
3. **Shrink the map:**
   - A central-area graph with edge portals.
   - Out-of-town trips, and lane counts kept in the graph.
   - Nine zones redrawn inside the area.
   - Demand retuned for shorter trips (the mean ride drops from 4.7 to 3.3 km).
   - Save format v2: old saves show "saved on an older map".
4. **Extra data from OpenStreetMap, via the mirror you approved:**
   - All building tags and relations, trees, walls, street furniture, footpaths, shopfronts and traffic signals, for the central area.
   - A new bake script classifies buildings, finds street fronts and temple roles, and writes a compact file of under 1 MB gzipped.
5. **3D foundation (me):**
   - three.js (WebGL2), the camera, and the 256 m chunk framework with batched geometry.
   - Meshes are built in a Web Worker while the title screen shows.
   - Ground, roads and plain buildings, picking, the passenger badges ported from the map view, and a performance overlay.
6. **Parallel 3D workstreams**, each in its own worktree:
   1. Roads and ground polish (junctions, markings, pavements, moat, bridges, runway).
   2. Buildings, temples and the 17 landmarks.
   3. Vegetation and street furniture.
   4. Vehicles and people (models, animation, ambient traffic, crowds, waiting passengers).
   5. Lighting, weather and festivals.
   6. Drive/manage modes, minimap and the city-map planner.
7. **Integration:**
   - A performance pass against the budget: 60 fps on a MacBook at street level, ≥ 30 fps zoomed out.
   - Balance tuning with headless simulations.
   - A full code review, and play-testing in the browser.
   - Then the 3D view becomes the default.

**Checks throughout:**

- Vitest tests for:
  - the bake (deterministic output, 88 temple grounds each with a viharn and a chedi, height caps);
  - mesh generation (no NaNs, triangle budgets);
  - lanes (offset on the left);
  - out-of-town trips;
  - the drive clock and kerbside pickups;
  - signals;
  - balance.
- In the browser pane:
  - camera bookmarks for screenshot comparison (Tha Phae Gate, Wat Chedi Luang, Night Bazaar, Nimman, riverside, airport, overview);
  - a scripted benchmark with 60 tuk-tuks at 8×;
  - checks at 07:00, 12:00, 17:30, 18:30 and 23:00 in clear, rain and haze;
  - Yi Peng night.
- Performance is also measured on your MacBook in Chrome and Safari.

## 4. Decisions in this plan (flag any you want different)

- The playable area shrinks to the central box. Farther places become out-of-town trips rather than being dropped.
- Driving pace is 4 game seconds per real second while you steer by hand, adjustable from 3 to 5 in settings.
- The flat map stays as an optional planner, not the main view.
- All 3D art is generated in code. There are no downloaded models or textures; one procedural texture atlas holds signs and patterns.
- Saves from the current 2D version won't carry over.

Detailed architecture, data formats, and per-workstream "done" criteria come from the three planning reports. They'll be written into `docs/design.md` as each piece lands.
