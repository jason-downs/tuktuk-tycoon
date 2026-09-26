# Tuk-Tuk Tycoon 3D ("2.5-D") rendering architecture

> Reference design report behind [docs/plan-3d.md](../plan-3d.md), the approved plan. Where they differ, plan-3d.md wins: the playable area shrinks to the central box with edge portals and save format v2 (so graph.json is rebuilt), the driving clock is 4 game s per real s, and saves start fresh.

## 0. Findings that shape the design

- **Game loop.** `MapView` owns the loop today: `game.update(dt)` then `draw()` on each rAF. `PaintContext.toScreen/zoom` and `registerPainter` are extension points that other workstreams already use. The UI only calls `view.flyTo(x, y, zoom?)` (App.tsx, FleetPanel.tsx, Toasts), and the `ui` store holds `selectedVehicle/Request/Place` and `follow`.
- **Central-area data.** Sim-metre bbox is x −2,898…+4,479 and y −3,096…+1,990 (origin 18.79 N, 98.9775 E).
  - Graph: 10.0k edges and 624 km of road, 5.1k junction nodes (degree ≥ 3), 1.9k dead ends.
  - Raw roads: 5.8k ways and 29k vertices. Useful tags: `lanes` 3,275, `surface` 4,288, `sidewalk` 542, `bridge` 114, `layer` 143 (123 at +1, 20 at −1), `junction=roundabout` 27, `width` only 69.
  - Buildings: 18,851 footprints and 115.6k vertices. 68 % are 4-corner rings, median area 146 m². Only 821 have `building:levels` and 50 have `height`. There are 18 `building=temple` and 138 `building=roof` (open-sided canopies).
  - Areas: 101 temple grounds, 14 city-wall polygons, a Ping River relation, moat segments, 63 stream/canal lines, runway/taxiway lines, rail.
- **The public GeoJSON has almost no tags.** For example, buildings only carry `l`. So the 3D layer needs a new bake from `data-raw/`.
  - `data-raw/` is gitignored and missing from the `.claude/worktrees/*` checkouts. The bake output must therefore be committed, and the bake script needs a `DATA_RAW=/Users/jason/coderepos/tuktuk/data-raw` override.
- **`graph.json` must stay byte-identical.** Saves store `v.arc` edge indices.
- **Vehicles leave the central area.** The routable graph covers the whole bbox, and workstream B (`worktrees/…-2/src/sim/mountain.ts`) is adding Doi Suthep rides.
- **earcut 3.2.3 is already in node_modules** as a MapLibre dependency.

## 1. Key decisions

| Topic | Decision |
|---|---|
| Renderer | `THREE.WebGLRenderer` (three 0.186, WebGL2). Proven on Chrome and Safari, with mature shadows and BatchedMesh. Shader tweaks go through `onBeforeCompile` on `MeshLambertMaterial`, never raw `ShaderMaterial`, so batching, instancing, fog and shadow chunks keep working. WebGPU/TSL can come later; all materials live in one module. |
| Coordinates | Identity mapping, no re-origin: `world.x = sim.x`, `world.y = up`, `world.z = −sim.y`. Heading → `rotation.y = heading`, with models built facing +X. Float32 precision at 4.5 km is about 0.5 mm. |
| Data | New bake `scripts/build-city3d.mjs` → `public/data/city3d.bin`: compact semantic typed arrays, about 2 MB raw and under 1 MB gzipped. Triangulation, extrusion, roads and scatter run at runtime in a Web Worker, as pure TS with no three imports, so Vitest can test it. |
| Static geometry | One `BatchedMesh` per layer/material. Each 256 m chunk is one geometry in each batch, which gives per-chunk culling, per-chunk LOD via `setGeometryIdAt`, and one multi-draw per layer. |
| Instanced statics | `InstancePool` per prop or tree kind, bucketed by chunk and repacked only when the visible chunk set or LOD band changes. One draw per kind for the whole city. |
| Ground | A "decal stack" of flat layers drawn in painter's order with `depthWrite:false` and `polygonOffset`, on top of a depth-writing base. No boolean polygon operations are needed for roads, sidewalks or junctions. |
| Picking | Analytic ground-plane ray plus screen-space entity picking. **No three-mesh-bvh**, because we never raycast arbitrary meshes; building/place picking is a 2D test in sim metres. |
| Labels and markers | A 2D HUD canvas over the WebGL canvas, porting `MapView.drawPassenger / drawDestinationPin / statusIcon` almost verbatim. In-world 3D markers (route ribbon, beacons, rings, waving figures) add presence. |
| MapLibre | Keep as an optional, lazy-loaded "City map" view (full bbox, labels, one-way arrows) for planning. The game loop moves out of it. |

## 2. Module layout

