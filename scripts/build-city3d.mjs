// Bakes the semantic data the 3D world is generated from: roads with their
// attributes, building footprints with the tags that shape them, land cover,
// water, linear features (walls, rail, runway, power lines), trees and street
// furniture, for the playable area plus a margin. Output: public/data/city3d.json.
//
// Coordinates are sim metres (x east, y north) around the road graph's origin,
// stored as integer decimetres. Meshes are generated from this at runtime
// (src/world3d/build), so art direction can change without re-baking.
// Data © OpenStreetMap contributors, ODbL.
import { readFile, writeFile, stat } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
import { PLAY_BBOX } from './bbox.mjs';
import { carriagewayWidth } from './roadWidth.mjs';

const RAW = new URL(process.env.DATA_RAW ? `file://${process.env.DATA_RAW.replace(/\/?$/, '/')}` : '../data-raw/', import.meta.url);
const OUT = new URL('../public/data/city3d.json', import.meta.url);
const GRAPH = new URL('../public/data/graph.json', import.meta.url);

/** Features are kept if they touch the playable area grown by this margin (metres). */
const MARGIN = 350;

const graphJson = JSON.parse(await readFile(GRAPH, 'utf8'));
const ORIGIN = graphJson.origin;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const toXY = (lon, lat) => [(lon - ORIGIN.lon) * M_PER_DEG_LON, (lat - ORIGIN.lat) * M_PER_DEG_LAT];
const dm = (v) => Math.round(v * 10);

const [px0, py0] = toXY(PLAY_BBOX.west, PLAY_BBOX.south);
const [px1, py1] = toXY(PLAY_BBOX.east, PLAY_BBOX.north);
const PLAY = { x0: px0, y0: py0, x1: px1, y1: py1 };
const KEEP = { x0: px0 - MARGIN, y0: py0 - MARGIN, x1: px1 + MARGIN, y1: py1 + MARGIN };
const inKeep = (x, y) => x >= KEEP.x0 && x <= KEEP.x1 && y >= KEEP.y0 && y <= KEEP.y1;

async function loadRaw(name) {
  const url = new URL(`${name}.json`, RAW);
  try {
    await stat(url);
  } catch {
    throw new Error(`data-raw/${name}.json missing — run npm run map:fetch (set DATA_RAW to point at another checkout's data-raw)`);
  }
  return JSON.parse(await readFile(url, 'utf8'));
}

// ------------------------------------------------------------------ strings
const strings = [''];
const stringIdx = new Map([['', 0]]);
const str = (s) => {
  if (!s) return 0;
  if (!stringIdx.has(s)) {
    stringIdx.set(s, strings.length);
    strings.push(s);
  }
  return stringIdx.get(s);
};

// ------------------------------------------------------------------ geometry
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = points[s];
    const [bx, by] = points[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const [qx, qy] = points[i];
      let t = ((qx - ax) * dx + (qy - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - qx;
      const ey = ay + t * dy - qy;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol2) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const ringXY = (coords) => coords.map(([lon, lat]) => toXY(lon, lat));
const flat = (pts) => pts.flatMap(([x, y]) => [dm(x), dm(y)]);
const touchesKeep = (pts) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x1 >= KEEP.x0 && x0 <= KEEP.x1 && y1 >= KEEP.y0 && y0 <= KEEP.y1;
};

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Drop the closing duplicate vertex, simplify, and orient: polygonArea is
 * negative for counter-clockwise rings, so rings come out clockwise (x east,
 * y north) and hole rings, reversed after cleaning, counter-clockwise.
 */
function cleanRing(pts, tol) {
  let ring = pts.slice();
  if (ring.length > 1) {
    const [a, b] = [ring[0], ring[ring.length - 1]];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) ring.pop();
  }
  if (ring.length > 3) {
    const closed = simplify([...ring, ring[0]], tol);
    ring = closed.slice(0, -1);
  }
  if (ring.length < 3) return null;
  if (polygonArea(ring) < 0) ring.reverse();
  return ring;
}

