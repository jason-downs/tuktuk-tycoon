// Downloads the raw OpenStreetMap extracts for the game area from the Overpass
// API into data-raw/. build-map.mjs turns them into the compact files the game
// loads. Data © OpenStreetMap contributors, ODbL.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { BBOX } from './bbox.mjs';

// Default is the main instance; OVERPASS_URL selects a mirror serving the same
// OSM database (e.g. https://overpass.kumi.systems/api/interpreter).
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'tuktuk-tycoon-map-builder/0.1 (+https://github.com/)';
const OUT_DIR = new URL('../data-raw/', import.meta.url);

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

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