```
src/loop.ts                       GameLoop: rAF, dt clamp, game.update(dt), then each FrameView.frame()
src/ui/view.ts                    GameView interface (replaces the MapView type in App/panels/overlays)
src/world3d/
  index.ts                        World3DView, preloadCity(), registries
  World3DView.ts                  implements GameView + FrameView; owns renderer, scene, rig, layers, HUD
  coords.ts                       toWorld/toSim/headingToYaw, CHUNK=256, chunkOf(), zoomToDistance()
  config.ts                       LOD radii, quality presets, render-order constants
  palette.ts                      3D palette (reuses PALETTE from src/map/style.ts), sRGB hex → packed
  core/
    Renderer.ts                   WebGLRenderer setup, resize, NeutralToneMapping, compileAsync prewarm, dispose
    Quality.ts                    Low/Med/High presets and adaptive-DPR governor
    FrameStats.ts                 frame p50/p95, sim/sync/render ms, renderer.info; ?stats overlay; window.__world3d
    layers.ts                     WorldLayer interface + registerWorldLayer()
    uniforms.ts                   shared uniform bag: uTime, uNight, uCamDist, uFogFar…
  camera/
    CameraRig.ts                  target/distance/yaw/tilt state, springs, auto-tilt, near/far/fog, flyTo easing
    CameraInput.ts                pointer/wheel/touch/keys; click-vs-drag; grab-pan; emits pick/driveHere
  data/
    cityFormat.ts                 TTC3 binary schema, CityData types, decodeCity() (shared by worker and tests)
    loadCity.ts                   fetch + worker orchestration, progressive chunks by distance, module-level cache
  build/                          PURE TS (earcut only): runs in the worker and in Vitest
    city.worker.ts                entry: decode → prepare → build chunks nearest-first → post (Transferables)
    types.ts                      StaticLayerId, PropKind, PackedMesh, ChunkOutput, FeatureBuilder, BuildContext
    builders.ts                   ordered FeatureBuilder registry (append-only, like systems.ts)
    MeshWriter.ts                 growable pos/normal/color/aux/index writer; ChunkWriter
    spatial.ts                    grid indices (buildings, road segments); OccupancyRaster (2 m cells per chunk)
    rng.ts                        hash32(seed) and a mulberry-style rng; per-feature stable seeds
    network.ts                    RoadNetwork3D: node incidence, junction setbacks (global pre-pass)
    roads.ts junctions.ts markings.ts sidewalks.ts
    areas.ts water.ts bridges.ts
    buildings.ts roofs.ts walls.ts landmarks3d.ts
    scatter.ts
    outskirts.ts                  plain ribbons for graph edges outside the central area (+ terrain later)
  static/
    materials.ts                  groundBase, decal(order), water, facade (windows/night), vertex-colour Lambert
    ChunkBatch.ts                 BatchedMesh wrapper (fallback: super-chunk Meshes when no WEBGL_multi_draw)
    StaticWorld.ts                owns batches + InstancePools; per-frame chunk visibility/LOD
    InstancePool.ts               chunk-bucketed InstancedMesh with repack-on-change
  models/                         procedural low-poly BufferGeometry builders (no assets)
    kit.ts                        box/prism/cylinder/lathe with vertex colour, paint slot, merge
    tuktuk.ts car.ts scooter.ts songthaew.ts truck.ts person.ts
    trees.ts props.ts chedi.ts gate.ts lannaRoof.ts doiSuthep.ts
  entities/
    kinematics.ts                 VehicleKinematics: smoothed yaw, left-hand lane offset, elevation, de-overlap
    TukTukLayer.ts                instanced fleet (1 draw), player "hero" mesh with upgrades, seated passengers
    TrafficLayer.ts               ambient vehicles from registered sources or CosmeticTraffic
    CrowdLayer.ts                 walkers (CosmeticCrowd) + waiting passengers (from requests)
    sources.ts                    registerAmbientSource() extension point for sim-side traffic (workstream D)
    cosmetic/CosmeticTraffic.ts cosmetic/CosmeticCrowd.ts
  overlay/
    HudCanvas.ts                  2D canvas: badges, patience rings, fares, pins, status icons, landmark labels, painters bridge
    labels.ts                     greedy declutter (every 100 ms)
    RouteLine.ts                  road-surface route ribbon with scrolling chevrons
    Markers3D.ts                  selection rings, destination beacon, request arc, turn-choice arrows (workstream E hook)
  picking/Picker.ts               groundAt(px,py) → sim metres; pick(px,py) → request | vehicle | place | ground
  env/
    sun.ts                        solar position for 18.79 N from calendar()
    LightingRig.ts                sun/moon/hemisphere, shadow-box fitting + texel snapping, EnvState
    Sky.ts                        gradient dome, sun glow, stars
    Atmosphere.ts                 fog from rig distance, haze/rain hooks
    NightLights.ts                lamp light pools, headlight glows, window emissive via uNight
  dev/bench.ts                    scripted camera path + N tuk-tuks at 8× → JSON summary
scripts/lib/osm-common.mjs        toXY, simplify, classOf, onewayOf (extracted from build-map.mjs, no behaviour change)
scripts/lib/graph-build.mjs       buildGraph() (same output) + side-channel edge → {wayId, tags}
scripts/build-city3d.mjs          → public/data/city3d.bin; asserts rebuilt graph deep-equals graph.json
scripts/bbox.mjs                  + CENTRAL_BBOX = { west: 98.95, east: 99.02, south: 18.762, north: 18.808 }
tests/world3d/*.test.ts           bake, build, kinematics, coords
```

**Dependencies:** `three@0.186`, `@types/three@0.186`, and `earcut@^3` as a direct dependency. No postprocessing library by default (bloom is optional on High via `three/addons`). Use `three/addons/utils/BufferGeometryUtils.js` for merging model parts.

## 3. Data: bake vs runtime, format, load budget

### Bake (`build-city3d.mjs`, Node, run after `map:build`; `npm run city:build`)

1. **Graph edges.** Re-run the shared `buildGraph` and assert its output deep-equals `public/data/graph.json`. This keeps 3D roads for graph edges on exactly the polylines vehicles use, and yields each edge's source-way tags.
   - Emit a road-attribute table for **all** graph edges (full bbox): width, lanes, flags, surface, elevation-profile index. Lane offsets and route widths then work everywhere.