/** Oriented bounding box: long side length L, short side W, angle of the long side (rad). */
function obb(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const ang = Math.atan2(by - ay, bx - ax);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of ring) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, a: u1 - u0, b: v1 - v0, ang };
  }
  if (best.a >= best.b) return { L: best.a, W: best.b, ang: best.ang, area: best.area };
  return { L: best.b, W: best.a, ang: best.ang + Math.PI / 2, area: best.area };
}

// ------------------------------------------------------------------ roads
const ROAD_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
const classOf = (hw) => {
  const base = hw.replace(/_link$/, '');
  const i = ROAD_CLASSES.indexOf(base === 'motorway' ? 'trunk' : base);
  return i < 0 ? ROAD_CLASSES.indexOf('service') : i;
};

export const ROAD_FLAG = {
  ONEWAY: 1,
  BRIDGE: 2,
  TUNNEL: 4,
  ROUNDABOUT: 8,
  LINK: 16,
  SIDEWALK_L: 32,
  SIDEWALK_R: 64,
  LIT: 128,
};
const SURFACES = ['asphalt', 'concrete', 'paving_stones', 'unpaved'];
const surfaceOf = (s) => {
  if (!s || s === 'asphalt') return 0;
  if (/concrete/.test(s)) return 1;
  if (/paving|sett|brick|cobble/.test(s)) return 2;
  if (/unpaved|gravel|dirt|ground|compacted|sand|grass/.test(s)) return 3;
  return 0;
};

function bakeRoads(raw) {
  const nodeIdx = new Map();
  const nodes = [];
  const ways = [];
  for (const w of raw.elements) {
    if (w.type !== 'way' || !w.geometry || w.nodes.length < 2) continue;
    const pts = w.geometry.map((g) => toXY(g.lon, g.lat));
    if (!pts.some(([x, y]) => inKeep(x, y))) continue;
    const t = w.tags;
    const cls = classOf(t.highway);
    let flags = 0;
    let ids = w.nodes;
    let geom = pts;
    const ow = t.oneway;
    if (ow === 'yes' || ow === 'true' || ow === '1' || t.junction === 'roundabout') flags |= ROAD_FLAG.ONEWAY;
    if (ow === '-1' || ow === 'reverse') {
      flags |= ROAD_FLAG.ONEWAY;
      ids = [...ids].reverse();
      geom = [...geom].reverse();
    }
    if (t.bridge && t.bridge !== 'no') flags |= ROAD_FLAG.BRIDGE;
    if (t.tunnel && t.tunnel !== 'no') flags |= ROAD_FLAG.TUNNEL;
    if (t.junction === 'roundabout' || t.junction === 'circular') flags |= ROAD_FLAG.ROUNDABOUT;
    if (/_link$/.test(t.highway)) flags |= ROAD_FLAG.LINK;
    const sw = t.sidewalk ?? t['sidewalk:both'];
    if (sw === 'both' || sw === 'yes' || sw === 'separate') flags |= ROAD_FLAG.SIDEWALK_L | ROAD_FLAG.SIDEWALK_R;
    if (sw === 'left' || t['sidewalk:left'] === 'yes') flags |= ROAD_FLAG.SIDEWALK_L;
    if (sw === 'right' || t['sidewalk:right'] === 'yes') flags |= ROAD_FLAG.SIDEWALK_R;
    if (t.lit === 'yes') flags |= ROAD_FLAG.LIT;
    const lanes = Math.max(0, Math.min(8, parseInt(t.lanes, 10) || 0));
    const width = carriagewayWidth(t, cls, lanes);
    const layer = Math.max(-2, Math.min(3, parseInt(t.layer, 10) || 0));
    const refs = ids.map((id, i) => {
      let n = nodeIdx.get(id);
      if (n === undefined) {
        n = nodes.length / 2;
        nodeIdx.set(id, n);
        nodes.push(dm(geom[i][0]), dm(geom[i][1]));
      }
      return n;
    });
    ways.push([cls, flags, dm(width), lanes, str(t['name:en'] || t.name), surfaceOf(t.surface), layer, ...refs]);
  }
  console.log(`roads: ${ways.length} ways, ${nodes.length / 2} nodes`);
  return { nodes, ways, classes: ROAD_CLASSES, surfaces: SURFACES };
}

