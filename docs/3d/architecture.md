# Tuk-Tuk Tycoon 3D ("2.5-D") rendering architecture

> How the 3D city is built and drawn, as the code stands. The approved plan is [docs/plan-3d.md](../plan-3d.md);
> the content and art rules the builders follow are in [world.md](world.md), and controls, modes and the drive clock
> in [gameplay.md](gameplay.md). Numbers marked *measured* come from the shipped `public/data` and the code's own
> counters (§13).

## 0. Facts the design rests on

- **The 3D view is the game.** `World3DView` (`src/world3d/World3DView.ts`) is the main view. The flat MapLibre map
  (`src/map/MapView.ts`) is loaded only when it is opened: as the City map planner (M), or as the main view with
  `?view=map`.
- **The simulation owns no view.** `startGameLoop` (`src/ui/loop.ts`) calls `game.update(dt)` once per animation
  frame; views only draw. The UI talks to whichever view is showing through `GameView` (`src/ui/view.ts`).
- **Playable area.** Lon 98.950–99.020, lat 18.762–18.808 (`PLAY_BBOX` in `scripts/bbox.mjs`). In sim metres around
  the graph origin (18.79 N, 98.9775 E) that is x −2,898…+4,479 and y −3,096…+1,990. The 3D data keeps everything that
  touches the area grown by 350 m (the *kept area*).
- **Data sizes** (*measured*, `public/data/city3d.json`): 21,224 building footprints, 7,227 road ways, 1,821 areas,
  1,268 OSM trees and 1,687 OSM street-furniture points. The file is 4.3 MB, 1.5 MB gzipped.
- **The public GeoJSON has almost no tags** (buildings carry only `l`), so the 3D city has its own bake from the raw
  extracts in `data-raw/`. `data-raw/` is gitignored and absent from `.claude/worktrees/*` checkouts, so the bake
  output is committed and the bake takes a `DATA_RAW=<path to a checkout's data-raw>` override.
- **Saves store edge indices** (`v.arc`). The 3D bake only reads `graph.json`; a change to the graph needs a new
  `SAVE_VERSION` (`src/sim/game.ts`).

## 1. Key decisions

| Topic | Decision |
|---|---|
| Renderer | `THREE.WebGLRenderer` (three 0.186, WebGL2), antialiased, `NeutralToneMapping`, sRGB output. Lit surfaces use `MeshLambertMaterial` patched through `onBeforeCompile` (`cityMaterial` in `layers/city.ts`, `patchMaterial` in `materialPatch.ts`, the vehicle and people materials in `batches.ts`), so fog, lights and shadows keep working. Glows, the sky and weather particles use small `ShaderMaterial`s. |
| Coordinates | Identity mapping, no re-origin: `world.x = sim.x`, `world.y = up`, `world.z = −sim.y`. A vehicle's heading is its `rotation.y`, with models built facing +X. Float32 precision at 4.5 km is about 0.5 mm. |
| Data | `scripts/build-city3d.mjs` (`npm run city:build`) bakes `public/data/city3d.json`: semantic JSON in integer decimetres. Meshes are generated at runtime in a Web Worker by pure TypeScript with no three.js (`src/world3d/build/`), so Vitest runs the same code and art direction changes need no re-bake. |
| Static geometry | Eight static layers, one material each. The worker splits each layer into 800 m tiles and uploads one `Mesh` per tile (724 meshes, *measured*). Tiles are culled by the view frustum and by fog distance. There is no LOD and no `BatchedMesh`. |
| Instanced statics | One `InstancedMesh` per tree species (13) and per street-prop model (14). `CulledInstances` (`instanceCull.ts`) sorts the instances into 200 m cells once and each frame draws only the cells in view and in range. |
| Ground | A depth-writing street-level base with holes where water is sunk, then one painter's-order paint layer (`roads`) drawn without depth writes, then the sunken water. No boolean polygon operations. |
| Picking | Screen-space: the nearest request, vehicle or landmark within a few CSS pixels of its projected anchor. The only ray cast is against the ground plane, for right-click "drive here" and grab-panning. |
| Labels and markers | A 2D HUD canvas over the WebGL canvas (`hud.ts`, `driveHud.ts`), plus in-world rings, beacons and a route ribbon (`layers/markers.ts`). |
| MapLibre | The flat City map, lazily imported, used for planning (zones, closures, depots, street labels and one-way arrows). |

## 2. Module layout

