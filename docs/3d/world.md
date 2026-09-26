# World content and art direction for Tuk-Tuk Tycoon's 3D central Chiang Mai (lon 98.950–99.020, lat 18.762–18.808)

> Reference design report behind [docs/plan-3d.md](../plan-3d.md), the approved plan. Where they differ, plan-3d.md wins: the playable area shrinks to the central box with edge portals and save format v2 (so graph.json is rebuilt), the driving clock is 4 game s per real s, and saves start fresh.

## 0. Findings, assumptions and conventions

### What the data already gives us
I measured the existing `data-raw/` extracts inside the core bbox.

**Buildings (`data-raw/buildings.json`)**
- 18,844 footprints.
- The raw file already holds every tag, because the fetch uses `out geom`. `build-map.mjs` then throws them away: `buildingsLayer` keeps only `building:levels` above 1.
- 821 footprints have `building:levels`. Only 660 survive into `public/data`, because levels = 1 is dropped.
- `building` values: 17,498 are `yes`, 331 `apartments`, 297 `house`, 138 `roof` (open canopies on posts), 89 `retail`, 56 `school`, 47 `hotel`, 18 `temple`.
- Other useful tags:
  - `name` on 1,503.
  - `amenity` on 475, `tourism` on 463 (210 hotels, 178 guesthouses, 46 hostels), `shop` on 222.
  - `man_made=stupa|tower` on 24 (these include chedis), `roof:shape` on 26, `height` on 50, `building:colour` on 14.
- Median footprint is 146 m². The 90th percentile is 610 m² and the 99th is 1,986 m².
- Tagged storeys by district (median / 90th percentile): Old City 2/4, Nimman 3/8, Wat Ket 2/6, Wua Lai 2/3.
- Footprint width (median of the minimum bounding box) is about 8.5 m in the Old City and Wua Lai, but 12–13 m in Nimman, Night Bazaar and Wat Ket. So shophouse rows are often mapped as one polygon covering several bays.

**Temple grounds**
- There are 88 Buddhist `place_of_worship` grounds, holding 712 building footprints (median 7 per temple).
- Halls are almost all aligned east–west (long axis within about 5° of east–west).
- Chedis show up as near-square footprints with many vertices. Examples:
  - Wat Phan Tao: 17.3 × 17.2 m, 19 vertices, `tower:type=pagoda`.
  - Wat Chedi Luang: 58.5 × 57.4 m, `man_made=stupa`, `building:colour=#B79F7B`.
  - Wat Phra Singh: 22.5 × 22.4 m.
- Schools often sit inside temple grounds (Wat Phra Singh, Wat Sri Suphan). They must not become viharns.

**Moat, walls, runway**
- The moat is 19 water polygons, averaging about 16 m wide (12–20 m). They are already split at the road crossings, so the causeways come for free.
- Walls: 14 `barrier=city_wall` ways. Four are bastion areas and two are Suan Dok Gate.
- Runway 18/36 is 3,098 m long at lon 98.9628, running lat 18.753–18.781, so about two-thirds of it is inside the bbox.

**Roads (5,727 ways in the bbox)**
- `lanes` on 3,201, `surface` on 4,194, `sidewalk*` on about 640, `width` on 68, `bridge` on 114, `lit` on 647.

**Counts from the Overpass mirror (bbox only, not yet fetched)**
- 1,252 `natural=tree` nodes and 98 `tree_row` ways.
- 0 street lamps, and only 13 power poles and 10 power lines. Street furniture must therefore be procedural.
- 140 `barrier=wall` and 61 fences.
- 62 building multipolygon relations, which the current fetch does not get at all.
- 17 `building:part`, 3 `man_made=bridge`, 16 fountains, 81 swimming pools, 142 `landuse` residential/commercial/retail areas, 112 traffic signals, 1,319 footways/paths.

### Camera caveat: Doi Suthep is not visible at 50° pitch
- In MapLibre terms, 50° pitch means the view axis is 40° below the horizon. With a 37–45° vertical field of view, the top of the screen still looks about 18–22° below the horizon.
- The mountain rises about 9–10° above the horizon from the city.
- So in normal play you will not see Doi Suthep or the sky.
- Recommended fix: a pitch-by-zoom curve. Keep 50° by default, and ease to about 65–68° at the closest zoom so the horizon enters the top of the frame. Also use the backdrop in the title screen, dawn/dusk "establishing" shots and photo mode.
- Put fog and a horizon haze band at the far plane so the city edge never looks cut off.

### Conventions for all implementing agents
- **Units and axes:** metres. World X = sim x (east), world Z = −sim y (north is −Z), Y is up. Use the same origin as `graph.projection` / `ORIGIN` in `scripts/build-map.mjs`.
- **Randomness:** always `hash32(osmId, salt)`, so the world is identical on every load and every build.
- **Style:**
  - Flat-shaded, vertex-coloured geometry.
  - One procedurally generated texture atlas is allowed (a `CanvasTexture` built at startup). It holds sign glyphs, shutter ribs and lattice patterns. No downloaded models or textures.
  - Bake "AO and grime" into vertex colours: darken the bottom 0.6 m of walls, the underside of eaves, and add streaks under sills.
- **Source labels in content files:** `[research]` (from `docs/research`), `[osm]`, `[est]` (an art estimate), plus the existing `[pacing]`.
- **Renderer independence:** geometry generators should be pure functions that return typed arrays (positions, flat normals, colours, plus an optional `emissive` and `sway` attribute each). Then they run in Web Workers and in Vitest, and a thin adapter wraps them as Three.js `BufferGeometry`. This keeps the three workstreams independent of the renderer choice.

---

## 1. What makes central Chiang Mai recognisable, in priority order

### 1.1 From the 50° follow camera (macro signals)
1. **The moat square.** About 1.5 km per side (landmarks.md). A 16–18 m teal-green water channel sunk below the road, lined with big trees. Brick bastions sit at the corners and five gates on the sides. Traffic runs one way: anticlockwise on the inner roads, clockwise on the outer (culture.md §2).
2. **Temple roofs and chedi spires above low-rise fabric.** Orange/red layered Lanna roofs and gold or white bell spires. Nearly every Old City block has one.
3. **Wat Chedi Luang's ruined brick mass** at the centre. It is roughly 55 m tall on a roughly 58 m square footprint.
4. **A sea of 2–4 storey flat-roofed shophouses.**
   - Rooftop water tanks, roof sheds, satellite dishes, laundry.
   - Tangled black cable bundles on concrete poles, except where the cables are buried (see §2.7).
   - Height caps: 12 m in many zones and 9 m within 100 m of a temple (Citylife, "In the zone"). Overhead, it should look very flat.
5. **Traffic mix.** Swarms of scooters, many red songthaews, white pickups and vans, and the occasional blue/black tuk-tuk.
6. **Green canopy.**
   - Rain trees, bodhi, banyan, sugar palms and teak along the moat. A study of moat trees names *Ficus religiosa, Albizia saman, Ficus altissima, Dipterocarpus alatus, Tectona grandis, Borassus flabellifer* and *Corypha lecomtei*.
   - Bougainvillea spilling over walls.
7. **East side.**
   - The Ping River with its bridges.
   - Warorot's concrete market blocks and Chinatown shophouses.
   - Riverside restaurant decks.
   - Wat Ket's low teak houses.
8. **Nimman contrast.** 5–16 storey condos (the tallest is 32 storeys at Supalai Monte, at the NE edge). Glass cafés with gardens, the MAYA cube, One Nimman's red-brick clock tower.
9. **Night markets** as glowing strips: Chang Klan Night Bazaar every night, and the walking streets on Sunday (Ratchadamnoen) and Saturday (Wua Lai), 17:00–23:00 (landmarks.md).
10. **The airport.** A 3.1 km runway at the SW edge, with jets passing low over Suan Dok and Nimman (culture.md notes the flight-path noise).
11. **Doi Suthep** on the western horizon, with the temple's gold glint (only when visible, see §0).
12. **Street-level texture.** Spirit houses, motorbikes parked at 45°, Thai-script signboards, food carts under big parasols, red/white kerb paint.

**Avoid Bangkok and generic clichés:**
- No skyline towers in the Old City, no elevated rail or expressways, no pink taxis.
- Chiang Mai meter taxis are yellow/blue (cooperative) or red/yellow (private) (culture.md §7).
- Tuk-tuk canopies are black vinyl.
- Lanna roofs sweep low; they are not tall Bangkok stacks.
- No real brands or logos, and no royal portraits (culture.md etiquette).

### 1.2 Built fabric typologies