// ------------------------------------------------------------------ areas & lines
const AREA_KINDS = [
  'water',
  'moat',
  'river',
  'pool',
  'park',
  'garden',
  'pitch',
  'forest',
  'grass',
  'rural',
  'cemetery',
  'golf',
  'temple',
  'worship',
  'campus',
  'school',
  'hospital',
  'market',
  'parking',
  'fuel',
  'plaza',
  'apron',
  'residential',
  'commercial',
  'retail',
  'industrial',
  'railway',
  'construction',
  'playground',
];
const LINE_KINDS = ['river', 'canal', 'stream', 'drain', 'rail', 'runway', 'taxiway', 'city_wall', 'wall', 'fence', 'hedge', 'power', 'footway', 'steps', 'tree_row'];

function areaKind(t) {
  if (t.water === 'moat' || /moat|คูเมือง/i.test(t.name ?? '') || /moat/i.test(t['name:en'] ?? '')) return 'moat';
  if (t.water === 'river' || t.waterway === 'riverbank' || /Ping|ปิง/.test(t.name ?? '')) return t.natural === 'water' || t.waterway === 'riverbank' ? 'river' : null;
  if (t.leisure === 'swimming_pool') return 'pool';
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'dock') return 'water';
  if (t.amenity === 'place_of_worship' || t.landuse === 'religious') return t.religion === 'buddhist' || !t.religion ? 'temple' : 'worship';
  if (t.amenity === 'university' || t.amenity === 'college') return 'campus';
  if (t.amenity === 'school') return 'school';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'marketplace') return 'market';
  if (t.amenity === 'parking') return 'parking';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.amenity === 'bus_station' || t.place === 'square' || t.highway === 'pedestrian' || t['area:highway']) return 'plaza';
  if (t.aeroway === 'apron') return 'apron';
  if (t.leisure === 'park' || t.leisure === 'nature_reserve') return 'park';
  if (t.leisure === 'garden') return 'garden';
  if (t.leisure === 'pitch' || t.leisure === 'stadium') return 'pitch';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.landuse === 'grass' || t.landuse === 'village_green' || t.landuse === 'recreation_ground' || t.natural === 'grassland') return 'grass';
  if (t.landuse === 'meadow' || t.landuse === 'farmland' || t.landuse === 'orchard' || t.natural === 'scrub') return 'rural';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (['residential', 'commercial', 'retail', 'industrial', 'railway', 'construction'].includes(t.landuse)) return t.landuse;
  return null;
}

function lineKind(t) {
  if (t.waterway === 'river') return 'river';
  if (t.waterway === 'canal') return 'canal';
  if (t.waterway === 'stream') return 'stream';
  if (t.waterway === 'drain' || t.waterway === 'ditch') return 'drain';
  if (t.railway === 'rail') return 'rail';
  if (t.aeroway === 'runway') return 'runway';
  if (t.aeroway === 'taxiway') return 'taxiway';
  if (t.barrier === 'city_wall' || /city_?walls?/.test(t.historic ?? '')) return 'city_wall';
  if (t.barrier === 'wall' || t.barrier === 'retaining_wall') return 'wall';
  if (t.barrier === 'fence' || t.barrier === 'guard_rail') return 'fence';
  if (t.barrier === 'hedge') return 'hedge';
  if (t.power === 'line' || t.power === 'minor_line') return 'power';
  if (t.highway === 'steps') return 'steps';
  if (['footway', 'path', 'pedestrian', 'cycleway'].includes(t.highway) && t.area !== 'yes') return 'footway';
  if (t.natural === 'tree_row') return 'tree_row';
  return null;
}

const osmIdOf = (t) => Number(String(t.id).replace(/\D/g, '')) % 2147483647;