```
src/ui/loop.ts                 startGameLoop: rAF → game.update(dt); views only draw
src/ui/view.ts                 GameView: flyTo, screenPoint, footprint, setActive, destroy
src/ui/App.tsx                 creates World3DView (or MapView with ?view=map); swaps in the planner on M
src/world3d/
  World3DView.ts               renderer, scene, camera rig, input, picking, layer list, loadCityMeshes() (worker + cache)
  camera.ts                    chase / kerbside / manage camera modes, manageElevation()
  city.ts                      CityData: the shape of city3d.json
  cutaway.ts materialPatch.ts  Drive-mode see-through around the player's tuk-tuk; shader patch chaining
  instanceCull.ts              CulledInstances: per-cell culling for city-wide instanced meshes
  kinematics.ts                lane offsets, smoothed poses, roll/pitch/wheel spin, kerbside queues (pure)
  traffic.ts crowd.ts          cosmetic street traffic and pedestrians around the camera (pure simulation)
  hud.ts driveHud.ts stats.ts  HUD canvas, Drive-mode HUD, frame statistics overlay
  batches.ts                   instanced vehicle and people batches (one draw per model)
  models.ts lowpoly.ts         model kits
  vehicleModels.ts personModels.ts treeModels.ts propModels.ts festivalModels.ts
  build/                       PURE TS (earcut only): runs in the worker and in Vitest
    worker.ts                  fetch city3d.json → buildCity → tileCity → post (transferable buffers)
    world.ts                   buildCity (builder order), tileCity, TILE_SIZE
    context.ts                 BuildContext, LAYERS, TREE_KINDS, addProp
    mesh.ts                    MeshWriter, splitMesh, clipMeshToTiles, gpuMesh, colour helpers
    ground.ts surfaces.ts water.ts airport.ts          ground base, land cover, sunken water, runway
    roads.ts junctions.ts markings.ts bridges.ts paths.ts roadIndex.ts
    buildings.ts site.ts shophouse.ts typologies.ts massing.ts kit.ts shapes.ts
    temples.ts chedi.ts heroChedis.ts landmarks.ts landmarks3d.ts
    scatter.ts props.ts streets.ts clearance.ts occupancy.ts   trees and street furniture
    walkways.ts effects.ts     crowd walk runs; festival, market and weather anchors (fx_*)
    backdrop.ts                Doi Suthep–Doi Pui massif
    palette.ts groundPalette.ts buildingPalette.ts
  layers/
    types.ts                   ViewContext, WorldLayer, FrameInfo
    city.ts                    CityLayer: tile meshes, instanced trees and props, night windows
    environment.ts             sun, moon, sky, fog, weather, festivals, night lights, shadows, quality
    sky.ts effects.ts glow.ts nightLights.ts festivals.ts
    vehicles.ts people.ts crowds.ts signals.ts markers.ts
  env/
    sun.ts lighting.ts atmosphere.ts festivals.ts quality.ts colour.ts
scripts/build-city3d.mjs       data-raw/*.json + graph.json origin → public/data/city3d.json
tests/world3d-*.test.ts        build, ground, buildings, props, effects, crowds, env, layers, models, people, vehicles
```

**Dependencies:** `three@0.186`, `@types/three@0.186`, and `earcut@^3`. No postprocessing library and no textures:
every colour is a vertex colour.

## 3. Data: bake vs runtime, format, load

### Pipeline

1. `npm run map:fetch` (`scripts/fetch-osm.mjs`) downloads the Overpass extracts into `data-raw/`: the wide fetch box
   for roads, water, green, forest, land use, buildings and POIs, and the playable area plus about 300 m for the 3D
   detail (`buildings3d`, `trees`, `barriers`, `furniture`, `paths`, `landcover3d`, `shopfronts`).
2. `npm run map:build` (`scripts/build-map.mjs`) writes `graph.json` (the clipped road graph with portals, off-map
   destinations and signals), `pois.json` and the flat map's GeoJSON layers.
3. `npm run city:build` (`scripts/build-city3d.mjs`) writes `city3d.json`. It takes its origin from `graph.json`, so it
   runs after `map:build`; re-run it after `map:fetch` or after changing the boxes in `scripts/bbox.mjs`.

### Bake (`build-city3d.mjs`)

- **Roads**: every road way touching the kept area, as `[class, flags, widthDm, lanes, name, surface, layer,
  ...nodes]`. Width comes from the `width` tag, else `lanes ×` the class lane width (3.25 m trunk/primary, 3.0 m
  secondary/tertiary, 2.75 m otherwise) + 0.6 m, else a class default (trunk 14, primary 12, secondary 10, tertiary 8,
  unclassified 6.5, residential 5.5, living street 4.5, service 4 m). Flags:
  `ONEWAY | BRIDGE | TUNNEL | ROUNDABOUT | LINK | SIDEWALK_L | SIDEWALK_R | LIT`.