| Typology | Where | Form [est] unless cited | Colours / details |
|---|---|---|---|
| **Concrete shophouse row** (the dominant type) | Old City, Tha Phae, Chang Klan, Chinatown, Wua Lai, Santitham, Chang Phueak | Bays 3.6–4.6 m wide (4 m is the Thai module), 10–25 m deep. Ground floor 3.8–4.2 m, upper floors 3.1 m, 2–4 storeys. Flat roof with a 0.8–1.2 m parapet. | Faded pastels over concrete. Ground floor is fully open behind a roll-up steel shutter or an accordion grille (mint/blue). Sign band above the ground floor, a different colour per bay. Canvas or corrugated awnings 1.5–2.5 m deep. Upper floors: aluminium windows, "egg-crate" concrete sunshades, ornamental steel grilles on windows and balconies, AC units hung on the façade, potted plants, laundry. Rooftop: steel or blue plastic water tanks on stands, a partial tin shed, rebar stubs. |
| **Old wooden / colonial shophouse** | Tha Phae Rd, Chang Moi/Warorot, Wat Ket | 2 storeys. Teak upper floor with folding wooden shutters. Low-pitched tin or tile gable parallel to the street. A few 1920s stucco fronts with arches. | Teak #6b4428, faded green/blue shutters, rusty roofs. |
| **Lanna teak house** | Wat Ket, Wua Lai/Hai Ya, hotel compounds (137 Pillars, Tamarind Village) | Raised on posts. Steep gable with V-shaped *kalae* crossed at the gable tops (culture.md §10). | Dark teak, terracotta or grey shingles. |
| **Modern Thai detached house** | Suburban edges, soi interiors | 1–2 storeys, hip roof with 0.8–1.2 m eaves, carport, wall with gate. | Cream/white walls. Roof tiles in terracotta, dark grey, brown, blue-grey or green. |
| **Condo / hotel mid-rise** | Nimman, Chang Klan, Santitham, Suan Dok | 5–16 floors on 600–2,500 m² footprints. Slab edges expressed, glass balcony bands, a lift box on the roof. Rooftop pools (81 pools in OSM). | White/grey/beige, dark glass, timber-look slats. |
| **Nimman boutique / café** | Nimman sois | 2–4 storeys. Big glass fronts, raw concrete, black steel, timber slats, planting, outdoor decks. | Neutral with lots of green. |
| **Market hall / open roof** | Warorot, Somphet, Chiang Mai Gate, Muang Mai; the 138 `building=roof` | Big gable metal roof on posts, often with a clerestory. | Zinc grey, blue, rust. |
| **Institutional** | Hospitals (tagged up to 15 floors), schools (inside temple grounds too), CMU/Rajabhat | Long blocks with a corridor balcony down one side. Hip roofs in orange tile. | Cream/yellow schools, white hospitals with teal glass. |

### 1.3 Lanna temples: the parts to model
- **Viharn (assembly hall)**
  - On a 0.8–1.5 m white plinth with front steps flanked by naga balustrades.
  - Low walls of 3–4 m in white stucco or teak.
  - The roof is the identity of the building: 2–3 overlapping tiers stepping down toward the entrance, and 2 vertical eave layers. The lower eave sweeps down to about 2.5 m above the plinth. Pitch 40–45°, ridge height about 0.9–1.1 × the width.
  - Ornaments: a gold *chofa* finial at each gable apex; gold serpentine naga bargeboards down the gable edges ending in naga heads (*hang hong*); a gold/red lacquered gable face; a porch roof on 2–4 red and gold columns.
  - Lanna roofs sweep lower than Central Thai roofs, and teak is used widely (thaitemplearchive; Wikipedia, Thai temple art).
  - Typical size 25–40 × 10–15 m. Wat Phra Singh's Viharn Luang is 56 × 24 m.
- **Ubosot (ordination hall).** Usually smaller than the viharn, with fewer ornaments. Eight *bai sema* boundary stones around it (Wikipedia).
- **Chedi**, in four types:
  1. *Bell* (Sri Lankan-derived): stepped square base, round mouldings, bell dome, square box, ringed spire, gold umbrella finial.
  2. *Lanna redented square*: tall stepped base with notched corners, octagonal drum, small bell, tall spire.
  3. *Octagonal*.
  4. *Ruined bare brick* (Wat Chedi Luang, Wat Lok Molee).

  Finishes: white body with gold spire (the most common), all gold, weathered grey-white, or bare brick. Companion pieces: 4 small corner chedis, white/gold tiered parasols, lion (*singha*) guardians, a railing.