function bakeAreasAndLines(raws) {
  const areas = [];
  const lines = [];
  // City-wall remnants, gate towers and bastions are mapped as closed areas.
  const cityWalls = [];
  const seen = new Set();
  for (const raw of raws) {
    const gj = osmtogeojson(raw, { flatProperties: true });
    for (const f of gj.features) {
      const t = f.properties;
      const key = t.id;
      if (!f.geometry || f.geometry.type === 'Point') continue;
      const g = f.geometry;
      if (g.type === 'Polygon' && t.barrier === 'city_wall') {
        if (seen.has(`w${key}`)) continue;
        seen.add(`w${key}`);
        const ring = cleanRing(ringXY(g.coordinates[0]), 0.3);
        if (!ring || !touchesKeep(ring)) continue;
        const rec = { r: flat(ring), id: osmIdOf(t) };
        const name = t['name:en'] || t.name;
        if (name) rec.n = str(name);
        cityWalls.push(rec);
        continue;
      }
      if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && !t.building && !t['building:part']) {
        const kind = areaKind(t);
        if (!kind) continue;
        if (seen.has(`a${key}`)) continue;
        seen.add(`a${key}`);
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) {
          const outer = cleanRing(ringXY(poly[0]), kind === 'moat' || kind === 'river' ? 0.6 : 1.2);
          if (!outer || !touchesKeep(outer)) continue;
          const holes = poly
            .slice(1)
            .map((r) => cleanRing(ringXY(r), 1.2))
            .filter(Boolean)
            .map((h) => flat(h.reverse()));
          const rec = { k: AREA_KINDS.indexOf(kind), r: flat(outer) };
          if (holes.length) rec.h = holes;
          const name = t['name:en'] || t.name;
          if (name && ['temple', 'worship', 'park', 'market', 'campus', 'school', 'hospital', 'moat', 'river', 'water'].includes(kind)) rec.n = str(name);
          // OSM ids and religions let the 3D landmarks find their grounds and markets.
          if (['temple', 'worship', 'market', 'retail', 'plaza'].includes(kind)) {
            rec.id = osmIdOf(t);
            if (t.religion) rec.rel = str(t.religion);
          }
          areas.push(rec);
        }
      } else if (g.type === 'LineString' || g.type === 'MultiLineString' || g.type === 'Polygon') {
        const kind = lineKind(t);
        if (!kind) continue;
        if (seen.has(`l${key}`)) continue;
        seen.add(`l${key}`);
        const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates;
        for (const part of parts) {
          const pts = simplify(ringXY(part), 0.8);
          if (pts.length < 2 || !touchesKeep(pts)) continue;
          const rec = { k: LINE_KINDS.indexOf(kind), p: flat(pts) };
          const w = parseFloat(t.width);
          if (w > 0 && w < 100) rec.w = dm(w);
          if (kind === 'city_wall' && g.type === 'Polygon') rec.closed = 1;
          lines.push(rec);
        }
      }
    }
  }
  const counts = {};
  for (const a of areas) counts[AREA_KINDS[a.k]] = (counts[AREA_KINDS[a.k]] ?? 0) + 1;
  const lcounts = {};
  for (const l of lines) lcounts[LINE_KINDS[l.k]] = (lcounts[LINE_KINDS[l.k]] ?? 0) + 1;
  console.log('areas:', counts);
  console.log('lines:', lcounts);
  console.log(`city walls: ${cityWalls.length}`);
  return { areas, lines, cityWalls };
}

// ------------------------------------------------------------------ buildings
const ROOF_SHAPES = ['', 'flat', 'gabled', 'hipped', 'pyramidal', 'skillion', 'dome', 'onion', 'round', 'half-hipped', 'gambrel', 'mansard'];
export const BUILDING_FLAG = { PART: 1, TEMPLE_GROUND: 2, SHOPFRONT: 4, HAS_NAME: 8 };

function levelsOf(t) {
  const v = parseFloat(t['building:levels']);
  return v > 0 && v < 80 ? v : 0;
}