- **Buildings**: outer ring and holes, the `building=*` value, zone, area, oriented box (long side, short side,
  angle), levels and heights, roof shape and colours, material, the street-front edge and its road, the temple
  ground, use and name.
- **Areas**: water (moat, river, pools), green and land cover, temple and worship grounds, campuses, markets,
  parking, plazas, the airport apron and land-use zones.
- **Lines**: river, canal, stream and drain lines, rail, runway and taxiways, city walls, walls, fences and hedges,
  power lines, footways and steps, tree rows; plus city-wall remnants and bastions as rings (`cityWalls`).
- **Points**: OSM trees with species, street furniture, shopfronts.

The format is plain JSON (`version: 1`); its TypeScript shape is `CityData` in `src/world3d/city.ts`. Rings are
clockwise with counter-clockwise holes and do not repeat their first vertex.

### Runtime build (worker)

`loadCityMeshes` starts the worker when the first `World3DView` is created (a new game or a continued one) and caches
the result for the page, so remounts and quit-to-title reuse it. The worker runs the builders in a fixed order (§14),
then `tileCity` splits the layers into tiles and packs them for the GPU, and posts everything at once with transferable
buffers. Vehicles, people and the HUD draw while it works; the HUD shows a loading note until the city arrives.

| Step | *Measured* |
|---|---|
| `city3d.json` | 4.3 MB raw, 1.5 MB gzipped |
| `buildCity` in the worker (Chrome, the development Mac) | 1.0 s |
| `buildCity` under Vitest (Node) | 2.5–3.6 s of CPU, depending on how busy the machine is; the buildings test holds it under 4 s of CPU |
| `tileCity` under Vitest | about 0.4 s |

## 4. Static world: layers, tiles, culling, render order

### Layers

`LAYERS` (`build/context.ts`), each with its own material:

| Layer | Content | Triangles (*measured*) |
|---|---|---|
| `backdrop` | the Doi Suthep–Doi Pui massif, outside the fog, with its own aerial haze | 13k |
| `ground` | far plain and the street-level base, open over sunken water | 2.6k |
| `water` | sunken moat, river, canals and ponds with their banks | 6.7k |
| `roads` | all ground paint: land cover, pavements, kerbs, carriageways, junctions, markings, rail, runway | 457k |
| `structures` | walls, bridges, parapets, platforms, power-line cables | 304k |
| `buildings` | buildings, temples, chedis and landmarks | 1,192k |
| `windows` | window panes and shopfront glass, lit from inside at night | 214k |
| `glow` | neon, lanterns and lit signs, bright whatever the light | 24k |
| **Total** | | **2.21 M** |

### Tiles

- `tileCity` (`build/world.ts`) cuts every layer except `ground` and `backdrop` into 800 m squares (`TILE_SIZE`).
  `splitMesh` assigns whole triangles by centroid. The `roads` layer draws in painter's order, so `clipMeshToTiles`
  cuts its triangles at tile edges instead, keeping source order within each tile, so tiles never overlap.
- `gpuMesh` packs normals into `Int8` and indices into `Uint16` wherever a tile has at most 65,536 vertices.
- *Measured*: 724 tile meshes (roads 341, structures 92, buildings 89, windows 79, water 64, glow 57, ground 1,
  backdrop 1), 4.35 M vertices, 94.6 MB of geometry.

### Culling (`layers/city.ts`)

- three.js frustum-culls each tile by its bounding sphere (the ground is never culled).
- `CityLayer.update` hides tiles whose bounding sphere lies wholly beyond the fog's far distance, and window and glow
  tiles beyond 1.8 km.
- Trees and props: `CulledInstances` draws the 200 m cells inside the frustum and within the model's range,
  `max(250 m, 650 × model radius × largest instance scale)`, capped at the fog's far distance. Instance buffers are
  rewritten only when the set of drawn cells changes.

### Render order

| renderOrder | Content | Depth |
|---|---|---|
| −900 | stars | — |
| −3 | `ground` | writes |
| −1 | `roads` (all ground paint) | `depthWrite: false`, `polygonOffset(−2, −2)`; later paint covers earlier paint |
| −0.5 | `water` and banks, seen through the holes in the ground | writes |
| 0 | buildings, structures, windows (`polygonOffset(−1, −1)`), glow, trees, props, vehicles, people | normal |
| 3–6 | headlight pools, route ribbon, rings, lamp pools | decals |
| 20–30 | glow sprites, rain, splashes, mist | additive or blended |
| 1000 | sky dome, drawn last behind everything, matching the fog colour at the horizon | — |