2. **Road segments** for the central area plus a 150 m margin: graph edges plus non-routable way pieces (same splitting, `graphEdge = −1`). Attributes per segment:
   - `widthDm`: from `width`, else `lanes ×` class lane width (3.25 m for trunk/primary, 3.0 m for secondary/tertiary, 2.75 m otherwise). Defaults when neither is tagged: trunk 14, primary 12, secondary 10, tertiary 8, unclassified 6.5, residential 5.5, living street 4.5, service 4 m.
   - Flags: `ONEWAY | BRIDGE | TUNNEL | ROUNDABOUT | LINK | SIDEWALK_L | SIDEWALK_R | LIT`.
   - `surface` enum, and `dashPhase` (cumulative distance along the OSM way, so dashes don't restart at each split).
3. **Bridge classification.** A bridge polyline that crosses water polygons or waterway lines is a *water bridge*: deck at y = 0, water lowered. Otherwise it is a *flyover*: an elevation profile sampled every 5 m, 6.5 m clearance with ±80 m ramps into the collinear same-name neighbours.
   - `layer=-1` and tunnels (20 and 9 ways) are drawn at grade.
4. **Buildings.**
   - Ring stored as Float32 sim metres.
   - `kind` enum: generic, house, apartments, shophouse (narrow rectangle ≤ 8 m wide on a street), retail, school, hospital, hotel, temple_viharn, temple_small, canopy (`building=roof`), terminal, hangar.
   - `levels`, `heightDm`, `ground` (containing temple/campus/market area), zone (Old City / Nimman / riverside / airport / other), `seed = hash(wayId)`.
5. **Areas and lines.**
   - Areas with kind: park, forest, pitch, temple, campus, hospital, market, apron, cemetery, golf, rural, water_moat, water_river, water_pond.
   - Lines: rail, runway, taxiway, stream, canal, city_wall.
   - Water depth by kind: moat 1.5 m, river 3.5 m, canal 2 m, pond 1 m.
6. **Outskirts.** Nothing extra is needed: graph edges outside the central area come from `graph.json` plus the attribute table. The bake adds only forest and water outlines for the outer ring.

**Format "TTC3":** `[u32 headerLen][JSON header][padding][little-endian sections]`. The header carries version, origin (asserted equal to graph.json's), central and outer rects, chunk size, a string table, and a section directory. Sections are SoA typed arrays.

### Why runtime generation, not pre-baked meshes

The full LOD0 mesh set is about 700k triangles, roughly 17 MB raw and 6–8 MB gzipped. The semantic source is under 1 MB gzipped. Worker generation is about 0.6–1.2 s on M-series, and art direction (colours, roofs, density) can be iterated without re-baking. The bake still does everything that needs raw tags or global OSM topology.

Optional later: an IndexedDB cache of worker output keyed by `hash(city3d.bin) + GENERATOR_VERSION`.

### Load budget (M1-class)

| Step | Budget |
|---|---|
| `city3d.bin` fetch | ≤ 150 ms |
| Worker build, total | ≤ 1.2 s, nearest-first; the 3×3 chunks around the player are posted within ≤ 200 ms |
| GPU upload + `renderer.compileAsync` | ≤ 400 ms |

`main.tsx` calls `preloadCity()` at startup, alongside `loadWorld()`, so the city builds **while the title screen is up**. The target is under 300 ms from "New game" to the first 3D frame. Chunks fade in (dither/opacity ramp) as they arrive.

## 4. Static world: chunks, batches, LOD, render order

### Chunks

- 256 m grid, cx ∈ [−12, 17] and cz ∈ [−8, 12] with z = −y. That is about 600 cells, about 560 non-empty.
- Each primitive is assigned by centroid (buildings), segment midpoint (roads) or node (junctions). Geometry may overhang; bounds come from the actual vertices.
- The whole central city fits in memory, so chunks serve culling, LOD and progressive build — there is **no streaming**.

### Worker output per chunk

```ts
type StaticLayerId = 'groundBase'|'water'|'banks'|'bridge'|'landuse'|'sidewalk'|'kerb'|'asphalt'|'marking'
                   |'building'|'structure';
interface PackedMesh { position: Float32Array; normal: Int8Array /*xyz0 normalized*/; color: Uint8Array /*sRGB RGBA*/;
                       aux?: Float32Array; auxSize?: 2|4; index: Uint32Array }
interface ChunkOutput { key: number; cx: number; cz: number; bounds: Float32Array /*6*/;
  meshes: Partial<Record<StaticLayerId, PackedMesh>>; lod1?: Partial<Record<StaticLayerId, PackedMesh>>;
  instances: Partial<Record<PropKind, Float32Array /* stride 5: x, z, yaw, scale, variant */>> }
```

- Colours stay sRGB `Uint8`; the shared material patch converts to linear in the vertex shader. This avoids 8-bit linear banding in dark colours.
- Vertex size is 20 B (plus aux for facades).

### Batching

- `ChunkBatch` wraps `BatchedMesh(maxInstances, maxVerts, maxIndices, material)` with `addGeometry` / `addInstance` / `setVisibleAt` / `setGeometryIdAt`.
- The worker first posts a manifest with per-layer vertex/index totals so batches are allocated exactly (`setGeometrySize` growth as a fallback).
- `perObjectFrustumCulled = true`.
- **Fallback:** without `WEBGL_multi_draw` (check `renderer.extensions.has`), `ChunkBatch` builds plain Meshes over 1 km super-chunks instead, so draw counts stay bounded.

### LOD bands

These are distances from the camera target, recomputed only when the target moves more than 32 m or zoom crosses a band.

| Band | Range | What renders |
|---|---|---|
| Near | < max(600 m, 1.5·D) | full roofs, parapets, props, trees LOD0, markings, crowd and cosmetic traffic |
| Mid | < fog far | buildings LOD1 (flat roofs, no parapets), trees LOD1 (8–12 triangles), no props, markings faded out |
| Beyond fog far | — | hidden |

### Ground-stack rule (prevents z-fighting and "holes")

Things that must hide things below y = 0, or carry decals, draw **first** and write depth. Flat decals come next without writing depth. Everything above ground draws after.

| renderOrder | Content | Depth |
|---|---|---|
| −100 | sky | no write |
| −30 | `groundBase` (land colour, holes at water) | writes |
| −25 | `water` + `banks` (vertical skirts to −depth) | writes |
| −22 | `bridge` (deck top, slab sides, parapets, piers) and flyover decks | writes |
| −20 … −14 | `landuse` < `sidewalk` < `kerb` < `asphalt` < `marking` < route line / selection rings | `depthWrite:false`, `polygonOffset(-1, -2·k)`, +0.02 m lift |
| 0 | buildings, structures, props, trees, vehicles, people | normal |
| after | additive glows, beacons, particles | — |
| DOM | HUD canvas, then React | — |

- **Dynamic near plane:** `near = clamp(0.02·D, 0.25, 40)`, `far = fogFar·1.05`. This keeps depth precision fine from 20 m to 6 km without a logarithmic depth buffer (which forces `gl_FragDepth` and hurts Apple GPUs).

## 5. Roads (street-level quality)

- **Ribbon per segment (`roads.ts`).**
  - Miter joins with a limit of 2 × half-width; beyond that, a bevel (with 2–3 extra fan triangles for rounding).
  - Round caps at dead ends.
  - At degree-2 nodes (way splits, class changes), extend each end by w/2. Asphalt is one opaque colour drawn with `depthWrite:false`, so the overlap is invisible.
  - Colour by `surface` (asphalt vs concrete sois vs unpaved) and class.
- **Junctions (`network.ts` + `junctions.ts`, global pre-pass).** For every node of degree ≥ 3:
  1. Get each incident direction from the first polyline vertex at least 2 m away, plus its half-width; sort by angle.
  2. Intersect the left boundary of road i with the right boundary of road i+1 to get corner cᵢ. Setback tᵢ is the projection onto dᵢ. Near-parallel pairs get corner = max half-width and setback 0.
  3. Setback per road = max over both neighbours, plus 0.5 m, clamped to ≤ 0.45 × segment length (protects short slivers). On class ≤ tertiary, enforce a minimum so a zebra crossing fits.
  4. The junction polygon is the ring of trimmed-end corners plus the cᵢ; triangulate as a fan from the node. If the ring self-intersects, use its convex hull.
  - Asphalt ribbons don't strictly need trimming (same colour), but **markings and kerbs are trimmed at setbacks**, so lane lines never cross junctions.
- **Sidewalks and kerbs.** This is the casing trick from the 2D style, in 3D.
  - The sidewalk band (road width + 2 × 1.8 m, per `SIDEWALK_L/R` or class defaults for primary–tertiary) goes in the `sidewalk` layer.
  - A 0.25 m kerb band (light grey; red-and-white stripes within 15 m of junctions in the Old City) goes in the `kerb` layer.
  - Asphalt is drawn after both, so a crossing street's asphalt automatically cuts the gap through the other road's sidewalk.
  - Corner fillets: a small fan between adjacent roads' outer sidewalk edges.
  - Kerbs are flat (painted). At a 50° tilt this reads fine and avoids the geometry mess of raised kerbs at junctions.
- **Markings (`markings.ts`, `marking` layer, u = `dashPhase`).**
  - Two-way roads with ≥ 2 lanes: white dashed centre line (3 m dash, 6 m gap). Trunk/primary: double yellow.
  - More than 2 lanes each way: dashed lane dividers.
  - Class ≤ secondary: solid edge lines.
  - Zebras at junction setbacks on roads with sidewalks.
  - Stop line across the *left* half (left-hand traffic).
  - One-way arrows every ~60 m. These carry over gameplay information the 2D map shows.
  - Distance fade: an attribute flags marking vertices, and the shader mixes toward asphalt as `uCamDist` grows, which kills moiré.
- **Roundabouts.** Detect closed `ROUNDABOUT` loops, fill the island with grass, and place a monument or fountain prop.
- **Bridges (`bridges.ts`).**
  - Water bridges: deck-top geometry at y = 0.02 over the lowered water, 0.8 m slab sides, 1.1 m parapets, piers every 25 m down to the water. Deck styles come from `landmarks3d.ts` (e.g. the Nawarat iron-truss look).
  - The moat causeways are not bridges in OSM; they are just ground between moat polygons.
  - Flyovers: real deck geometry following the elevation profile. Their markings sit in the `marking` batch at deck height, which works because decks draw before decals.
- **Runways and rail.** Runway and taxiway ribbons (45 m / 23 m) with threshold and centreline markings. Rail as ballast ribbon plus two instanced/merged rail lines.

## 6. Buildings, temples, walls, landmarks

- **Extrusion.**
  - Height = `heightDm`, else `levels × 3.2 m`, else a seeded distribution by kind and zone: Old City shophouses 2–3 levels, Nimman 3–8 for apartments/hotels, houses 1–2, temple_viharn 9–14 m to the ridge.
  - Walls: 2 triangles per ring edge with flat normals, and a darker vertex colour at the bottom 0.6 m (fake AO).
- **Roofs (`roofs.ts`).**
  - 4–6 vertex, near-rectangular footprints (fit an oriented bounding box; accept if area / OBB area > 0.85): gable or hip, with the ridge along the long axis; terracotta, blue-grey or corrugated metal by seed.
  - Shophouses and apartments: flat roof with a 0.8 m parapet, plus rooftop water-tank props.
  - Convex footprints with ≤ 8 vertices: pyramid.
  - Everything else: flat.
  - Canopies: posts plus a roof only.
  - Temple viharn: a Lanna 3-tier stepped gable (`lannaRoof.ts`) in red/green tiles with gold edges and chofa finials.
  - No straight skeleton; it isn't worth the complexity.
- **Facade shader** (`materials.ts`, Lambert + `onBeforeCompile`).
  - `aux = (u metres along wall, v metres up, floorHeight, style)`. The fragment shader draws floor bands and window cells.
  - At night, windows glow with `uNight × hash(cell) < litFraction`, where the lit fraction varies with the hour (evening high, 2 am low).
  - Zero extra geometry.
- **Walls and gates (`walls.ts`, `gate.ts`).**
  - City-wall polygons extruded 4.5 m in brick colour with procedural merlons.
  - Tha Phae Gate (the game start) and the other gates as hand-authored low-poly models placed via `landmarks3d.ts` (`id → model, yaw, scale`), keyed to `content/landmarks.json` ids.
- **Temple grounds.**
  - Bake-time `ground` membership restyles contained buildings.
  - `chedi.ts` lathes bell-shaped chedis (white/gold). Hero chedis go at curated landmarks (e.g. the ruined Wat Chedi Luang); small ones are scattered in larger grounds.
  - Plus naga balustrade props and plumeria/bodhi trees.
- **Later polish:** brand-coloured ground-floor bands (98 `brand` tags, such as 7-Eleven).

## 7. Vegetation and props (`scatter.ts`, `InstancePool`)

- **Occupancy raster** per chunk (2 m cells): rasterize buildings, road ribbons plus sidewalks, and water. Scatter only into free cells. Seeds are stable per chunk, so trees never move between sessions.
- **Placement rules.**
  - Bridson Poisson disk: parks r = 9 m, temple grounds 12 m (big rain trees), forest 5 m, campus 10 m.
  - Moat banks: rows at 10 m (iconic).
  - Major-road sidewalks: 15 m spacing.
  - Backyard fill in residential chunks at low density.
  - Palms at the airport and along Superhighway-class roads.
  - Target about 25–35k trees.
- **Tree kinds:** rain tree, mango, palm, bamboo clump, plumeria. Each has a LOD0 geometry (~40–60 triangles, trunk plus 2–3 faceted crown blobs, vertex colour) and a LOD1 (~8–12 triangles). Per-instance hue jitter comes from `variant`.
- **Props:**
  - Street lamps on `LIT`/major roads every 30 m.
  - Power poles on secondary through residential roads every 35 m on one side, with cables as one merged `LineSegments` that fades out beyond 500 m. The tangled wires are very Chiang Mai.
  - Spirit houses, market stalls/umbrellas (market areas, Night Bazaar), parked scooters along sois, traffic lights at junctions where the class is ≤ secondary and degree ≥ 3, bus-stop shelters, parked planes on the apron.
- **`InstancePool`.**
  - Per kind, keep a `Float32Array` of 16 floats per instance per chunk, plus LOD0 and LOD1 `InstancedMesh`es.
  - When the visible/LOD chunk set changes, `TypedArray.set()` the buckets contiguously, set `count`, and `addUpdateRange`. Worst case about 2 MB and ~1 ms, only on change.
  - `frustumCulled = false`; chunk-level culling is already done.

## 8. Dynamic entities

### `VehicleKinematics`

Per-vehicle render state lives in a `Map<id, RenderState>`, **never in `game.state`**.

- **Pose:** `graph.poseAt` at s ± 1.2 m. The front sample follows `route.arcs[routeIdx+1]` and the rear follows `routeIdx−1`. This gives a wheelbase-smoothed yaw through polyline corners.
- **Yaw smoothing** is distance-based, not time-based: `k = 1 − exp(−Δs / 4 m)`. It is therefore identical at 1× and 8×.
- **Lane offset (left-hand traffic):** shift left of travel by `width/4` on two-way roads, and by `width/2 − 1.6 m` on one-way roads. It is evaluated at front and rear, so it eases through junctions.
- **Elevation:** `y = elevation(edge, s)`, which is 0 except on flyovers.
- **De-overlap:** stopped vehicles bucketed by `(arc, round(s / 3.5))` are spread along the kerb, so the tuk-tuks at the Tha Phae Gate rank don't stack.
- **Distance scaling:** the render scale is `max(1, D / 350)`, so vehicles stay legible when zoomed out, as the 2D sprites do. Beyond D ≈ 1,500 m the HUD also draws arrow markers.

### Layers

- **`TukTukLayer`.**
  - One merged tuk-tuk geometry (~500 triangles) with a per-vertex `slot` attribute (0 body, 1 canopy, 2 trim, 3 fixed). Instanced attributes `iBody`, `iCanopy`, `iTrim` come from `PAINTS`, so all liveries render in **1 draw**.
  - The player's tuk-tuk is a separate hero mesh with upgrade accessories (garland, lanterns, LED strip).
  - Seated passenger figures come from `task.trip.request` (archetype colour, party size).
  - Headlight glow sprites fade in with `uNight`.
  - Nearby vehicles cast shadows; others get blob-shadow decals.
- **`TrafficLayer`.**
  - Consumes `registerAmbientSource({ id, agents(game) → {id, kind, arc, s, color} })`. This is the hook for workstream D's sim-side rivals and traffic.
  - If nothing is registered, `CosmeticTraffic` drives about 40 cars, scooters, red songthaews and trucks on random walks along graph arcs within ~800 m of the camera target (respawning at the edge) on game time, exactly like sim vehicles.
  - One draw per kind.
- **`CrowdLayer`.**
  - About 200 cosmetic walkers on sidewalks within ~600 m of the target. Density is weighted by nearby `Place.weight` and the hour: markets, the walking streets and the Night Bazaar get busy.
  - Walkers move at **real-time** walking speed × min(speed step, 2), so they never "sprint" at 8×.
  - Walking and waving animation is done in the vertex shader from an instance phase (no skinning). Shadows are blob decals, so no custom depth material is needed.
  - Waiting passengers come from `game.visibleRequests()`: a figure on the kerb at `place.node`, offset toward `place.(x, y)`, coloured and hatted by archetype (saffron for monks), and waving.

## 9. Camera, input, picking

- **`CameraRig`.**
  - State: `target (x, z)`, distance `D` (18–6,000 m), `yaw` (unconstrained), tilt τ measured from vertical (MapLibre convention).
  - `τ(D) = lerp(50°, 28°, smoothstep(250, 3500, D)) + userTiltOffset`, clamped to [10°, 68°]. The elevation angle at street level is therefore 40°. **Confirm with the user which "50°" was meant.**
  - Vertical FOV 40°.
  - Follow: a critically damped spring (ω ≈ 6/s) toward the *rendered* pose of `followTarget()`, which is the same logic as `MapView`: selected vehicle, else player. Look-ahead is `min(0.25·D, …)` along the yaw.
  - Fog: `near = 1.6·D + 150`, `far = 4.5·D + 600` (≤ 12 km). The target is clamped to the outer bbox.
- **`CameraInput`.**
  - Left-drag: grab-pan (the ground point stays under the cursor); sets `ui.follow = false`, like MapLibre's `dragstart`.
  - Wheel/pinch: exponential zoom, toward the cursor when not following.
  - Right/middle-drag: yaw (horizontal) and tilt (vertical).
  - Right-*click* (under 5 px of movement and under 350 ms): drive here. Touch long-press does the same.
  - Keys: WASD/arrows pan, Q/E rotate, +/− zoom, Home resets north, M toggles the city map. Existing Space/1–5/F/Esc stay in App.tsx. Input is ignored for INPUT/TEXTAREA targets and open modals.
- **`flyTo(x, y, zoom?)`.**
  - 600 ms ease of target (and D via `zoomToDistance(z) = 160·2^(16−z)`, so z16 = 160 m).
  - Follow is suspended only during the flight, which is identical to today's `map.isMoving()` behaviour, so **no UI call sites change**.
- **`Picker`.**
  - `groundAt(px, py)`: `Raycaster.setFromCamera` ∩ plane y = 0 → `(x, −z)`.
  - `pick()`: the same priority as `MapView.onClick` — requests, then vehicles, within 20 CSS px of the HUD anchors (passenger badge; vehicle roof at y = 1.2 m); then landmark HUD icon rects; then the ground hit to the nearest `Place` within `max(40 m, 25 px in metres)`.
  - Hover uses the same code on `mousemove`, for the cursor.

## 10. Overlays: route, markers, labels

- **`RouteLine`.**
  - A ribbon along `route.arcs[routeIdx…]` with the same lane offset as the kinematics. Width = `max(2.2 m, 0.006·D)`. Pink for the player, blue for a selected vehicle (as in 2D).
  - Rebuilt only when `(route identity, routeIdx, width band)` changes. Per frame only `uStartS` updates, clipping the travelled part via fragment discard, plus scrolling chevrons.
  - Drawn in the decal stack, so buildings occlude it. When D > 1,200, a second pass at 35 % opacity with `depthTest:false` keeps it readable through buildings.
- **`Markers3D`.**
  - Pulsing selection and player rings (decals).
  - Destination beacon: an additive 60 m light pillar in the archetype colour.
  - Selected-request arc: a dashed parabola from pickup to destination, apex at 0.15 × distance.
  - `showTurnChoices(arcs)`: clickable road arrows for workstream E's manual-driving mode.
- **`HudCanvas`.**
  - A 2D canvas above the WebGL canvas (reuses the `.map-overlay` CSS: `pointer-events: none`, z 2).
  - Ports `drawPassenger` (patience ring, party badge, fare), `drawDestinationPin`, `statusIcon`, and landmark emoji badges and names, using `sprites.ts`, which has no MapLibre dependency.
  - Badge size is `clamp(40 − D/100, 24, 40)` px. Greedy declutter by rank every 100 ms. HUD DPR is capped at 1.5.
  - **Painter compatibility:** `OVERLAY_PAINTERS` are called with `PaintContext { zoom: distanceToZoom(D), toScreen: project(x, 0, −y) }`. Existing painters from other workstreams (weather, rivals) keep working.

## 11. Lighting, shadows, sky, night

- **`sun.ts`.** NOAA-simplified solar elevation and azimuth for 18.79 N / 98.98 E from `calendar(time)` (day of year for declination, local time with a 105° E meridian correction). It is consistent with `daylight()` (November sunrise 6.4 h, sunset 17.85 h). A moon direction is added for night.
- **`LightingRig.update(cal)`** publishes an `EnvState`:
  - `{ sunDir, sunElevation, night 0..1, sunColor, hemiSky, hemiGround, fogColor, exposure, haze, rain }`.
  - `HemisphereLight` plus a sun `DirectionalLight`, warm at golden hour. At night, a dim bluish moon without shadows, and the shadow pass is skipped.
  - `NeutralToneMapping`, sRGB output.
- **Shadows.**
  - One directional shadow map: Medium 2048², High 4096², Low 1024² (near only).
  - Orthographic box centred on the camera target with half-extent `clamp(1.1·D, 60, 900)` m, **texel-snapped in light space** so it doesn't shimmer.
  - `PCFShadowMap`, a small `bias`, and `normalBias` ≈ 0.6 texel (normals are shipped for this reason).
  - Casters: building and structure batches, trees LOD0, near vehicles. Receivers: ground base, decals, buildings.
  - Off when D > 2,500 (the fake-AO gradient carries depth) and when the sun is down.
- **`Sky` / `Atmosphere`.**
  - Gradient dome (zenith, horizon, haze) with a sun glow and stars at night. Fog colour is the horizon colour.
  - `setWeather({ haze, rain, cloud })` is the hook for workstream D: smoky-season brown haze raises fog density, and rain uses camera-attached instanced streaks.
  - A low-poly Doi Suthep silhouette to the west as a backdrop.
- **`NightLights`.** No dynamic point lights.
  - Instanced additive light-pool decals under lamps, which fade with `uNight`.
  - Headlight cones.
  - Window emissive through the facade shader.
  - Gold floodlit temple roofs (`uNight` boost on temple vertex colours).
  - Bloom is optional on High only; MSAA 4× on the default framebuffer.

## 12. UI integration

- **`GameLoop` (`src/loop.ts`).** Each frame: `game.update(dt)` → `view.frame(now, dt)`, which runs camera input integration, entity sync, camera follow on rendered poses, env update, render, then the HUD. `MapView` loses its internal `game.update` and becomes a `FrameView`. `game.on('frame')` and `bindGameTicks` are unchanged.
- **`GameView` (`src/ui/view.ts`).**
  ```ts
  export interface GameView { readonly kind: '3d' | 'map'; flyTo(x: number, y: number, zoom?: number): void;
    toScreen(x: number, y: number): { x: number; y: number } | null; destroy(): void }
  ```
  Swap the `MapView` type for `GameView` in `App.tsx`, `panels.tsx` (`PanelProps`) and `overlays.tsx` (`OverlayProps`). `view?.flyTo` call sites in other workstreams' panels stay compatible.
- **DOM layout.** `<div class="world">` contains `canvas.world-gl` (z 1) and `canvas.world-hud` (z 2, no pointer events). The existing React HUD sits on top unchanged: TopBar, `.left-stack`, `.panel`, toasts and HaggleDialog at z ≥ 8. Input listeners attach to the GL canvas only, so wheel and drag over panels never move the camera. New overlays (compass, city-map toggle, quality menu) register via `OVERLAYS`.
- **Store.** Add `viewMode: '3d' | 'map'` to `UIState`; it is UI-only and never saved.
  - `selectedVehicle` → follow target and blue ring.
  - `selectedRequest` → highlighted badge, arc and beacon.
  - `selectedPlace` → a ground ring at the place.
  - `follow` → `CameraRig` follow flag.
- **Lifecycle under StrictMode and HMR.**
  - `World3DView.destroy()`: cancel rAF, `renderer.dispose()`, `forceContextLoss()`, dispose materials and batches, and remove listeners.
  - The built city (worker output) lives in a module-level cache in `loadCity.ts`, so a remount or quit-to-title doesn't rebuild.
  - While `viewMode = 'map'`, the 3D view is kept but not rendered.
- **MapLibre "City map".**
  - Lazy `import()` so it drops out of the initial bundle (~800 KB). A full-screen swap via M or 🗺.
  - Useful for full-bbox planning (zones, depots, Doi Suthep), street labels and one-way arrows.
  - No new features for it; revisit dropping it once the 3D overview is good.

## 13. Performance budget

| Metric | Follow cam (D 120–400 m) | Overview (D 3–5 km) |
|---|---|---|
| Main-pass draw calls | ≤ 120 (expected ~50) | ≤ 200 |
| Shadow-pass draw calls | ≤ 40 | 0–25 |
| Triangles, main pass | ≤ 0.8 M | ≤ 1.5 M |
| CPU render (sync + cull + submit + HUD) | ≤ 4 ms | ≤ 5 ms |
| GPU | ≤ 10 ms on M1 at DPR 1.5, MSAA 4× | same |
| Sim at 8× with 50+ tuk-tuks | ≤ 3 ms (sim-owned; measured separately) | — |
| Geometry memory | ≤ 80 MB | — |
| Texture memory | ≤ 40 MB (shadow map dominates; no other large textures) | — |
| JS heap for city | ≤ 120 MB after build (worker terminated) | — |

**Expected content totals:**

| Content | Triangles |
|---|---|
| Buildings LOD0 | ~350k |
| Ground decals | ~250k |
| Base, landuse, water | ~60k |
| Trees | 30k × (48 LOD0 / 10 LOD1) |
| Props | near only |
| Dynamic: 60 tuk-tuks, 40 ambient, 200 people | ~70k |

**Draw calls (multi-draw path):**

| Group | Draws |
|---|---|
| Static batches | about 11 (one per layer) |
| Tree LOD pools | 10 |
| Prop pools | ~8 |
| Tuk-tuk / hero / traffic / people | ~10 |
| Glows, route, markers, sky | ~8 |

**Instanced vs merged:**
- **Merged (BatchedMesh):** all ground layers, water, banks, bridges, buildings (walls and roofs), structures (walls, gates, chedis, heroes). Wires are one `LineSegments`.
- **Instanced static (`InstancePool`):** trees, lamps, poles, stalls, spirit houses, parked scooters, traffic lights, planes, light pools.
- **Instanced dynamic (written into `instanceMatrix` each frame, no `Object3D` per entity):** tuk-tuks, ambient vehicles, walkers, seated/waiting passengers, headlights, blob shadows.
- **Unique:** hero tuk-tuk, route line, beacons, sky, Doi Suthep.

**Quality presets:**
- Low: DPR 1, no MSAA, 1024² shadows, 50 % trees, 80 walkers.
- Medium (default): DPR ≤ 1.5, MSAA, 2048² shadows.
- High: DPR 2, 4096² shadows, bloom.
- The adaptive governor steps DPR down when p50 > 18 ms over 2 s, and up after 5 s under 12 ms.

## 14. Parallel workstreams and interfaces

### Phase 0 (one agent, first; unblocks everyone)

- Add dependencies.
- `coords.ts`, `loop.ts`, `ui/view.ts` refactor.
- `World3DView` skeleton: renderer, `CameraRig`/`CameraInput`, `Picker`, ground plane, box tuk-tuks at kinematic poses, and a `HudCanvas` port. The game is playable in 3D with placeholder visuals.
- **Type-only contracts:**
  - `data/cityFormat.ts` (the `CityData` SoA types above plus `decodeCity`).
  - `build/types.ts` (`StaticLayerId`, `PropKind`, `PackedMesh`, `ChunkOutput`, and the `FeatureBuilder` / `BuildContext` / `ChunkWriter` below).
  - `core/layers.ts`.
  - `env` `EnvState`.
  - `entities/sources.ts`.
- A stub bake with buildings and roads only. Worker plumbing. `StaticWorld` with `ChunkBatch`.

```ts
interface BuildContext { city: CityData; network: RoadNetwork3D; grid: SpatialIndex;
  occupancy(cx: number, cz: number): OccupancyRaster; rng(seed: number): () => number; palette: Palette3D }
interface FeatureBuilder { id: string; prepare?(ctx: BuildContext): void;
  build(ctx: BuildContext, chunk: { cx: number; cz: number; key: number }, out: ChunkWriter): void }
interface ChunkWriter { mesh(layer: StaticLayerId, lod?: 0 | 1): MeshWriter;
  instance(kind: PropKind, x: number, z: number, yaw: number, scale: number, variant: number): void }
interface WorldLayer { readonly id: string; attach(scene: Scene, init: LayerInit): void | Promise<void>;
  update(f: FrameContext): void; dispose(): void }
interface FrameContext { game: Game; now: number; dt: number; camera: PerspectiveCamera; rig: CameraRigState;
  cal: CalendarInfo; env: EnvState; ui: UIState; quality: QualitySettings; uniforms: SharedUniforms }
```

### Phase 1 (parallel; each workstream owns its files)

Shared registries (`build/builders.ts`, the layer list in `World3DView`) are append-only one-liners.

| WS | Scope | Owns |
|---|---|---|
| 1 Data/bake | full semantics, bridge classification, flyover profiles, graph deep-equal guard, `DATA_RAW` env var | `scripts/lib/*`, `build-city3d.mjs`, `data/*`, bake tests |
| 2 Roads & ground | network/junctions, ribbons, sidewalks/kerbs, markings, areas, water/banks, bridges, outskirts, decal materials | `build/{network,roads,junctions,markings,sidewalks,areas,water,bridges,outskirts}.ts` |
| 3 Buildings & temples | extrusion, roofs, facade shader, walls/gates, chedis, `landmarks3d` heroes | `build/{buildings,roofs,walls,landmarks3d}.ts`, `models/{chedi,gate,lannaRoof}.ts` |
| 4 Vegetation & props | occupancy raster, scatter rules, tree/prop models, `InstancePool` | `build/scatter.ts`, `build/spatial.ts`, `models/{trees,props}.ts`, `static/InstancePool.ts` |
| 5 Vehicles & people | kinematics, tuk-tuk paint-slot shader, hero mesh, traffic, crowd, cosmetic sims, ambient source hook | `entities/*`, `models/{tuktuk,car,scooter,songthaew,truck,person}.ts` |
| 6 Lighting & effects | sun, rig, shadow fitting, sky, fog/weather hooks, night lights, quality governor, FrameStats, bench | `env/*`, `core/{Quality,FrameStats}.ts`, `dev/bench.ts` |
| 7 UI & camera | camera feel, touch, `HudCanvas`/labels, `RouteLine`, `Markers3D`, city-map toggle, loading progress, overlays | `camera/*`, `overlay/*`, `picking/*`, `ui/*` edits |

### Phase 2 (integration)

Performance pass against the budget, the outskirts terrain (below), visual QA bookmarks, and docs.

Updating `CLAUDE.md` needs the user's explicit approval; a hook blocks edits otherwise. `docs/design.md` can be updated normally.

## 15. Risks and verification

1. **Time compression (the biggest design risk).** At 1× a tuk-tuk covers about 330 m per real second (30 game s/s × ~11 m/s); at 8×, about 2.6 km/s. At a street-level follow distance the world will blur past.
   - **Mitigations on the rendering side:** default follow distance of ~250–400 m at 1×, rising automatically with the speed step; distance-based smoothing (not time-based); real-time walkers.
   - **Needs a lead/user decision:** consider a slower "street" speed step (e.g. 4–6 game s/s) whenever the camera is close, or accept a timelapse aesthetic.
2. **Vehicles leaving the central area.** The graph is the full bbox, and Doi Suthep rides are in progress in workstream B.
   - The `outskirts` builder draws all remaining graph edges as plain ribbons over land and fog.
   - Phase 2: a procedural Doi Suthep heightfield `h(x, y)` used both for the mountain mesh and for draped outskirts roads and vehicle y.
   - Alternatively, have the sim restrict demand to the central area. This needs coordination.
3. **Save compatibility.** The bake never writes `graph.json`, and a test asserts it is unchanged (hash).
4. **BatchedMesh / multi-draw support on Safari, and custom shaders.**
   - Verify `WEBGL_multi_draw` at runtime; `ChunkBatch` falls back to 1 km super-chunk Meshes.
   - Materials use `onBeforeCompile` on built-ins only. Vertex-animated instanced people don't cast real shadows (blob decals instead).
5. **Junction robustness on messy OSM** (dual carriageways, sub-2 m slivers, link roads, roundabouts). Setbacks are clamped with a convex-hull fallback, same-colour asphalt hides overlap, and markings are trimmed conservatively. A test counts invalid junction polygons (should be under 1 %).
6. **Z-fighting at overview.** The ground-stack render order, polygon offset and dynamic near plane handle it. Check with visual bookmarks at D = 5 km.
7. **Fill rate at DPR 2 with MSAA and shadows on older or Intel Macs.** Adaptive DPR and presets. Shadows off at far distances and at night.
8. **WebGL context leaks** from StrictMode/HMR and quit-to-title. Strict dispose, a module-level city cache, and a test that `renderer.info.memory` returns to baseline after quit → continue.
9. **Worker build time and memory.** Nearest-first progressive posting, Transferables, the build starting during the title screen, optional IndexedDB cache.
10. **HUD clutter** with 50+ tuk-tuks and ~100 requests at overview. Distance-based culling of status icons (the player's always shows), declutter, and clustered badges.
11. **TS 7 with @types/three.** Typecheck in Phase 0 before the other workstreams start.

### Verification

- **FrameStats** (`?stats` or the backtick key): rolling 120-frame p50/p95/max frame interval; `simMs` measured around `game.update`, and `syncMs` / `renderMs` around layer updates and `renderer.render`.
  - Set `renderer.info.autoReset = false` and reset per frame, so calls and triangles include the shadow and main passes together.
  - Also report `info.memory` (geometries, textures), programs count, DPR, visible chunks and instance counts.
- **`window.__world3d`** in dev (renderer, rig, stats, bench).
- **`__world3d.bench({ tuktuks: 60, speed: 5, seconds: 30 })`** (dev only): spawns fleet vehicles through sim APIs, runs a scripted path (street follow through the Old City → Nimman → zoom to overview → 8×), and returns a JSON summary (p50/p95 frame ms, max calls, max triangles).
  - Agents can run it in the browser preview via `javascript_tool`.
  - **Acceptance must be on the user's MacBook** in Chrome and Safari (`?bench`), because the preview's GPU isn't representative.
- **Camera bookmarks** `?cam=tha_phae|nimman|night_bazaar|nawarat|airport|overview` for screenshot comparisons.
- **Vitest (node):**
  - Bake: decoded origin equals the graph origin; the attribute table length equals the edge count; every `graphEdge` is valid.
  - Build: runs on real data; no NaN; indices in range; triangle totals within budget; deterministic (two builds hash identically); logged timing.
  - Kinematics: yaw continuous through corners; offset on the left side; elevation 0 away from flyovers.
  - Coords round-trip.
- **Frame debugging:** Spector.js browser extension, no dependency.

### Critical Files for Implementation
- /Users/jason/coderepos/tuktuk/src/map/MapView.ts (game loop to extract, draw/pick logic to port into `HudCanvas`/`Picker`)
- /Users/jason/coderepos/tuktuk/src/ui/App.tsx (view creation, `GameView` swap, DOM layering; plus `src/ui/panels.tsx`, `src/ui/overlays.tsx`, `src/ui/store.ts`)
- /Users/jason/coderepos/tuktuk/scripts/build-map.mjs (`buildGraph` / `simplify` / `classOf` to extract into `scripts/lib/` for the new `scripts/build-city3d.mjs` without changing `graph.json`)
- /Users/jason/coderepos/tuktuk/src/sim/graph.ts (`poseAt`, edge polylines, projection: the basis for kinematics, route line, roads)
- /Users/jason/coderepos/tuktuk/src/map/painters.ts (plus `src/map/sprites.ts`: `PaintContext` compatibility and reusable HUD sprites)