function heightOf(t) {
  const v = parseFloat(String(t.height ?? '').replace(/m$/, ''));
  return v > 1 && v < 250 ? v : 0;
}

function bakeBuildings(raw, roads, templeGrounds, zoneOf) {
  const gj = osmtogeojson(raw, { flatProperties: true });
  // Segment index of road centrelines for street-front detection.
  const CELL = 40;
  const segGrid = new Map();
  const rn = roads.nodes;
  roads.ways.forEach((w, wi) => {
    const refs = w.slice(7);
    for (let i = 1; i < refs.length; i++) {
      const ax = rn[2 * refs[i - 1]] / 10;
      const ay = rn[2 * refs[i - 1] + 1] / 10;
      const bx = rn[2 * refs[i]] / 10;
      const by = rn[2 * refs[i] + 1] / 10;
      const x0 = Math.floor(Math.min(ax, bx) / CELL);
      const x1 = Math.floor(Math.max(ax, bx) / CELL);
      const y0 = Math.floor(Math.min(ay, by) / CELL);
      const y1 = Math.floor(Math.max(ay, by) / CELL);
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = `${cx},${cy}`;
          if (!segGrid.has(k)) segGrid.set(k, []);
          segGrid.get(k).push([ax, ay, bx, by, wi]);
        }
    }
  });
  const nearestRoad = (x, y) => {
    let best = null;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const [ax, ay, bx, by, wi] of segGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const vx = bx - ax;
          const vy = by - ay;
          const l2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
          const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
          if (!best || d < best.d) best = { d, ang: Math.atan2(vy, vx), wi };
        }
      }
    return best;
  };

  const out = [];
  let skipped = 0;
  for (const f of gj.features) {
    const t = f.properties;
    if (!t.building && !t['building:part']) continue;
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const ring = cleanRing(ringXY(poly[0]), 0.35);
      if (!ring) continue;
      const area = polygonArea(ring);
      if (area < 6) {
        skipped++;
        continue;
      }
      let cx = 0;
      let cy = 0;
      for (const [x, y] of ring) {
        cx += x;
        cy += y;
      }
      cx /= ring.length;
      cy /= ring.length;
      if (!inKeep(cx, cy)) continue;
      const box = obb(ring);
      // Street front: the ring edge ≥ 3 m long nearest a road and most parallel to it.
      let front = -1;
      let frontScore = Infinity;
      let frontRoad = -1;
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 3) continue;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const road = nearestRoad(mx, my);
        if (!road || road.d > 15) continue;
        const par = Math.abs(Math.cos(Math.atan2(by - ay, bx - ax) - road.ang));
        const score = road.d - 2 * par;
        if (score < frontScore) {
          frontScore = score;
          front = i;
          frontRoad = road.wi;
        }
      }
      let temple = -1;
      for (let i = 0; i < templeGrounds.length; i++) {
        const g = templeGrounds[i];
        if (cx < g.x0 || cx > g.x1 || cy < g.y0 || cy > g.y1) continue;
        if (pointInRing(cx, cy, g.ring)) {
          temple = i;
          break;
        }
      }
      const holes = poly
        .slice(1)
        .map((r) => cleanRing(ringXY(r), 0.35))
        .filter(Boolean)
        .map((h) => flat(h.reverse()));
      const rec = {
        r: flat(ring),
        b: str(t.building ?? (t['building:part'] ? `part:${t['building:part']}` : 'yes')),
        z: zoneOf(cx, cy),
        a: Math.round(area),
        o: [dm(box.L), dm(box.W), Math.round(box.ang * 1000)],
      };
      if (holes.length) rec.h = holes;
      const lv = levelsOf(t);
      if (lv) rec.l = lv;
      const minLv = parseFloat(t['building:min_level']);
      if (minLv > 0) rec.ml = minLv;
      const ht = heightOf(t);
      if (ht) rec.ht = dm(ht);
      const minH = parseFloat(t.min_height);
      if (minH > 0) rec.mh = dm(minH);
      const roof = ROOF_SHAPES.indexOf(t['roof:shape'] ?? '');
      if (roof > 0) rec.rs = roof;
      if (t['roof:colour']) rec.rc = str(t['roof:colour']);
      if (t['building:colour']) rec.c = str(t['building:colour']);
      if (t['building:material']) rec.m = str(t['building:material']);
      if (front >= 0) {
        rec.f = front;
        rec.fr = frontRoad;
      }
      if (temple >= 0) rec.t = temple;
      const use = t.amenity || t.shop || t.tourism || t.man_made || t.historic || t.leisure || t.office || t.healthcare;
      if (use) rec.u = str(use);
      if (t.religion) rec.rel = str(t.religion);
      if (t['tower:type']) rec.tt = str(t['tower:type']);
      const name = t['name:en'] || t.name;
      if (name) rec.n = str(name);
      if (t['building:part']) rec.part = 1;
      rec.id = Number(String(t.id).replace(/\D/g, '')) % 2147483647;
      out.push(rec);
    }
  }
  console.log(`buildings: ${out.length} (skipped ${skipped} slivers), with front ${out.filter((b) => b.f !== undefined).length}, in temple grounds ${out.filter((b) => b.t !== undefined).length}`);
  return out;
}