The camera's near plane is `clamp(0.02·D, 0.4, 60)` m and its far plane 40 km, where D is the camera distance.

## 5. Roads (street-level quality)

- **Road network (`junctions.ts`).** Per way: carriageway half-width, lanes (tagged, else what the width holds), and
  pavement widths from the sidewalk tags or class defaults (3.0, 2.8, 2.4, 2.0, 1.2 m for trunk…unclassified).
- **Junctions.** For every node where three or more arms meet:
  1. Arms are sorted by angle. Between each pair of neighbours, the left kerb line of one is intersected with the right
     kerb line of the next. Nearly opposite arms (> 175°) get no corner; nearly parallel ones (< 15°, merging
     carriageways) get no kerb corner.
  2. Each corner gets a kerb fillet (radius 6 m where a trunk…secondary road meets, 4 m otherwise, 1.2 m without
     kerbs); the fillet reaches at most 14 m along an arm.
  3. An arm's setback is the larger of its two corner needs plus 0.3 m, capped at 30 m and at 45 % of the arm's length.
  4. The junction surface is the ring of arm ends and fillet points. If the ring is not simple, its convex hull stands
     in, and kerbs do not follow its fillets. The ground test requires valid, simple polygons at 99 % or more of the
     real junctions.
- **Carriageways, pavements and kerbs (`roads.ts`).** Pavements, kerbs (red and white near Old City junctions and bus
  stops), carriageways coloured by surface and class, junction surfaces and rounded kerb corners, all in the `roads`
  layer in painter's order, so overlapping flat pieces never z-fight at any distance.
- **Markings (`markings.ts`).** Double yellow centre lines on two-way trunk and primary roads, white dashed centre and
  lane lines by lane count, edge lines on big roads, zebra crossings at OSM crossings and signalised junctions, stop
  lines on the inbound left half, one-way arrows every ~60 m in each lane, and the painted tuk-tuk rank at Tha Phae
  Gate. Lines stop at junction setbacks.
- **Water (`water.ts`).** The moat 1.6 m below the street between brick bank walls, the Ping 3.5 m down between sloped
  grassy banks, canals in concrete channels, ponds with stone edges. The moat causeways are the ground left between
  the OSM water pieces.
- **Bridges (`bridges.ts`).** A bridge over sunken water gets a concrete deck at street level with slab sides,
  parapets and piers; the Iron Bridge gets its steel through truss. Bridges over painted canal channels keep to grade
  with low parapets, and flyovers are drawn at grade like any road.
- **Airport and rail (`airport.ts`, `surfaces.ts`).** Runway 18/36 with piano keys, numbers and centreline, taxiways
  with yellow lines; rail as ballast, sleepers and rails with station platforms.

## 6. Buildings, temples, walls, landmarks

- **Order.** Hero landmarks (`landmarks.ts`, definitions in `landmarks3d.ts`) and temple grounds (`temples.ts`) are
  built first; the generic pass (`buildings.ts`) skips the footprints they replace.
- **Classification and height.** Tags first, then size, street front and district (world.md §2.4). Tagged heights
  and levels win; untagged buildings keep to the 12 m Old City and 9 m near-temple caps.
- **Typologies.** Shophouse rows split into 3.5–4.8 m bays (`shophouse.ts`); houses, Lanna houses, blocks, condos,
  schools, hospitals, malls, market halls, canopies, kiosks, sheds, churches, mosques and shrines (`typologies.ts`),
  sharing walls, parapets, pitched roofs and rooftop clutter from `massing.ts`.
- **Windows are geometry.** Panes and shopfront glass go to the `windows` layer and signs to `glow`; at night
  `CityLayer.setNight` raises their emissive intensity (windows 0.05 → 1.0, glow 0.35 → 1.0).
- **Temples.** Role inference inside each ground (viharn facing its street, ubosot with sema stones, chedi, ho trai,
  sala, halls, kuti, schools, shrines), synthesis of a viharn or chedi where none is mapped, Lanna halls with stepped
  roofs, chofa and naga bargeboards, compound walls, arch gates with singhas, and a spot for the bodhi tree. Chedis
  come in four types and four finishes (`chedi.ts`); Wat Chedi Luang is a hero model (`heroChedis.ts`).
- **City walls** are extruded from the OSM wall lines and bastion polygons with merlons (`ground.ts`); the gates are
  hero models.

## 7. Vegetation and props

- **Obstacles.** `Occupancy` (a coarse raster that also blocks pavements) and `clearance.ts` (an exact index of
  carriageways, footprints, water, rail, runways, walls and paths) keep trunks and props where they belong.