- **Ho trai (library).** Small, on a tall white base, with a lacquered red and gold upper storey (Wat Phra Singh's is the model).
- **Also:** a bell tower (*ho rakhang*), open *sala* pavilions, *kuti* (monks' quarters, which look like plain houses), and a temple school.
- **Compound wall.** 1.8–2.2 m, whitewashed, with lotus-bud posts. A Lanna stucco arch gate (about 4 m wide and 6–7 m tall) on the street side, paired white-and-gold singha lions.
- **Ground.** Pale sand or paving. A bodhi tree hung with coloured sashes and propped with wooden sticks. Tung flags on poles. Frangipani. Parked scooters.

### 1.4 Moat, walls, gates, bastions
- **Moat**
  - Water surface about 1.6 m below the road. Vertical brick or concrete bank walls, a 0.5 m parapet or railing, a grassy strip with trees.
  - Fountain jets every 80–120 m, plus fountain arrays at the four corners ("fountains all along the moat… added at the four ancient corners").
  - Causeways at every road crossing: the gaps in the OSM water polygons.
- **Walls**
  - About 4.6 m high ("15 feet", chiangmai1 via search summary); model 4.5–5.5 m plus 0.9 m merlons. Battered brick, thicker at the base.
  - Only remnants survive, mostly near the gates and corners.
  - The 2018/19 restoration used new brick, so restored parts are visibly brighter orange.
  - The bastions are the most original surviving parts. Put trees on top of them.
- **Tha Phae Gate**
  - Rebuilt 1985–87 (culture.md).
  - Orange-red brick walls on either side of an opening with grey, water-stained timber doors. It is the only gate that still has wooden doors (Wikipedia).
  - A large paved plaza to the east with pigeons. This is the main tuk-tuk rank and the festival stage.
  - The other gates are traffic islands, with roads passing through gaps in the wall.

### 1.5 River, bridges, markets
- **Ping River**
  - Muddy olive in the dry season, brown in the rains. Sloped vegetated banks.
  - Flood gauge at Nawarat. A +3.7 m flood threshold is a later hook (calendar.md).
- **Nawarat Bridge.** The main concrete road bridge on piers.
- **Iron Bridge (Khua Lek).** A dark steel Parker through truss with a curved top chord and 7 panels (HistoricBridges; the date of the current structure is unverified). One way eastbound from Loi Kroh, with walkways on both sides (OSM tags it `bridge=trestle`).
- **Warorot (Kad Luang).** A 3-storey concrete market, opened 1972, designed by An Nimmanhaemin. Food on the ground floor, clothes above.
  - Around it: Chinese shophouses with red lanterns, Ton Lamyai flower stalls (open 24 hours), and songthaew queues by colour: blue to Lamphun, green to Mae Jo, white/yellow to other towns (culture.md §7).
- **Night Bazaar**
  - Continuous stalls along the Chang Klan sidewalks between Tha Phae Rd and Sridonchai Rd from about 17:00. Plus the Kalare and Anusarn courts.
  - Loi Kroh bar neon and the boxing stadiums.
- **Walking streets.** Three rows of stalls (both kerbs plus a centre row), lines of lights, dense crowds, and temple courtyards used as food courts.

### 1.6 Street furniture and street life
- **Power poles**
  - Square concrete poles 9–12 m tall, every 30–40 m, on one side of the road.
  - Crossarms with insulators, a transformer platform on some pole pairs, and a sagging black telecom bundle at 5–6 m with coiled slack loops.
  - Not on buried-cable roads. Around the moat and along Tha Phae / Chang Klan, place green PEA ground cabinets instead ("wireless city", 200+ control boxes).
- **Street lamps.** Galvanised arm lamps (sodium orange or white LED) on arterial roads. Dark heritage lanterns on the moat promenade, Tha Phae Rd, Ratchadamnoen and Nimman.
- **Spirit houses (*san phra phum*).** A miniature gilded temple house on a 1.5 m pillar, in the front corner of about 40% of commercial plots. Garlands and generic red soda bottles as offerings. Larger four-post versions at hotels and malls.
- **Parked motorbikes.** Rows at 45–60° in front of shops, markets and temple gates.
- **Food carts.** Glass-cased carts, red and blue plastic stools, big parasols, gas bottles.
- **Convenience stores.** Unbranded. A white glare shopfront with a fictional fascia (for example teal and yellow "24 ชม."). Never 7-Eleven's stripes.
- **On the street:**
  - Traffic lights with red countdown digits (112 OSM signals).
  - Red/white and yellow/white kerb paint.
  - Sala-style bus shelters, Thai and Buddhist flags, green/yellow bins, pigeons at Tha Phae Gate, soi dogs.

### 1.7 Vegetation

| Species | Look [est] | Where |
|---|---|---|
| Rain tree | Umbrella crown 15–25 m wide, 15–20 m tall | Moat, parks, big roads, temples |
| Bodhi | Broad crown, cloth sashes, wooden props | One per temple, also by the moat |
| Banyan (*Ficus altissima*) | Dense crown, hanging roots | Moat, parks |
| Yang na (*Dipterocarpus*) | 30–40 m straight grey trunk, small top crown | Three beside the city-pillar shrine at Wat Chedi Luang; a few by the moat |
| Teak | Large leaves, mid height | Moat, compounds |
| Sugar palm / coconut / royal palm / fishtail / areca | Fan-crown single trunk / curved trunk / tall grey column / clumps | Moat, riverside yards, institutions, hotels |
| Bougainvillea, frangipani, golden shower, flame tree, pink trumpet, tamarind, mango, banana, bamboo | Seasonal colour and yard trees | Walls, temples, hotels, yards, canals |

- Seasons:
  - Dry season (Feb–Apr): yellower grass, some bare crowns.
  - Rains: saturated green.
  - Tabebuia pink in Feb–Mar, golden shower in Mar–May.

### 1.8 Horizon and airport
- **Doi Suthep backdrop**
  - Summit 1,676 m, Doi Pui 1,685 m; the temple at about 1,060 m (Wikipedia); the city at about 310 m [est].
  - Temple position 18.80492, 98.92210 (landmarks.md).
  - Forested blue-green, softened by atmospheric fog. The gold chedi is a small gold emissive point with a specular glint in the morning. At night, a light spot plus a string of lights up Huay Kaew / Sri Wichai Rd.
  - Hidden completely in haze season.
- **Airport**
  - Runway 18/36, 3,100 × 45 m asphalt (Wikipedia). Piano-key thresholds, "18"/"36" numbers, centreline dashes.
  - Taxiways with yellow lines, a concrete apron.
  - A long 2-storey terminal (OSM way 58309446) with a dark Lanna-inspired roof, 4–8 jet bridges, a control tower [est].
  - 6–10 parked narrow-body jets in fictional liveries. Occasional arrivals and departures.

---

## 2. Procedural generation rules from OSM

### 2.1 What to fetch
Add a `world3d` query set to `scripts/fetch-osm.mjs` for the **core bbox only** (`18.762,98.950,18.808,99.020`). Keep the existing game-bbox queries untouched.

| File | Query | Tags to keep |
|---|---|---|
| `buildings3d` | `way/relation["building"]`, `way/relation["building:part"]`, `out body geom` | building, building:levels, building:min_level, roof:levels, height, min_height, roof:shape, roof:colour, roof:material, building:colour, building:material, layer, name, name:en, amenity, shop, tourism, religion, man_made, tower:type, historic, leisure, office, healthcare, start_date |
| `trees` | `node["natural"="tree"]`, `way["natural"="tree_row"]` | species, genus, leaf_type, leaf_cycle, height, circumference, diameter_crown, denotation |
| `barriers` | `way["barrier"~"wall\|fence\|retaining_wall\|hedge\|city_wall\|guard_rail"]`, `node["barrier"~"gate\|bollard\|lift_gate"]` | material, height, colour |
| `furniture` | nodes: `highway~street_lamp\|traffic_signals\|crossing\|bus_stop`, `power~pole\|tower\|transformer`, ways `power~line\|minor_line\|cable`, `amenity~bench\|fountain\|atm\|vending_machine\|telephone\|motorcycle_parking\|shelter\|toilets\|drinking_water`, `man_made~flagpole\|water_tower\|mast\|street_cabinet\|storage_tank`, `tourism~artwork`, `historic~memorial\|monument\|wayside_shrine` | all |
| `paths` | `way["highway"~"footway\|pedestrian\|path\|steps\|cycleway"]`, `way["area:highway"]`, `pedestrian+area=yes`, `way["man_made"~"bridge\|pier\|embankment"]` | surface, width, layer, bridge |
| `landcover3d` | `way["landuse"~"residential\|commercial\|retail\|industrial\|construction\|railway\|religious"]`, `way["amenity"~"parking\|fuel\|marketplace\|school\|hospital\|university\|place_of_worship\|bus_station"]`, `way["leisure"~"swimming_pool\|playground\|garden\|park\|pitch"]` | name, religion |
| `shopfronts` | `node["shop"]`, `node["amenity"~"restaurant\|cafe\|bar\|pub\|fast_food\|bank\|pharmacy\|clinic"]`, `node["tourism"~"hotel\|hostel\|guest_house"]`, `node["craft"]` | name, shop, amenity, cuisine, opening_hours |

- **Roads:** reuse `data-raw/roads.json`, but keep `lanes`, `width`, `sidewalk*`, `surface`, `bridge`, `layer`, `lit`, `junction`, `maxspeed`. It already has them.
- **Pipeline:**
  - A new `scripts/build-world3d.mjs` that imports the helpers from `build-map.mjs` (`toXY`, `simplify`).
  - Add an npm script `map:world3d`.
  - Leave `buildings.geojson` alone; MapLibre still uses it.

### 2.2 Output data (built offline, deterministic, testable)
Write `public/data/world3d/` split into 250 m tiles, plus `index.json`. Coordinates are Int16 decimetres relative to the tile origin; expect about 1–2 MB in total. These interfaces are the contract between agents:

```ts
type Zone = 'old_city'|'moat_ring'|'tha_phae'|'night_bazaar'|'chinatown_warorot'|'riverside_west'|'wat_ket'|'nimman'|'santitham'|'suan_dok'|'chang_phueak'|'wua_lai'|'airport'|'suburb';
interface BuildingRec { id: number; ring: number[]; holes?: number[][]; zone: Zone; cls: BuildingClass;
  levels: number; h: number; minH?: number; roof: 'flat'|'gable'|'hip'|'skillion'|'lanna'|'open'|'dome'|'none';
  wall: number; roofCol: number;          // palette indices
  front?: number; bays?: number;          // street-facing edge index; shophouse bay count
  use?: 'shop'|'cafe'|'restaurant'|'massage'|'bar'|'hotel'|'hostel'|'convenience'|'bank'|'moto_rent'|'residential';
  temple?: { ground: number; role: 'viharn'|'ubosot'|'chedi'|'ho_trai'|'sala'|'kuti'|'school'|'misc'; faces: number };
  hidden?: true }                          // replaced by a hero model
interface TempleRec { id: number; ring: number[]; front: number; entrance: [number, number];
  synth: { kind: 'chedi'|'bell_tower'|'gate'|'wall'|'bodhi'|'sema'; x: number; y: number; rot: number; size: number; variant: number }[] }
interface PropRec { k: PropKind; x: number; y: number; rot: number; v: number; link?: number } // link = next pole for cables
```

The road ribbons, water polygons (moat, river, canal, pool) and ground areas (park, temple ground, plaza, sand, apron) go in the same tiles. The ground layer owns their schema.

### 2.3 Zones
Define the zones as polygons in `src/content/districts3d.ts`, reusing the `ZONES` centres from `src/content/zones.ts`:
- `old_city` is the inside of the moat polygon.
- `moat_ring` is within 40 m outside it.
- The rest are hand-drawn from the neighbourhood table in culture.md §2.

### 2.4 Building classification, heights, roofs, colours
Rules run in order; the first match wins.

1. **Hero suppression list** (`src/content/landmarks3d.ts`): hide the footprint.
2. **Inside a Buddhist temple ground:** go to the temple inference in §2.5.
3. **Tagged footprints:**
   - `building=roof` → an open canopy on 150 mm posts.
   - `church|chapel` → white nave with a steeple.
   - `mosque` → white with a green dome and minaret (Ban Haw).
   - Chinese shrine (religion `chinese_folk`, or name contains shrine/ศาลเจ้า) → red and gold with a curved green-tile roof.
   - `man_made=stupa` / `tower:type=pagoda` → chedi.
   - `hospital|school|university|college|dormitory` → institutional.
   - `apartments` with levels ≥ 5 or area ≥ 600 → condo.
   - `tourism=hotel`: area < 800 and not tall in `old_city`/`riverside`/`wat_ket` → Lanna low-rise resort; otherwise mid-rise.
   - `shop=mall` or retail ≥ 2,500 m² → mall.
   - Inside a marketplace polygon → market hall.
   - `aeroway=terminal`, `hangar` → airport.
   - `industrial|warehouse` → shed.
   - `house|detached|residential` → house (style by zone).
4. **Untagged (93% of footprints).** First compute:
   - The minimum bounding box (L, W, angle) and rectangularity.
   - The **front edge**: the edge of at least 3 m whose midpoint is under 15 m from a road centreline, scored by distance minus 2 m × parallelism.
   - Depth D, perpendicular to the front.

| Condition | Class | Storeys (weighted random) [est, shaped by OSM stats] |
|---|---|---|
| area < 12 m² | skip (or a kiosk if it has a front) | — |
| 12–40 m² | shed/kiosk (tin roof), or a tiny house in suburbs | 1 |
| Has a front, rectangularity ≥ 0.8, D 8–30 m, zone urban (all except suburb/airport) | **shophouse**; bays = round(F/4.0), bay width 3.5–4.8 m | old_city/wua_lai: 2 (45%), 3 (40%), 4 (15%). Nimman/night_bazaar/santitham: 3 (50%), 4 (35%), 2 (15%). wat_ket/chinatown: 2 (60%), 3 (40%). 30% of Tha Phae/Chinatown/Wat Ket rows are the wooden type. |
| No front, 40–250 m² | detached house (Lanna teak 8% in wat_ket/wua_lai) | 1 (40%), 2 (60%) |
| 250–800 m² | guesthouse block (old_city), apartment block (nimman/santitham/suan_dok), house compound elsewhere | 3–5 |
| 800–2,500 m² | mid-rise in nimman/night_bazaar/santitham/suan_dok; 2–3 storey school/hotel low-rise in old_city | 5–8 / 2–3 |
| > 2,500 m² | big box: mall, market or warehouse (tall floors, metal roof); hangar in airport | 2–3 |

**Heights**
- Height = ground floor (4.0 m commercial, 3.0 m residential) + (levels − 1) × 3.1 m + parapet (1.0 m on flat roofs).
- `height` and `building:levels` tags always win.
- Caps for untagged footprints: 12 m in `old_city` and 9 m within 100 m of a temple ground [research: Citylife].

**Roofs by class**

| Class | Roof |
|---|---|
| Concrete shophouse | 85% flat with parapet and rooftop clutter: water tank 70%, roof shed 30%, antenna 30%, plants 25%, dish 20%, laundry 15%, rebar 10%. 15% low-pitched tin gable or skillion. |
| Wooden shophouse | Low gable parallel to the street |
| House | Hip 60%, gable 30%, kalae gable 5%, flat 5% |
| School | Hip, orange tile |
| Market / `roof` | Large gable on posts |
| Condo | Flat with lift box, 20% rooftop pool deck |
| Tagged `roof:shape` / `roof:colour` | Override the class default |

**Wall colours** (weighted, then jittered per building ±4% in HSL lightness): see palette §3.1.
- 30% of bays in a shophouse row get their own repaint colour.
- Each bay gets its own sign colour and shutter state.

**Ground-floor use.** Snap each `shopfronts` node to the nearest front edge within 12 m. Otherwise:
- On primary/secondary/tertiary roads: 90% shop.
- On residential sois: 50% shop, 50% residential (closed grille, pots, a motorbike inside).

Use drives the look:

| Use | Look |
|---|---|
| Café | Glass front, deck, plants |
| Restaurant | Open front, red stools |
| Massage | Row of foot-massage chairs outside (Moon Muang, Loi Kroh) |
| Bar | Neon |
| Hostel | Balconies with laundry |
| Convenience | White glare |
| Motorbike rental | Row of scooters out front |

**Shutter state by time of day**
- Commercial: open 08:00–20:00.
- Bars, massage shops and convenience stores stay lit late.

### 2.5 Temple inference (88 grounds)
1. **Collect footprints** whose centroid is inside the ground. Pin roles from tags and names first: วิหาร/viharn → viharn, อุโบสถ/ubosot → ubosot, เจดีย์/พระธาตุ/stupa/pagoda → chedi, หอไตร → ho trai, ศาลา → sala, `building=school` → school.
2. **Main chedi.** The largest footprint with aspect ≤ 1.25 and a side of 6–60 m, which also has ≥ 8 vertices, or circularity > 0.8, or `man_made`.
   - If there is none, *synthesise* one in the largest free space behind (west of) the main viharn.
   - Free space is found from a 0.5 m occupancy raster.
   - Side = clamp(0.08·√(ground area), 6, 20) m, height ≈ 2.4 × side.
   - Finish chosen by hash: white body with gold spire 45%, gold 30%, weathered white-grey 15%, brick ruin 10%.
   - Type: bell 55%, redented square 30%, octagonal 15%.
3. **Viharn.** The largest elongated footprint (L/W 1.6–3.5, W 8–25 m, L 15–60 m) that is not a school.
   - It faces the ground's street side: the ground edge closest to a road of class tertiary or higher. Default is east.
   - Accept any axis; Wat Lok Molee runs north–south (Wikipedia).
4. **Ubosot.** The next elongated hall with W 6–14 m and L 12–30 m. Add 8 sema stones at 1.5 m offset.
5. **Ho trai.** A near-square footprint of 16–64 m² within 25 m of the viharn, at most 1 per temple, 30% chance unless tagged.
6. **Sala.** Remaining rectangles of 8–20 m with no east–west constraint, rendered as open-sided.
7. **Kuti / school / misc.** Everything else: plain 1–2 storey cream-walled buildings with orange or brown gables (the 3-storey school type for `building=school`).
8. **Synthesised pieces:**
   - Bell tower (3 × 3 m, 7 m tall) at a front corner of the viharn.
   - Compound wall along the ground ring, 0.5 m inset, unless an OSM `barrier=wall` lies within 3 m of the edge.
   - Arch gate plus paired singhas at the point of the ground edge nearest the viharn's front axis.
   - Bodhi tree in open space.
   - Tung-flag poles along the front wall.
9. **Non-Buddhist grounds** (26 in the bbox): use the church, mosque, Chinese-shrine or Hindu-shrine kit. The city pillar shrine at Wat Chedi Luang is part of that hero model.

### 2.6 Ground layer rules (owned by the lead)
**Road widths**
- `width` tag if present, else lanes × 3.1 m + 0.6 m.
- Without `lanes`: trunk 14 m (with median trees), primary 10.5, secondary 8.5, tertiary 7, unclassified 6, residential 5, living street / service 4.
- Moat roads: inner 2 lanes plus a parking lane; outer 3 lanes.

**Ground surface.** Fill the whole urban ground with worn concrete and pavers, so sidewalks come for free. Draw road ribbons on top, and kerbs along tertiary and larger roads, with gaps within 8 m of junctions.
- Kerb paint: red/white within 15 m of junctions and bus stops; yellow/white at ranks.
- Markings: yellow centreline on two-way roads with lanes ≥ 2; white dashes on multi-lane one-ways; zebra crossings at signals, temples and schools; painted tuk-tuk rank boxes at Tha Phae Gate and Warorot.

**Water levels**
- Moat surface −1.6 m, with brick bank walls, parapet and railing. Causeways (railings on both sides) where roads cross the gaps.
- Ping surface −4 m, sloped grassy banks.
- Mae Kha canal: concrete sides, −2 m, footbridges.
- Pools: bright cyan.

**Other ground:** the runway, taxiways and apron, and brick-red pavers for the Tha Phae Gate plaza (use the OSM pedestrian area if one is mapped, else about 80 × 50 m east of the gate).

### 2.7 Prop placement rules (Agent B)
Every prop checks an occupancy raster built from the footprints and the road carriageways.

**Trees**
- Use all 1,252 OSM trees and 98 rows (species from tags, else the zone mix).
- Moat banks: one tree every 10–14 m on both banks. Mix: 35% rain tree, 20% palms (sugar / fan), 15% bodhi/banyan, 15% teak, 15% flowering.
- Arterial sidewalks at least 2 m wide: every 12–20 m.
- Parks: Poisson disk at 8 m spacing.
- Temples: 1 bodhi plus 2–5 others.
- House plots with a yard: 1–2 of mango, banana, coconut, frangipani.
- Target 15–25k instanced trees.

**Power poles and cables**
- Every 35 m (±5) on one side of each road that is not buried. The side is chosen by hash per way. Chain the poles with 3–6 catenary lines.
- **Excluded:** Tha Phae Rd, Chang Klan Rd, the 8 moat roads and the Tha Phae Gate plaza. Put a PEA cabinet every 60 m there instead.
- Ratchadamnoen, Nimman, Huay Kaew, Suthep and Mahidol are "planned" for burial. Keep poles there at half density.

**Street lamps**
- Arm lamps every 35 m on primary and larger roads, and on any `lit=yes` road.
- Heritage lanterns every 20 m on moat promenades, Tha Phae Rd, Ratchadamnoen and Nimman Rd.

**Other props**

| Prop | Rule |
|---|---|
| Spirit houses | 40% of commercial front edges and all hotels; set 1 m back from the front corner |
| Parked motorbike rows | 3–12 per shop cluster at 45°; density 1.0 in markets, Nimman and the Old City, 0.4 in suburbs; also at temple gates |
| Food carts / parasols | Clusters of 3–8 at market edges, gates and soi mouths; follow the market timetables (§3.5) |
| Convenience stores | OSM `shop=convenience`, plus one at major street corners every 250–400 m |
| Signals, bus shelters, flags, bins, benches, cabinets, hydrants | OSM positions first, then procedural fill |
| Moat fountains | OSM fountains, plus one jet every 100 m along the moat centreline and an array of 5 jets at each corner |

### 2.8 Hero landmarks (hand-authored procedural models, Agent A)
Each hero model is fitted to its OSM footprint or anchor and hides the generic footprints it replaces.

| # | Landmark | Anchor (OSM) | Rough dimensions | Colours / notes |
|---|---|---|---|---|
| 1 | **Tha Phae Gate and plaza** | node/1017379824 + nearby wall ways | Wall 5–5.5 m + 0.9 m merlons, 2.5–3 m thick with battered faces. Opening 4.5 m × 4.5 m with a timber lintel and two leaf doors. Plaza ≈ 80 × 50 m [est] | New brick #c0623a, old #9a4a2c, mortar banding, doors weathered grey #8d8478. Warm uplights at night. Festival stage and lantern-arch anchors. |
| 2 | **Other four gates** (Chang Phueak, Suan Dok, Chiang Mai, Saen Pung) | nodes in landmarks.md; Suan Dok ways 323670037 / 473546718 | Same kit, fitted to the wall ways; traffic islands | Saen Pung partly ruined |
| 3 | **Four corner bastions** | ways 263459882, 317516852, 317516851, 791602197 | OSM footprints, 4.5–6 m tall, ruined crenellations, trees on top | Moss #66733f on old brick |
| 4 | **Wat Chedi Luang** | way/243018795; chedi footprint 58.5 × 57.4 m | Chedi originally 82 m tall with a 54 m base (Wikipedia); upper ~30 m fell in 1545; model **55 m**. Stepped square terraces, naga stairs on 4 sides to niches at ~28 m, elephant sculptures on a terrace, broken bell stub. Viharn Luang 70.6 × 21.3 m (OSM), 3-tier roof. City-pillar shrine plus 3 tall dipterocarps; reclining Buddha pavilion. | Weathered brick/laterite #9b6b4f and OSM #B79F7B, lichen #5f5a4a. Warm floodlight at night. |
| 5 | **Wat Phra Singh** | way/93414647 | Viharn Luang 56 × 24 m (1924); Viharn Lai Kham 30 × 8 m; gilded bell chedi ~24 m with elephant foreparts on the base (sources disagree: square vs octagonal); ho trai on a tall white base | Red-orange tiles with green/gold edges, white walls, gold ornaments. Sits at the west end of Ratchadamnoen. |
| 6 | **Wat Chiang Man** | way/98070869 | Chedi Chang Lom: square base, second level with 15 life-size elephant front halves, gilded upper part and canopy. Base ~12 m, ~20 m tall [est] | Stucco white elephants, gold top. First temple of the city (1297). |
| 7 | **Wat Suan Dok** | way/322604729 | 48 m bell-shaped chedi, Sri Lankan style; cluster of 20–30 white royal chedis 3–6 m in the NW; open viharn (1932) ≈ 72 × 28 m (OSM) | Chedi finish gold on a white base (verify against photos); white mausoleums. Under the flight path. |
| 8 | **Wat Lok Molee** | way/692137164 | Bare-brick chedi (1527) ~30 m [est] with niches and nagas; teak viharn (1545); **north–south axis** | Bare brick #8f5d43, dark teak #5a3a22 |
| 9 | **Wat Phan Tao** | way/243018378 | All-teak viharn on a stone base, 3-tier roof, gold naga chofa | Weathered teak #5a3a22. Hero site for Yi Peng lanterns. |
| 10 | **Wat Sri Suphan** | way/309886989 | Silver ubosot ~20 × 10 m [est]; Wua Lai silver shops around | Silver/nickel/aluminium cladding #cfd4da with high specular |
| 11 | **Three Kings Monument and Arts & Cultural Centre** | node/1619287904, relation/17998804 | Three life-size bronze kings on a ~2 m plinth, plaza with lawns; white colonial-style former provincial hall, 2 storeys | Bronze #5a4630, white stucco, marigold offerings at the base. No gameplay interaction with the statues. |
| 12 | **Warorot and Ton Lamyai** | way/89039067, way/385577703 | 3-storey concrete hall with central atrium, open ground floor (fit to OSM); flower stalls along the river | Grey/cream concrete bands, red Chinese lanterns, coloured songthaew queues |
| 13 | **Ping River bridges** | Nawarat way/39950433, Iron Bridge way/1210218897 | Nawarat: concrete deck on piers with lamp posts. Khua Lek: dark steel Parker through truss, curved top chord, 7 panels, side walkways | Truss #2e3533; string lights at night |
| 14 | **Night Bazaar district** | way/22981272, Kalare way/58560283, Anusarn way/494956275 | Night Bazaar building; Kalare food court; Anusarn covered lanes; Chang Klan stall strip; Loi Kroh neon; boxing ring under an open roof | Stall canopies white/blue/red, bulb strings #ffcf7a |
| 15 | **Nimman trio at Rin Kham** | MAYA way/249154472, One Nimman way/627946317, Think Park way/335541194 | MAYA: ~6-floor cube with a procedural diagonal Lanna-textile façade lattice. One Nimman: red-brick arcaded courtyard with a ~25 m clock tower [est]. Think Park: low open plaza | Taupe/grey lattice; brick #a8573a with arches |
| 16 | **CNX airport** | way/58309446; runway ref 18/36 | Runway 3,100 × 45 m; terminal with Lanna-inspired roof; tower; apron jets | Asphalt #4b4b4d, apron #b9b6ae |
| 17 | **Doi Suthep backdrop** (outside the bbox) | temple 18.80492, 98.92210 | Procedural ridge heightfield (no DEM download): summit 1,676 m, Doi Pui 1,685 m to the NW, temple ledge 1,060 m, city base ~310 m [est] | Forest #3f5f45 fogged to the sky colour; gold glint and night lights |

**Kit-level extras** (use the generic kits plus small custom parts):
- Chang Phueak white-elephant monument (Wikipedia coordinate 18.8006, 98.9861; not in OSM by name).
- Ban Haw Mosque, the Guan Yu shrine, Nong Buak Haad park.
- Chiang Mai Gate / Somphet / Chang Phueak markets.
- Central Chiangmai Airport mall: new timber-lattice façade (art4d, May 2026).
- Kad Suan Kaew: closed since 2022, so dull with only a few lit windows (landmarks.md).
- Maharaj hospital towers (tagged), the railway station (at the east edge), the Supalai Monte towers.

---

## 3. Palette and lighting

### 3.1 Base palette
One palette file, `src/world3d/palette.ts`, with namespaced groups.

| Group | Colours |
|---|---|
| Ground | asphalt_new #5f5d5a, asphalt_old #7a7670, concrete_road #a8a296, lane_white #efece4, lane_yellow #e0b43c, kerb_red #b8322a, kerb_white #eeeae2, kerb_yellow #e3b92e, pavement #c9baa0, brick_paver #b9785a, plaza #c47a55, temple_sand #e2d0a6, dirt #c9ab7c, grass #74a24a, grass_dry #b3ad6e, runway #4b4b4d, apron #b9b6ae |
| Water | moat #4d8a7c (deep #2f6259), ping_dry #7d8a62, ping_rain #8d7650, canal #5b6e4f, pool #3fc1d4, water_night #16242c |
| Brick | brick_old #9a4a2c, brick_new #c0623a, brick_ruin #8f5d43, laterite #a9744f, mortar #d8c3a2, moss #66733f, stucco_white #f1ece2 |
| Shophouse walls (weight) | cream #efe4c9 (20), off-white #f3f0e8 (18), concrete #bdb7ab (14), butter #efd48a (8), teak #6b4428 (7), salmon #e8a987 (6), mint #bfdcc4 (6), sky #b8d3e3 (6), peach #f2c29a (5), pistachio #d3dea2 (4), terracotta #c9724f (4), lavender #cbbfd9 (2) |
| Detail | shutter #9da3a6 / #5d86a8, grille white #eeeeee, grille green #3e7a5c, grille brown #6a4a33, glass #2f4a55 / #5f9ea0, AC unit #e9e7e1, tank steel #c9cdd0, tank blue #3f78b5, tank beige #d9c7a2; awnings/signs #2f6db5, #c8312b, #f0c330, #2e8b57, #f28c28, #ffffff |
| Roofs | terracotta #c2562f, brick #9e3b2a, brown #6e4430, grey #6f7478, blue-grey #5a7185, green #4f7a55, zinc #a4acb0, rust #a0532e, metal blue #4c78a8, metal red #b4452f, concrete #b8b2a8 |
| Temple | gold #d8a431 (lit #ffcf5a), gold_dark #a67a1e, lacquer_red #8f1f24, lacquer_black #231815, temple_white #f4f0e6, roof_orange #c9582b, roof_red #9b2f25, border_green #2f6e4a, teak_dark #5a3a22, mosaic_teal #3aa39a, mosaic_blue #2e5fa8, naga_green #3f8f4f, silver #cfd4da |
| Vegetation | rain_tree #4a7a37, bodhi #5d8f3c, banyan #3f6e33, teak_leaf #6f8f3f, yang #557d3a, palm #6a9a3a, palm_trunk #8a7b66, bark #5b4a3a, hedge #3e6b35, dry_leaf #b59a55; bougainvillea #d23f8c / #f07b2a / #f2f2f2, frangipani #f7f1e2 / #f4b9c8, golden shower #f2c230, flame tree #d8432a, pink trumpet #e991b8 |

### 3.2 Lighting driven by sun elevation, not clock hour
Compute the sun position from the game date with a standard solar formula (lat 18.79, lon 98.98, UTC+7).
- November noon sun is about 51–57° high.
- At Songkran it is about 81°: harsh, with almost no shadows.
- Sunset is in the WSW, behind Doi Suthep.

| Phase (sun elevation) | Key light | Sky zenith → horizon | Hemisphere sky / ground | Fog | Notes |
|---|---|---|---|---|---|
| Morning (0–15°, rising) | #ffd9a8, 1.6 | #9cc3e3 → #f1e3cf | #bcd8ee / #b89f7a | #dfe6e3, low ground mist over the moat and river in the cool season | Monks' alms rounds 05:30–07:00 (culture.md) |
| Day (> 35°) | #fff4e0, 3.0 | #7fb6e0 → #cfe3ec | #a9cdef / #cdb89a | Light, #cfe3ec | Slightly bleached. Shadows on. |
| Golden (0–12°, setting) | #ffb86b → #ff8a4a, 2.0 → 1.0 | #7aa0c8 → #ffc58a | #c9b8d8 / #a4805a | #f1c9a0 | Gold gets +specular and 0.15 emissive; long eastward shadows; Doi Suthep silhouette |
| Blue hour (−6° to 0°) | off | #2e3f6e → #e39a6b | #5d6f9a / #3a3028 | #6d6f8a | Lamps on at +2°; 60% of windows light up |
| Night (< −6°) | Moon #8fa3d6, 0.25 (×2 at full moon) | #0f1630 → #25304f | #1b2440 / #2a2018 | #1a1f33 | Emissives take over |

### 3.3 Night lighting
Real point lights would cost too much here. Instead:
- Emissive vertex attributes, additive glow sprites, and light-pool decals under lamps and stalls.
- At most about 8 real point lights, placed near the camera.

Light colours:
- Sodium lamps #ffb45c on older roads, LED #f3f1ea on main roads.
- Shop interiors are **cool fluorescent #dff3ff mixed with warm #ffd28a**. The cool tubes are a strong Thai cue.
- Convenience-store glare #eaf6ff.
- Market bulb strings #ffcf7a.
- Neon pink/cyan on Loi Kroh.
- Warm floodlights on chedis, gates and bastions.
- Moat fountains uplit white/cyan.
- The tuk-tuk's roof TAXI box is lit yellow #f4d03f. A lit roof sign is required by the 2017 rules (culture.md §7).

### 3.4 Weather and season variants
All published through one `WorldEnv` state.

| Variant | When | Look |
|---|---|---|
| **Rain** | May–Oct, afternoon peak (calendar.md) | Key 0.8, desaturated. Road albedo ×0.75, low roughness and specular glints, puddle decals, rain streaks. Umbrellas and bright ponchos on riders. Tuk-tuk curtains down. |
| **Haze / smoke** | Feb–Apr, peaking Mar/Apr | Fog ×3, #c9b89a. Orange-red sun disc. **Doi Suthep hidden.** Dry, yellow foliage. Face masks on 30% of pedestrians. |
| **Cool-season mist** | Nov–Jan mornings | Low fog in the moat and river channels. Thai visitors in puffer jackets. |

### 3.5 Festivals and weekly events
Owner: Agent B for set dressing, Agent C for crowds and vehicles. Driven by `src/content/festivals3d.ts`, which cites calendar.md.

**Yi Peng / Loy Krathong, 23–25 Nov 2026**
- This is game days 22–24, so it is the first set piece players will see. Build it first.
- *Khom khwaen* hanging lanterns, strung across Tha Phae Rd, Ratchadamnoen, Moon Muang, the moat causeways and temple courtyards:
  - Cylinder/star shapes 0.4–0.6 m with tassels, 5–6 m up, 1.5 m apart, strings every 10 m.
  - Colours red, yellow, white, blue, orange (culture.md §10). Emissive with a gentle sway.
- Clay oil-lamp candles along temple walls, steps, gates and the Tha Phae Gate walls.
- Krathong (0.3 m, with a candle) drifting south on the Ping between Nawarat and the Iron Bridge, and on Khlong Mae Kha.
- Khom pariwat revolving lanterns in temples. Coconut-frond arches at gates.
- Lantern parade floats (8–10 m, on trucks) on Tha Phae Rd from 19:00 on the 25th.
- Full moon on the 24th.
- A 30,000+ crowd at Tha Phae Gate on peak night; use low-LOD crowd impostors.
- No flights after 19:00 (calendar.md).
- **No sky lanterns in the city.** The 2026 municipal programme bans *khom loi* releases. At most, a faint distant drift on the NE horizon in cinematic shots.

**Songkran, 13–15 Apr (activities 10–15)**
- Moat splash zone: crowds with buckets and water guns along the moat.
- Pickups with water barrels and people in the bed circling the moat.
- Spray particles, wet roads, floral shirts, white clay-powder smears.
- A two-storey water tunnel on Tha Phae Rd and a stage at Tha Phae Gate.
- Sand chedis (1–2 m cones) with tung flags in temple grounds.
- Wooden props under bodhi trees.
- Phra Buddha Sihing procession on 13 Apr at 14:09: Nawarat Bridge → Tha Phae Rd → Ratchadamnoen → Wat Phra Singh.
- Combine with the April haze sky.

**Weekly events**
- Sunday Walking Street: Ratchadamnoen from Tha Phae Gate to Wat Phra Singh.
- Saturday Walking Street: Wua Lai Rd.
- Both 17:00–23:00. Stalls: 2 × 1 m tables under 2 × 2 m canopies, set up from 16:00, packed away at 23:00. Three rows on Ratchadamnoen.
- Night Bazaar every night 17:00–24:00.
- Chang Phueak Gate and Chiang Mai Gate night food stalls 17:00–24:00; Chiang Mai Gate also has a fresh market 04:00–12:00.
- Warorot 06:00–19:00; Ton Lamyai flowers 24 hours.

**Other events**
- Flower Festival (13–15 Feb): flower floats, displays at Nong Buak Haad, pink trumpet trees in bloom.
- Chinese New Year (17 Feb): red lanterns in Warorot/Chang Moi, lion dance.
- Inthakin (13–20 May): flower-cone offerings at Wat Chedi Luang.
- Visakha Bucha: candle processions around viharns.

---

## 4. Vehicles and people (Agent C)

### 4.1 Tuk-tuk (hero asset)
**Dimensions:** 3.2 × 1.4 × 1.85 m. The 2017 rules cap tuk-tuks at 4 × 1.5 × 2 m, and the 7-seat EV is 4.0 m (culture.md §7).

**Parts**
- Tub body in `paint.body`, with a raised pinstripe band in `paint.trim`.
- Tapered nose over a single front wheel; chrome headlamp pods; clear windscreen with visor.
- Curved 3–4 segment canopy in `paint.canopy`, with the lit yellow TAXI box at the front.
- Red/black vinyl rear bench, chrome side bars and curly rear rails.
- Red rims on all three wheels.
- Yellow plate with green text; registration number on both sides.
- Jasmine garland on the mirror.
- Optional clear rain curtains.

**Per-livery extras** (IDs from `src/content/paints.ts`)
- `tung_lanna`: small lanterns and tung flags along the canopy.
- `bo_sang`: small parasol on the canopy.
- `kalae_teak`: crossed kalae horns at the canopy front.
- `khom_loi`: emissive orange LED strips at night.
- `coop_taxi`: yellow/blue split.
- `nakhon_blue` is the default.

**Models** (`src/content/vehicles.ts`)
- `rusty`: body colour lerped 25% toward grey, dents from vertex jitter, rust patches, a mismatched canopy patch.
- EV models: no exhaust, smoother nose, green EV badge.
- `ev_7seat`: longer, with two benches.

**Animation**
- Roll on turns, pitch on braking and acceleration.
- LPG idle shake: 1 cm at about 2 Hz. EVs sit still.
- Wheel spin, headlight cone decal at night, brake light.
- Driver in a cap; passengers seated and visible.

**Triangle budget:** LOD0 1,000–1,500, LOD1 about 300, LOD2 about 60.

### 4.2 Other vehicles

| Vehicle | Spec [est] | Share of ambient traffic |
|---|---|---|
| Scooter / motorbike | 1.9 × 0.7 × 1.1 m. 1–3 riders, helmets white/black/pink or none. Delivery boxes in fictional brand colours. Sidecar vendor carts. | ~55% |
| Pickup (white/silver/black/grey), sedan, SUV | Pickups sometimes with cargo in the bed | ~30% |
| **Red songthaew** *rot daeng* | Pickup, 5.3 × 1.8 × 2.3 m. Covered bed with raised roof, two side benches (8–10 adults), rear step and grab rails, roof buzzer, roof rack. Red #c8312b. Yellow/white/blue/green/orange variants parked at the Warorot and Chang Phueak terminals. | ~7% |
| Tuk-tuk (rivals) | Mostly `nakhon_blue`, some green | ~3% |
| Tour vans (white), meter taxis (yellow-blue coop / red-yellow private), city buses, double-deck VIP coaches (Arcade/hotels), 6-wheel trucks, ambulances near hospitals, rental bicycles, and a rare pedal samlor near Warorot (only 28 remain, culture.md §7) | | ~5% |
| Airport jets, plus the Songkran pickup-with-barrels variant | | Event-driven |

### 4.3 People

**The 12 game archetypes.** Each needs a readable silhouette, 2–3 colours and a prop. Accent colours come from `ARCHETYPES[*].color`.

| Archetype | Signature |
|---|---|
| backpacker | Tall backpack reaching above the head (orange/green), patterned elephant pants, tank top |
| tourist_cn | Pastel parasol or sun hat, phone raised on a selfie stick, groups of 2–4 in matching colours |
| tourist_kr | Bucket hat, beige/white/pastel, crossbody bag, iced-coffee cup |
| tourist_west | Cap or sun hat, shorts, camera or map |
| retiree | Panama hat, light patterned shirt, sometimes a cane, slow gait |
| nomad | Big headphones, laptop tote, dark tee, iced coffee |
| thai_tourist | Puffer jacket or scarf in the cool season, family groups, selfies |
| student | CMU uniform: white shirt, black skirt or trousers, lanyard; groups of 2–3 |
| vendor | Wide bamboo hat, apron, shoulder pole with two baskets, or sacks / cooler / flower baskets |
| monk | Saffron #e8871e or forest-ochre #9c5a24 robe with one shoulder bare, shaved head, black alms bowl at dawn, yellow umbrella; walks single file |
| elder | Lanna *pha sin* tube skirt with a banded hem, grey bun, small basket or umbrella, slight stoop |
| business | Dark trousers, white shirt or blazer, roller suitcase |

**Ambient-only people:** local shoppers, office workers, schoolchildren, novices, white-robed nuns, traffic police, masseuses in uniform, porters, joggers on the moat, cyclists, plus soi dogs, cats and the Tha Phae Gate pigeons.

**Skin tones:** a natural range (#8d5a3b to #f0cfb0), no caricature.

### 4.4 Waiting passengers: making them readable
- **Scale.** People render at 1.2× and vehicles at 1.1× [art]. That makes a person roughly 25–35 px tall at the default follow distance.
- **Idle.** Stand at the kerb facing the road; shift weight, check phone.
- **Hail.** When a tuk-tuk is within about 60 m: arm out, palm-down flapping wave (the common Thai beckoning gesture; unverified in our research notes).
- **Markers:**
  - A ground ring decal in the archetype colour, doubling as a radial patience timer that depletes clockwise and turns red below 25%.
  - A billboard badge 2.5 m up that reuses `passengerBadge()` from `src/map/sprites.ts`, with a minimum on-screen size of 28 px. Both glow at night.
  - Ambient pedestrians are slightly desaturated and have no ring.
- **Party and luggage.** Party size N gives N figures. Luggage props: suitcase (airport, hotels), sacks, flower baskets (Ton Lamyai), and a durian easter egg (dialogue line 36).
- **Impatience sequence:** fidget → look at watch → sit on luggage → at zero patience, walk away or climb into a passing songthaew.
- **Boarding** (1–1.5 s): walk to the tuk-tuk's **left side**; the 2017 rules allow passengers to board only on the driver's left. A monk takes the far end of the bench, and no woman sits beside him (culture.md §4).
- **Drop-off.** Thai archetypes step out with a *wai*. Monks only nod; they do not wai laypeople. Coin sparkle for a tip.

### 4.5 Animation technology and budgets
- Rigid segmented low-poly people (150–250 triangles), with no skinning.
- A per-vertex limb index plus per-instance attributes (colour slots for skin/top/bottom/hat/prop, animation id, phase).
- The vertex shader animates walk, idle, hail, sit, wai and carry.
- One `InstancedMesh` per body/prop variant.
- Caps: about 800 ambient people plus all passengers, about 300 ambient vehicles, with crowd impostors beyond 250 m.

---

## 5. Build order, ownership and "done"

### 5.0 Shared contracts (P0, the lead lands these before anyone forks)
**Module layout**
- `src/world3d/core/`: `units.ts`, `rng.ts`, `palette.ts`, `atlas.ts` (the procedural sign / shutter / lattice / glyph texture), `geom.ts` (extrude, gable/hip/Lanna roof primitives, lathe, prism, merge, flat normals), `lod.ts`, `chunks.ts` (250 m tiles, worker build queue), `env.ts` (`WorldEnv { sunDir, sunElev, phase, weather, festival, moon }` from the game clock and calendar).
- Content files:
  - Agent A owns `src/content/buildings3d.ts` and `src/content/landmarks3d.ts`.
  - Agent B owns `src/content/props3d.ts` and `src/content/festivals3d.ts`.
  - Agent C owns `src/content/people3d.ts` and `src/content/vehicles3d.ts`.
  - `src/content/districts3d.ts` is shared and written by the lead.

**Generator contract:** `(rec, ctx: { rng, palette, atlas, lod, env }) => MeshData { position, normal, color, emissive?, sway?, uv? }`, as pure functions.

**Shared material:** one world material with the uniforms `uNight`, `uWet`, `uHaze`, `uWind`, `uFestivalGlow`.

**Visual APIs for Agent C** (the traffic *logic* is design.md Workstream D):
- `vehicleVisual(kind, livery, model).setPose(x, y, heading, speed, steer)`
- `personVisual(archetype, variant).play(anim)`

**Debug handle:** `window.__world3d` with layer toggles and camera presets: tha_phae_gate, chedi_luang, si_phum_corner, rin_kham, night_bazaar, warorot_riverside, wua_lai, cnx_apron.

### 5.1 Phases

| Phase | Owner | Deliverable | Done when |
|---|---|---|---|
| **P0 Foundation and data** | Lead | Contracts above; new Overpass queries; `build-world3d.mjs` producing classified buildings, zones and fronts; `tests/world3d-*.test.ts` | Whole core bbox renders as coloured extrusions at 60 fps on an M1/Iris laptop at 1080p. Sun follows the game clock. Build is deterministic (same hash twice). Tests pass: 88 grounds; heights ≤ 12 m untagged in the Old City; bay width 3.5–4.8 m. |
| **P1 Ground** | Lead | Road ribbons with widths, kerbs and paint, markings, ranks; sunken moat with banks and causeways; Ping and canal; plazas; runway/apron | Driving the moat loop in follow-cam, lanes, kerbs, one-way arrows and moat banks read clearly. No z-fighting at the 8 presets. |
| **P2 Buildings** | A | Shophouse row generator (bays, shutters by time of day, signs, awnings, grilles, AC units, rooftop clutter); wooden shophouse, house, Lanna house, condo, mall, market/open roof, institutional, church/mosque/shrine; ground-floor uses | A random Old City block and a Nimman block match §1.2 in side-by-side review. All 18.8k built in workers in under 3 s total. LOD0 shophouse bay ≤ 250 triangles. |
| **P3 Temples** | A | Viharn, ubosot, 4 chedi types × 4 finishes, ho trai, sala, bell tower, wall, arch gate, singhas, sema; inference from §2.5 | Every Buddhist ground has exactly one main chedi, ≥ 1 viharn with a Lanna roof facing its street side, a wall and a gate (Vitest). Gold spires visible from any Old City preset. |
| **P4 Walls, gates, bastions, moat dressing** | A (structures) + B (fountains, railings, trees) | Landmarks 1–3 plus moat fountains | The moat square is recognisable from max zoom-out. Tha Phae Gate matches the reference at the preset. |
| **P5 Hero landmarks** | A | Landmarks 4–17 with night lighting and footprint suppression | Each within ±15% of the table dimensions, placed on its OSM anchor, lit at night. Doi Suthep visible in the dusk establishing shot. |
| **P6 Vegetation** | B | 12 species × 3 LODs (tree LOD0 ≤ 400 triangles), OSM trees plus procedural rules, seasonal tints, wind sway | 15–25k instanced trees. Moat fully lined. A bodhi in every temple. No trees inside footprints or carriageways (test). |
| **P7 Street furniture** | B | Poles and cables (with the buried-cable exclusions), lamps, PEA cabinets, spirit houses, motorbike rows, carts and parasols, signals with countdowns, shelters, flags, bins, stall kit | No bare frontage at street-level presets. No poles on Tha Phae / Chang Klan / moat roads (test). Props add ≤ 40 draw calls. |
| **P8 Vehicles** | C | Tuk-tuk (11 liveries × 5 models, wear), songthaews (6 colours), scooters, cars/pickups, vans, taxis, buses, jets | Player and fleet drive 3D tuk-tuks. All liveries in `paints.ts` render correctly. The ambient API is ready for Workstream D. |
| **P9 People** | C | 12 archetypes plus ambient types, shader animation, waiting/hail/board/drop-off, density by zone and time (alms at dawn, market crowds) | A playtester names 5 random waiting passengers' archetypes correctly with badges hidden. 800 animated people at ≤ 3 ms/frame. |
| **P10 Moods and weather** | Lead | §3.2–3.4 keyframes, lamps and windows, rain/haze/mist | Screenshots at 07:00, 12:00, 17:30, 18:30 and 23:00 × clear/rain/haze at the 8 presets approved. |
| **P11 Festivals and weekly events** | B + C | Yi Peng first, then walking streets, Night Bazaar timetable, Songkran, Flower Festival, CNY, Inthakin | Advancing the clock to 24 Nov 19:00 shows lanterns, candles, krathong, crowds and no sky lanterns. Stalls appear and disappear on schedule. |
| **P12 Polish** | Lead | Pitch-by-zoom horizon, airport arrivals/departures, title-screen flyover, photo mode | Doi Suthep visible at closest zoom facing west in clear weather, and hidden in haze. |

- A, B and C run in parallel after P0 and P1. B's P7 needs the front-edge data from P0.
- **Performance targets for the whole scene:** under 300 draw calls, under 1.5 M triangles in view, one shadow cascade covering about 300 m around the target (off at night).

### 5.2 Risks and mitigations
- **OSM footprints overlapping road ribbons:** buildings win; lower the ribbons slightly. Props use the occupancy raster.
- **Shophouse rows mapped as one polygon:** the bay subdivision handles it. Individually mapped bays stay single-bay.
- **Temples with only 1–2 mapped footprints** (4 grounds have none): the synthesis step guarantees a viharn and a chedi.
- **Unverified shapes** (the Wat Phra Singh chedi base, Wat Suan Dok finish, Tha Phae Gate details): keep hero dimensions in `landmarks3d.ts` with `[est]` / `(unverified)` markers so they can be corrected later.
- **Cultural sensitivity:** no royal imagery. Statues and Buddha images are shown respectfully, with no gameplay collisions or gags. Hill-tribe dress only on vendors, never as costume jokes.

---

## Sources
- [Wikipedia: Wat Chedi Luang](https://en.wikipedia.org/wiki/Wat_Chedi_Luang); [Renown Travel: Wat Chedi Luang](https://www.renown-travel.com/temples/wat-chedi-luang.html)
- [Wikipedia: Wat Phra Singh](https://en.wikipedia.org/wiki/Wat_Phra_Singh); [Renown Travel: Wat Phra Singh](https://www.renown-travel.com/temples/wat-phra-singh.html)
- [Wikipedia: Wat Suan Dok](https://en.wikipedia.org/wiki/Wat_Suan_Dok); [Wikipedia: Wat Lok Moli](https://en.wikipedia.org/wiki/Wat_Lok_Moli); [Wikipedia: Wat Phan Tao](https://en.wikipedia.org/wiki/Wat_Phan_Tao); [Wikipedia: Wat Chiang Man](https://en.wikipedia.org/wiki/Wat_Chiang_Man); [Renown Travel: Wat Chiang Man](https://www.renown-travel.com/temples/wat-chiang-man.html)
- [Wikipedia: Thai temple art and architecture](https://en.wikipedia.org/wiki/Thai_temple_art_and_architecture); [Thai Temple Archive: architecture guide](https://thaitemplearchive.org/stories/thai-temple-architecture-styles-complete-guide)
- [Wikipedia: Tha Phae Gate](https://en.wikipedia.org/wiki/Tha_Phae_Gate); [Changpuak Magazine: Walls and Gates](https://changpuakmagazine.com/en-article/WALLS-AND-GATES/300287/); [chiangmai1.com: City Sights](https://www.chiangmai1.com/chiang_mai/city_sights.shtml); [Our Planet Images: city walls](https://ourplanetimages.com/chiang-mai-ancient-city-walls/)
- [Citylife: In the zone (height limits)](https://www.chiangmaicitylife.com/clg/our-city/environment/in-the-zone/); [Citylife: PEA underground cabinets](https://www.chiangmaicitylife.com/citynews/general/pea-staff-clean-up-graffiti-covered-underground-electrical-control-boxes-around-chiang-mai-moat/); [Citylife: plans to bury cables](https://www.chiangmaicitylife.com/citynews/general/municipality-plans-bury-power-cables/)
- [Sarasatr: street trees along the moat](https://so05.tci-thaijo.org/index.php/sarasatr/article/view/133171); [Thai Forest Bulletin: Yang na trees](https://li01.tci-thaijo.org/index.php/ThaiForestBulletin/article/view/25044)
- [Wikipedia: Doi Suthep](https://en.wikipedia.org/wiki/Doi_Suthep); [Wikipedia: Chiang Mai International Airport](https://en.wikipedia.org/wiki/Chiang_Mai_International_Airport); [art4d: Central Chiangmai Airport](https://art4d.com/en/2026/05/central-chiangmai-airport)
- [HistoricBridges: Iron Bridge](https://historicbridges.org/bridges/browser/?bridgebrowser=thailand%2Floi_kroh_road_bridge%2F); [Warorot market (mychiangmaitour)](https://mychiangmaitour.com/warorot_market/); [Three Kings Monument (nomads-travel-guide)](https://www.nomads-travel-guide.com/places/the-three-kings-monument/)
- [Wikipedia: Shophouse](https://en.wikipedia.org/wiki/Shophouse); [KMUTT: Bangkok Shophouse study](https://soad.kmutt.ac.th/wp-content/uploads/2018/10/2011IntC2.pdf)
- [Wikipedia: Songthaew](https://en.wikipedia.org/wiki/Songthaew); [Changpuak: Sand chedis and tung](https://changpuakmagazine.com/en-article/SAND-CHEDIS-AND-TUNG/871804/); [InterContinental: Songkran 2026](https://chiangmai.intercontinental.com/en/blog/songkran-chiang-mai-2026-travel-guide); [Thai Massage Clinic: moat fountains](https://thaimassage.clinic/the-old-city-moat-in-chiang-mai/)
- OSM counts: Overpass (overpass.kumi.systems mirror) plus the repo's `data-raw/` extracts, © OpenStreetMap contributors (ODbL).

### Critical files for implementation
- /Users/jason/coderepos/tuktuk/scripts/fetch-osm.mjs
- /Users/jason/coderepos/tuktuk/scripts/build-map.mjs
- /Users/jason/coderepos/tuktuk/src/content/paints.ts
- /Users/jason/coderepos/tuktuk/src/content/archetypes.ts
- /Users/jason/coderepos/tuktuk/src/content/landmarks.json