// ------------------------------------------------------------------ points
function bakePoints(trees, furniture, shopfronts) {
  const treeOut = [];
  const species = [''];
  const sp = (s) => {
    if (!s) return 0;
    let i = species.indexOf(s);
    if (i < 0) {
      i = species.length;
      species.push(s);
    }
    return i;
  };
  for (const e of trees.elements) {
    if (e.type !== 'node') continue;
    const [x, y] = toXY(e.lon, e.lat);
    if (!inKeep(x, y)) continue;
    const t = e.tags ?? {};
    treeOut.push(dm(x), dm(y), sp(t.species || t.genus || t.leaf_type));
  }
  const props = [];
  const PROP_KINDS = [];
  const pk = (k) => {
    let i = PROP_KINDS.indexOf(k);
    if (i < 0) {
      i = PROP_KINDS.length;
      PROP_KINDS.push(k);
    }
    return i;
  };
  for (const e of furniture.elements) {
    if (e.type !== 'node') continue;
    const t = e.tags ?? {};
    const k = t.highway || (t.power && `power_${t.power}`) || t.amenity || t.man_made || (t.tourism === 'artwork' && 'artwork') || t.historic;
    if (!k) continue;
    const [x, y] = toXY(e.lon, e.lat);
    if (!inKeep(x, y)) continue;
    props.push(pk(k), dm(x), dm(y));
  }
  const shops = [];
  const SHOP_KINDS = [];
  const sk = (k) => {
    let i = SHOP_KINDS.indexOf(k);
    if (i < 0) {
      i = SHOP_KINDS.length;
      SHOP_KINDS.push(k);
    }
    return i;
  };
  for (const e of shopfronts.elements) {
    if (e.type !== 'node') continue;
    const t = e.tags ?? {};
    const k = t.shop ? `shop:${t.shop}` : t.amenity ? t.amenity : t.tourism ? t.tourism : t.craft ? 'craft' : null;
    if (!k) continue;
    const [x, y] = toXY(e.lon, e.lat);
    if (!inKeep(x, y)) continue;
    shops.push(sk(k), dm(x), dm(y), str(t['name:en'] || t.name));
  }
  console.log(`trees ${treeOut.length / 3}, props ${props.length / 3}, shopfronts ${shops.length / 4}`);
  return { trees: treeOut, species, props, propKinds: PROP_KINDS, shops, shopKinds: SHOP_KINDS };
}