- **Trees (`scatter.ts`).** OSM trees and tree rows with their species, a bodhi in every temple ground, both moat
  banks, arterial pavements, Poisson-disc parks, forests and campuses, house yards, and bougainvillea on walls.
  *Measured*: 23.7k trees of 13 species. Tree models (`treeModels.ts`) stay within ~110 triangles, ~40–55 for the
  common species.
- **Street furniture (`props.ts`, `streets.ts`).** Power poles with cable bundles (cables are static geometry in
  `structures`; none on the buried-cable roads, which get PEA cabinets), arm lamps and heritage lanterns, traffic
  lights at OSM signals, bus shelters, moat fountains, spirit houses, parked motorbikes, flags, stalls, food carts with
  parasols, and benches. *Measured*: 23.9k props of 14 kinds.
- **Anchors.** Some `addProp` kinds are data, not models: crowd walk runs (`walk*`, `walkways.ts`), festival, market
  and weather anchors (`fx_*`, `effects.ts`) and bodhi spots. `isMarkerKind` in `propModels.ts` names them.
- **Budgets (tests).** Trees under 1.4 M instanced triangles, props under 1.0 M and under 40k instances
  (`world3d-props.test.ts`).

## 8. Dynamic entities

- **Kinematics (`kinematics.ts`).** Render state per vehicle, never in `game.state`: left-hand lane offsets, a
  wheelbase-smoothed pose through polyline corners and junctions, wheel spin, body roll and pitch, brake lamps, LPG
  idle shake, and stopped vehicles queued nose to tail along the kerb.
- **Vehicles (`layers/vehicles.ts`).** Fleet tuk-tuks, the rivals system's songthaews, rival tuk-tuks, cars and
  motorbikes (`src/sim/rivals.ts`), and cosmetic street traffic (`traffic.ts`), drawn as one `VehicleBatch` per model
  (`batches.ts`): livery per paint slot, wheels, body motion and lamp glow in the shader. Drivers, passengers and riders
  are instanced people; headlight pools light the road at night. Each fleet vehicle has an empty `Object3D` following
  its rendered pose, for the HUD, markers and picking.
- **Scale.** Vehicles render at `max(1.3, D / 150)` so they stay legible zoomed out.
- **People (`layers/people.ts`, `layers/crowds.ts`, `crowd.ts`).** Waiting and alighting passengers dressed by
  archetype, and cosmetic pedestrians on the baked pavement runs near the camera, thinning out by hour and crowding at
  markets and the walking streets. Figures are one rigged geometry (`personModels.ts`) posed in the vertex shader from
  per-instance joint angles; each batch is one draw. Walkers move at real walking pace, at most twice real time.
- **Signals (`layers/signals.ts`).** A red, amber or green lamp at the stop line of every signalled approach, following
  `src/sim/signals.ts` each frame.

## 9. Camera, input, picking

