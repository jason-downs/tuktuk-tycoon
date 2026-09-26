// Downloads the raw OpenStreetMap extracts for the game area from the Overpass
// API into data-raw/. build-map.mjs turns them into the compact files the game
// loads. Data © OpenStreetMap contributors, ODbL.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { BBOX, PLAY_BBOX } from './bbox.mjs';

// Default is the main instance; OVERPASS_URL selects a mirror serving the same
// OSM database (e.g. https://overpass.kumi.systems/api/interpreter).
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'tuktuk-tycoon-map-builder/0.1 (+https://github.com/)';
const OUT_DIR = new URL('../data-raw/', import.meta.url);

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
// The 3D detail extracts cover the playable area plus a 300 m margin.
const c = `${PLAY_BBOX.south - 0.003},${PLAY_BBOX.west - 0.003},${PLAY_BBOX.north + 0.003},${PLAY_BBOX.east + 0.003}`;

const QUERIES = {
  roads: `
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]
       ["area"!="yes"]["access"!~"^(private|no)$"]
       ["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"](${b});
    out body geom;`,
  water: `
    (
      way["natural"="water"](${b}); relation["natural"="water"](${b});
      way["waterway"~"^(river|canal|stream|riverbank|dock)$"](${b}); relation["waterway"="riverbank"](${b});
      way["landuse"~"^(reservoir|basin)$"](${b});
    );
    out body geom;`,
  green: `
    (
      way["leisure"~"^(park|golf_course|garden|stadium|pitch|nature_reserve)$"](${b});
      relation["leisure"~"^(park|golf_course|nature_reserve)$"](${b});
      way["landuse"~"^(grass|forest|recreation_ground|meadow|cemetery|farmland|orchard|village_green)$"](${b});
      way["natural"~"^(wood|scrub|grassland)$"](${b});
    );
    out body geom;`,
  forest: `
    (
      relation["landuse"~"^(forest|grass|recreation_ground)$"](${b});
      relation["natural"~"^(wood|scrub)$"](${b});
    );
    out body geom(${b});`,
  landuse: `
    (
      way["amenity"~"^(place_of_worship|university|college|school|hospital|marketplace)$"](${b});
      relation["amenity"~"^(place_of_worship|university|college|hospital)$"](${b});
      way["aeroway"~"^(runway|taxiway|apron|terminal)$"](${b});
      way["railway"~"^(rail|platform)$"](${b});
      way["barrier"="city_wall"](${b}); way["historic"~"^(city_?walls?|citywalls)$"](${b});
    );
    out body geom;`,
  buildings: `
    way["building"](${b});
    out geom;`,
  buildings3d: `
    (
      way["building"](${c}); relation["building"](${c});
      way["building:part"](${c}); relation["building:part"](${c});
    );
    out body geom;`,
  trees: `
    (
      node["natural"="tree"](${c});
      way["natural"="tree_row"](${c});
    );
    out body geom;`,
  barriers: `
    (
      way["barrier"~"^(wall|fence|retaining_wall|hedge|city_wall|guard_rail)$"](${c});
      node["barrier"~"^(gate|bollard|lift_gate)$"](${c});
    );
    out body geom;`,
  furniture: `
    (
      node["highway"~"^(street_lamp|traffic_signals|crossing|bus_stop|stop|give_way)$"](${c});
      node["power"~"^(pole|tower|transformer)$"](${c});
      way["power"~"^(line|minor_line|cable)$"](${c});
      node["amenity"~"^(bench|fountain|atm|vending_machine|telephone|motorcycle_parking|shelter|toilets|drinking_water|waste_basket)$"](${c});
      way["amenity"~"^(fountain|shelter|motorcycle_parking|parking)$"](${c});
      node["man_made"~"^(flagpole|water_tower|mast|street_cabinet|storage_tank)$"](${c});
      nwr["tourism"="artwork"](${c});
      nwr["historic"~"^(memorial|monument|wayside_shrine)$"](${c});
    );
    out body geom;`,
  paths: `
    (
      way["highway"~"^(footway|pedestrian|path|steps|cycleway)$"](${c});
      way["area:highway"](${c});
      way["man_made"~"^(bridge|pier|embankment)$"](${c});
    );
    out body geom;`,
  landcover3d: `
    (
      way["landuse"~"^(residential|commercial|retail|industrial|construction|railway|religious)$"](${c});
      way["amenity"~"^(parking|fuel|marketplace|school|hospital|university|college|place_of_worship|bus_station)$"](${c});
      relation["amenity"~"^(marketplace|school|hospital|university|place_of_worship)$"](${c});
      way["leisure"~"^(swimming_pool|playground|garden|park|pitch)$"](${c});
      way["place"="square"](${c});
    );
    out body geom;`,
  shopfronts: `
    (
      node["shop"](${c});
      node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|bank|pharmacy|clinic|massage)$"](${c});
      node["tourism"~"^(hotel|hostel|guest_house)$"](${c});
      node["craft"](${c});
      node["shop"="massage"](${c});
    );
    out body;`,
  pois: `
    (
      nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment|attraction|museum|viewpoint|zoo|theme_park|gallery)$"]["name"](${b});
      nwr["amenity"~"^(marketplace|hospital|clinic|university|college|school|bus_station|fuel|place_of_worship|cafe|restaurant|bar|pub|nightclub|cinema|theatre|police|townhall|arts_centre|library|food_court)$"]["name"](${b});
      nwr["shop"~"^(mall|department_store|supermarket)$"]["name"](${b});
      nwr["railway"~"^(station|halt)$"]["name"](${b});
      nwr["aeroway"~"^(terminal|aerodrome)$"]["name"](${b});
      nwr["leisure"~"^(park|stadium|sports_centre|water_park)$"]["name"](${b});
      nwr["historic"]["name"](${b});
      nwr["amenity"="fuel"](${b});
    );
    out center tags;`,
};

async function exists(url) {
  try {
    await stat(url);
    return true;
  } catch {
    return false;
  }
}

async function runQuery(name, body) {
  const target = new URL(`${name}.json`, OUT_DIR);
  if (!process.argv.includes('--force') && (await exists(target))) {
    console.log(`${name}: cached (pass --force to refetch)`);
    return;
  }
  const query = `[out:json][timeout:90][maxsize:134217728];${body}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`${name}: requesting (attempt ${attempt})…`);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ data: query }),
    });
    const text = await res.text();
    if (res.ok && text.trimStart().startsWith('{')) {
      const parsed = JSON.parse(text);
      await writeFile(target, text);
      console.log(`${name}: ${parsed.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB`);
      return;
    }
    const reason = (text.match(/Error<\/strong>:([^<]*)/) ?? [, text.slice(0, 200)])[1].trim();
    console.warn(`${name}: HTTP ${res.status} ${reason}`);
    if (![429, 502, 503, 504].includes(res.status) && res.ok) break;
    await new Promise((r) => setTimeout(r, 45_000 * attempt));
  }
  throw new Error(`${name}: Overpass request failed`);
}

await mkdir(OUT_DIR, { recursive: true });
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const [name, body] of Object.entries(QUERIES)) {
  if (only.length && !only.includes(name)) continue;
  await runQuery(name, body);
}