// ------------------------------------------------------------------ zones
// District polygons (lon/lat corners) used to vary building style. The Old
// City is the moat square; its corners are the four bastions (landmarks.md).
const ZONE_NAMES = ['suburb', 'old_city', 'moat_ring', 'tha_phae', 'night_bazaar', 'chinatown', 'riverside', 'wat_ket', 'nimman', 'santitham', 'suan_dok', 'chang_phueak', 'wua_lai', 'airport'];
const OLD_CITY = [
  [98.97902, 18.79633],
  [98.99414, 18.79594],
  [98.99365, 18.78116],
  [98.97794, 18.78133],
].map(([lon, lat]) => toXY(lon, lat));
const ZONE_BOXES = [
  // [zone, west, south, east, north]
  ['tha_phae', 98.9935, 18.7845, 99.0005, 18.791],
  ['night_bazaar', 98.9975, 18.7795, 99.0035, 18.7885],
  ['chinatown', 99.0, 18.788, 99.0035, 18.7935],
  ['riverside', 99.0005, 18.776, 99.006, 18.797],
  ['wat_ket', 99.006, 18.781, 99.0145, 18.8],
  ['nimman', 98.9635, 18.7935, 98.9735, 18.8055],
  ['santitham', 98.9735, 18.7975, 98.986, 18.808],
  ['suan_dok', 98.9555, 18.7825, 98.9735, 18.7935],
  ['chang_phueak', 98.98, 18.7975, 98.992, 18.808],
  ['wua_lai', 98.9795, 18.7715, 98.9935, 18.7815],
  ['airport', 98.9555, 18.762, 98.976, 18.7765],
].map(([z, w, s, e, n]) => {
  const [x0, y0] = toXY(w, s);
  const [x1, y1] = toXY(e, n);
  return { z: ZONE_NAMES.indexOf(z), x0, y0, x1, y1 };
});
function zoneOf(x, y) {
  if (pointInRing(x, y, OLD_CITY)) return ZONE_NAMES.indexOf('old_city');
  for (const b of ZONE_BOXES) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b.z;
  // A 45 m ring outside the moat square.
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = OLD_CITY[i];
    const [bx, by] = OLD_CITY[(i + 1) % 4];
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    d = Math.min(d, Math.hypot(ax + vx * t - x, ay + vy * t - y));
  }
  if (d < 45) return ZONE_NAMES.indexOf('moat_ring');
  return 0;
}

// ------------------------------------------------------------------ main
const roadsRaw = await loadRaw('roads');
const roads = bakeRoads(roadsRaw);
const areaRaws = await Promise.all(['water', 'green', 'forest', 'landuse', 'landcover3d', 'barriers', 'paths', 'trees', 'furniture'].map(loadRaw));
const { areas, lines, cityWalls } = bakeAreasAndLines(areaRaws);
const templeGrounds = areas
  .filter((a) => AREA_KINDS[a.k] === 'temple')
  .map((a) => {
    const ring = [];
    for (let i = 0; i < a.r.length; i += 2) ring.push([a.r[i] / 10, a.r[i + 1] / 10]);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return { ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), area: a };
  });
// Temple indices in buildings refer to this list, in the same order as the temple areas.
areas.forEach((a) => {
  if (AREA_KINDS[a.k] === 'temple') a.ti = templeGrounds.findIndex((g) => g.area === a);
});
const buildings = bakeBuildings(await loadRaw('buildings3d'), roads, templeGrounds, zoneOf);
const points = bakePoints(areaRaws[7], areaRaws[8], await loadRaw('shopfronts'));

const out = {
  version: 1,
  origin: ORIGIN,
  play: [dm(PLAY.x0), dm(PLAY.y0), dm(PLAY.x1), dm(PLAY.y1)],
  keep: [dm(KEEP.x0), dm(KEEP.y0), dm(KEEP.x1), dm(KEEP.y1)],
  strings,
  zones: ZONE_NAMES,
  areaKinds: AREA_KINDS,
  lineKinds: LINE_KINDS,
  roofShapes: ROOF_SHAPES,
  roads,
  areas,
  lines,
  cityWalls,
  buildings,
  ...points,
};
const text = JSON.stringify(out);
await writeFile(OUT, text);
console.log(`wrote public/data/city3d.json (${(text.length / 1e6).toFixed(2)} MB)`);