- **Rig.** Target (sim metres), distance D, compass yaw and elevation; vertical FOV 40°.
- **Modes (`camera.ts`).**
  - `chase` (Drive): distance `clamp(45 + 1.2 × on-screen speed, 35, 120)` m at 27° elevation, looking up to 30 m
    ahead; 220–400 m at 50° while the GPS drives. A drag orbits; the camera swings back behind the tuk-tuk later.
  - `kerbside` (the player's haggle): 14–25 m, 16° elevation, 70° off the heading, orbiting at 3°/s.
  - `manage`: free. Elevation `28° + 12°·clamp(D/160, 0, 1) + 26°·smoothstep(250, 3500, D)` plus the user's tilt,
    clamped to 10°–85°. Leaving Drive rises to at least 380 m.
- **Manage input.** Left-drag grab-pans (the ground point stays under the cursor) and stops following; right- or
  middle-drag turns and tilts; the wheel zooms (22 m to 6 km); WASD or the arrows pan. Right-click is "drive here".
- **`flyTo(x, y, zoom?)`.** A 0.7 s ease to the point, and to `D = clamp(180·2^(16−zoom), 25, 6000)` when a zoom is
  given, so web-map zoom levels keep their meaning for the UI's call sites.
- **Picking.** Requests within 22 CSS px of their kerb or badge, then vehicles within 28 px of their roof, then (when
  D < 1.5 km) landmarks and LPG stations within 22 px of a point 12 m up. Hover uses the same tests for the cursor.

## 10. Overlays: HUD, markers, minimap

- **HUD canvas (`hud.ts`).** Passenger badges with patience rings and fares (`passengerBadge` from
  `src/map/sprites.ts`), landmark names and status icons over fleet tuk-tuks, and the shared overlay painters
  (`src/map/painters.ts`). `SKIP_2D_PAINTERS` leaves out the painters the scene replaces with 3D objects (rivals,
  closures, festival decor, rain and weather tint). Painters get `zoom = 16 − log2(D / 180)`.
- **Drive HUD (`driveHud.ts`).** Arrows at the screen edge to the nearest waiting passengers out of view, "E" prompts,
  and waving hands after the horn.
- **Markers (`layers/markers.ts`).** The ring under your tuk-tuk, the selection ring, destination and pickup beacons,
  and a route ribbon on the road.
- **Minimap** (`src/ui/Minimap.tsx`, a React overlay): a heading-up radar in Drive mode, a north-up overview with the
  camera's `footprint()` in Manage mode.

## 11. Lighting, shadows, sky, night

- **Sun and moon (`env/sun.ts`).** The NOAA simplified solar model for 18.79 N at UTC+7; November sunrise ≈ 06:24,
  sunset ≈ 17:51. `daylight()` (`src/sim/clock.ts`) keeps those November times all year and serves only the flat map;
  the 3D layers read day and night from `EnvState.night` (`ViewContext.envState()`), which follows this model. The
  moon has position, phase and illumination.
- **Time of day (`env/lighting.ts`).** Keyframes for morning, day, golden hour, blue hour and night, blended by sun
  elevation (world.md §3.2): key light, sky zenith and horizon, hemisphere colours, fog and exposure. The moon is a dim
  key light at night; the key light never comes from lower than 7°.
- **Weather (`env/atmosphere.ts`).** Rain and storms darken and desaturate the light and pull the fog in, with
  lightning; roads darken and shine when wet; cool-season mornings bring mist over the moat and the Ping; smoky haze
  browns the fog, reddens the sun and hides Doi Suthep.
- **Fog.** `near = (1.4·D + 250) × weather`, `far = max(near + 60, (4.5·D + 1600) × weather)`. Tile culling uses the
  same far distance.
- **Shadows.** One directional sun shadow map, `PCFShadowMap`, bias −0.0004, normal bias 0.6, size by quality. The
  box is centred on the camera target with half-extent `clamp(1.3·D, 80, 700)` m and snapped to shadow texels so it
  does not shimmer. Shadows are off when the moon is the key light, the sun is below 2°, the key light is weak, or
  D ≥ 2.5 km. Casters: building and structure tiles, vehicles and people. Trees and props receive but do not cast.
- **Sky (`layers/sky.ts`).** A gradient dome with the twilight glow, sun disc, moon, clouds, stars and lightning,
  drawn without tone mapping like the fog, so the far city dissolves into it.
- **Night without light sources** (`layers/glow.ts`, `layers/nightLights.ts`): additive camera-facing halos at lamp
  heads, lanterns and candles, with a minimum on-screen size; additive light pools on the ground; lit windows and signs
  (§6).
- **Festivals** (`layers/festivals.ts`, `env/festivals.ts`): Yi Peng lanterns and candles, krathongs on the Ping,
  walking-street and Night Bazaar stalls, Songkran and Chinese New Year dressing, built from the `fx_*` anchors the
  first time each is needed and shown when the events calendar (`src/content/events.ts`) says so.
- **Weather effects** (`layers/effects.ts`): rain streaks, splashes and mist, each one draw call animated on the GPU.
- **Cutaway (`cutaway.ts`).** In Drive mode, buildings, trees and props between the camera and your tuk-tuk dissolve
  in a dithered tube along the line of sight. The discard is compiled in only in Drive mode (`USE_CUTAWAY`), so
  other views keep shaders that never discard.

## 12. UI integration

- **`GameView` (`src/ui/view.ts`).** `kind`, `flyTo`, `destroy`, and optionally `screenPoint`, `footprint` and
  `setActive`. `PanelProps` and `OverlayProps` carry the current view.
- **App (`src/ui/App.tsx`).** Creates `World3DView`, or `MapView` with `?view=map`. M sets `ui.planner`: the 3D view
  stops rendering (`setActive(false)`) and the flat map mounts over it, flown to the 3D camera's target; closing it
  flies the 3D camera to where the map was looking (in Manage mode) and resumes rendering.
- **Modes (`src/ui/mode.ts`).** `mode: 'drive' | 'manage'` in the `ui` store, UI-only and never saved; the last choice
  is remembered for the browser session. Drive opens by default while the fleet is a single tuk-tuk.
- **DOM.** The view's container holds the WebGL canvas (`world-gl`), the HUD and Drive HUD canvases (no pointer
  events) and the stats overlay. Input listeners attach to the WebGL canvas, so wheel and drag over panels never move
  the camera.
- **Lifecycle.** `World3DView.destroy()` cancels its frame loop, removes listeners, disposes layers, geometries and
  materials, then `renderer.dispose()` and `forceContextLoss()`. The built city stays in the module-level cache in
  `World3DView.ts`, so StrictMode remounts and quit-to-title do not rebuild it.

## 13. Performance budget

*Measured* in the dev build (Chromium 152 on an Apple M4 Pro): Tha Phae Gate, noon on day 1, clear weather, medium
quality, an 846 × 998 CSS px view at pixel ratio 1.5, with a script calling `World3DView.frame` about every 13 ms.
Draw calls and triangles come from `renderer.info`, read around `renderer.shadowMap.render` to split the two passes
(the `?stats` overlay reports both together). Each Manage column is the range over eight compass headings, 45° apart,
with the camera placed by `__world3d.setCamera`; the triangle count depends strongly on the heading. The cosmetic
traffic and crowds move the counts by a few draws and about 0.05 M triangles between runs. CPU time is
`World3DView.frame` (layer updates, render submission and HUD) with the machine at a load average of 16–33.

Street level is Drive and Manage up to D 800 m; overview is D 3–5 km. D 1.5 km lies between the two budgets.

| Metric | Budget | Drive chase (D ≈ 45 m) | Manage, D 150–300 m | Manage, D 800 m | Manage, D 1.5 km | Overview, D 3–4 km | Overview, D 5 km |
|---|---|---|---|---|---|---|---|
| Main-pass draw calls | ≤ 120 street level, ≤ 200 overview | 81 | 58–82 | 84–93 | 80–99 | 90–122 | 137–151 |
| Shadow-pass draw calls | ≤ 40 | 17 | 17–21 | 35–36 | 29 | 0 (off from 2.5 km) | 0 |
| Triangles, main pass | ≤ 0.8 M street level, ≤ 1.5 M overview | 0.54–0.55 M | 0.43–0.80 M | 0.62–0.92 M | 0.73–1.10 M | 1.07–1.41 M | 1.49–1.62 M |
| Triangles, shadow pass | — | 0.31–0.32 M | 0.41–0.52 M | 0.70 M | 0.65 M | 0 | 0 |
| CPU per frame, p50 / p95 | ≤ 4 ms | 1.2–1.4 / 1.5–2.2 ms | 1.3–1.6 / 1.6–2.5 ms | 1.4–1.6 / 1.7–2.0 ms | 1.1–1.4 / 1.5–1.9 ms | 1.0–1.3 / 1.2–1.7 ms | 1.1–1.3 / 1.4–1.6 ms |
| GPU | ≤ 10 ms on M1 at DPR 1.5, MSAA | not measured | | | | | |

| Resource | Budget | *Measured* |
|---|---|---|
| Static geometry (tiles) | ≤ 80 MB | 94.6 MB; about 96 MB with every geometry in the scene |
| Textures | shadow map only | shadow map only (1024², 2048² or 4096² by quality) |
| JS heap | ≤ 120 MB for the city after the build | 155 MB for the whole page (game, React and city) |
| Sim at 8× with 50+ tuk-tuks | ≤ 3 ms per frame | not measured at 8×; `tests/world3d-layers.test.ts` holds sim + layers for a busy evening street (57 vehicles, ~200 people) under 12 ms per frame and measures ≈ 0.7 ms |

Over budget:
- **Main-pass triangles at street level:** up to 0.92 M at D 800 m against 0.8 M; D 300 m reaches the limit. At
  D 1.5 km, between the two budgets, the main pass draws up to 1.10 M.
- **Main-pass triangles at overview:** up to 1.62 M at D 5 km against 1.5 M.
- **Static geometry:** 94.6 MB against 80 MB. It follows from the triangle totals below.
- **JS heap:** 155 MB for the whole page; the city's own share has not been measured.

Draw calls, the shadow pass and CPU time are within budget at every distance.

**Build budgets the tests hold** (`buildCity` on the shipped data):

| Content | Test budget | *Measured* |
|---|---|---|
| All static layers | < 3.0 M triangles (`world3d-build`) | 2.21 M |
| Buildings + windows + glow | < 1.6 M (`world3d-buildings`) | 1.43 M |
| Structures | < 400k (`world3d-buildings`) | 304k |
| Roads layer | < 600k (`world3d-ground`) | 457k |
| Water / ground | < 40k / < 20k (`world3d-ground`) | 6.7k / 2.6k |
| Trees (instanced) | < 1.4 M triangles (`world3d-props`) | 1.24 M (23.7k trees) |
| Props (instanced) | < 1.0 M triangles, < 40k instances (`world3d-props`) | 0.85 M (23.9k props) |
| Whole build | < 4 s CPU (`world3d-buildings`) | 2.5–3.6 s CPU, depending on how busy the machine is |

**Draw calls by group (street level):**

| Group | Draws |
|---|---|
| Static tiles in view | one per visible tile per layer (tens) |
| Trees | up to 13 (one per species with cells in view) |
| Props | up to 14 (one per model with cells in view) |
| Vehicles, people, riders, headlight pools | one per model batch |
| Sky, glows, markers, weather and festival effects | one each |

**Instanced vs merged:**
- **Merged, per tile:** the eight static layers.
- **Instanced static (`CulledInstances`):** trees and street props.
- **Instanced dynamic (per-instance attributes refilled each frame, `batches.ts`):** tuk-tuks, rivals, cosmetic
  traffic, passengers, riders, walkers.
- **Unique:** route ribbon, rings, beacons, sky, the Doi Suthep backdrop.

**Quality presets (`env/quality.ts`)**, stored per browser (`localStorage` `tuktuk.quality3d`; dev builds:
`__world3d.quality.set(level)`):

| Preset | Shadow map | Pixel ratio cap | Rain streaks | Splashes | Mist puffs | Krathongs |
|---|---|---|---|---|---|---|
| Low | 1024² | 1 | 3,000 | 480 | 900 | 60 |
| Medium (default) | 2048² | 1.5 | 7,000 | 1,200 | 2,400 | 140 |
| High | 4096² | 2 | 12,000 | 2,400 | 2,400 | 240 |

## 14. Extension points

- **A new static feature:** a builder in `src/world3d/build/` that writes through `ctx.w[layer]` (a `MeshWriter`) or
  records instances with `addProp`, called from `buildCity` in `build/world.ts`. Order matters: the ground builder
  collects parks, moat rings and water bodies; roads and buildings mark the occupancy raster that the tree scatter and
  props read. Keep builders pure (no three.js, no DOM) so they run in the worker and in Vitest.
- **A new prop model:** add a geometry factory to `PROP_MODELS` (`propModels.ts`) under the kind name the builder
  records; kinds that are data for other layers must match `isMarkerKind`.
- **A new scene layer:** implement `WorldLayer` (`layers/types.ts`) and add it in the `World3DView` constructor or
  with `ViewContext.addLayer` (for layers that need the built city, from `ViewContext.city()`). Read night, lamps and
  rain from `ViewContext.envState()`, which the environment layer updates before the others each frame.
- **2D drawing over both views:** `registerPainter` (`src/map/painters.ts`); add the painter's id to
  `SKIP_2D_PAINTERS` in `hud.ts` when the 3D scene draws the same thing itself.

## 15. Risks and verification

### Open risks

1. **Geometry and triangles.** The static city is 2.2 M triangles and 95 MB of geometry, over the 80 MB budget, and
   the main pass draws up to 0.9 M triangles at D 800 m and 1.6 M at D 5 km, over the 0.8 M and 1.5 M budgets (§13).
   Tile LOD (flat roofs and no windows for far tiles) is the lever if lower-end machines struggle.
2. **Fill rate at DPR 2 with MSAA and shadows** on older or Intel Macs. The quality presets cap the pixel ratio and
   shadow map; there is no adaptive governor.
3. **Load time.** The worker build starts with the game, not at the title screen, so the city arrives about a second
   (plus fetch) after "New game".
4. **Junction robustness on messy OSM** (dual carriageways, slivers, link roads, roundabouts): convex-hull fallback
   and conservative kerbs; the ground test holds valid polygons at ≥ 99 % of junctions.
5. **WebGL context leaks** from StrictMode, HMR and quit-to-title: strict dispose and the module-level city cache.

### Verification

- **`FrameStats`** (`stats.ts`; `?stats` or the backtick key): fps and p50/p95 frame interval over the last 120
  frames, draw calls, triangles and geometry count. `summary()` returns the percentiles for automated checks.
- **`window.__world3d`** in dev builds: the `World3DView` itself (`setCamera`, `rig`, `renderer`, `stats`, `city()`)
  and `quality`.
- **Vitest (node):** `tests/world3d-*.test.ts` build the whole city from the shipped `city3d.json`: sane buffers,
  triangle and time budgets, determinism, lossless tiling, junction validity, water levels, height caps, temple
  inference, hero landmark anchors, tree and prop placement, models, kinematics, people poses, the sun path,
  atmosphere, festivals and the quality presets. `tests/world3d-layers.test.ts` runs the dynamic layers headless.
- **Frame debugging:** the Spector.js browser extension.
