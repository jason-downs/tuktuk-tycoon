// Turns the raw Overpass extracts in data-raw/ into the files the game loads
// from public/data/:
//   graph.json      routable road graph (largest strongly connected component)
//   roads.geojson   every road way, for drawing and street labels
//   <layer>.geojson water, green, landuse, forest and building layers
//   pois.json       named places that produce and receive passengers
// Coordinates in graph.json and pois.json are local metres (x east, y north)
// around ORIGIN; the GeoJSON files keep longitude/latitude.
// Data © OpenStreetMap contributors, ODbL.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
import { BBOX, PLAY_BBOX } from './bbox.mjs';

const RAW = new URL('../data-raw/', import.meta.url);
// MAP_OUT writes elsewhere (e.g. to preview a rebuild without touching public/data).
const OUT = process.env.MAP_OUT ? new URL(`file://${process.env.MAP_OUT.replace(/\/?$/, '/')}`) : new URL('../public/data/', import.meta.url);

export const ORIGIN = {
  lat: (BBOX.south + BBOX.north) / 2,
  lon: (BBOX.west + BBOX.east) / 2,
};
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const toXY = (lon, lat) => [(lon - ORIGIN.lon) * M_PER_DEG_LON, (lat - ORIGIN.lat) * M_PER_DEG_LAT];
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Road classes, in drawing/priority order. Index is stored in graph.json.
const CLASSES = [
  'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
];
const classOf = (hw) => {
  const base = hw.replace(/_link$/, '');
  const i = CLASSES.indexOf(base === 'motorway' ? 'trunk' : base);
  return i < 0 ? CLASSES.indexOf('service') : i;
};

async function loadRaw(name) {
  const url = new URL(`${name}.json`, RAW);
  try {
    await stat(url);
  } catch {
    console.warn(`skip ${name}: data-raw/${name}.json missing (run npm run map:fetch)`);
    return null;
  }
  return JSON.parse(await readFile(url, 'utf8'));
}

// Douglas–Peucker on [x, y] points; keeps the endpoints.
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
      const [px, py] = points[i];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx - px;
      const qy = ay + t * dy - py;
      const d = qx * qx + qy * qy;
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

const inBbox = (lon, lat) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;

// ---------------------------------------------------------------- roads/graph
function onewayOf(tags) {
  const v = tags.oneway;
  if (v === 'yes' || v === 'true' || v === '1') return 1;
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'no') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

const nameOf = (tags) => tags['name:en'] || tags.name || '';

/** Tarjan's strongly connected components (iterative); returns the node set of the largest one. */
function largestScc(nodeCount, edges) {
  const out = Array.from({ length: nodeCount }, () => []);
  for (const e of edges) {
    out[e.a].push(e.b);
    if (!e.oneway) out[e.b].push(e.a);
  }
  const index = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const comp = new Int32Array(nodeCount).fill(-1);
  const stack = [];
  let counter = 0;
  let compCount = 0;
  for (let root = 0; root < nodeCount; root++) {
    if (index[root] !== -1) continue;
    const call = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (call.length) {
      const frame = call[call.length - 1];
      const v = frame[0];
      if (frame[1] < out[v].length) {
        const w = out[v][frame[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          call.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w]);
        }
      } else {
        call.pop();
        if (call.length) {
          const parent = call[call.length - 1][0];
          low[parent] = Math.min(low[parent], low[v]);
        }
        if (low[v] === index[v]) {
          let w;
          do {
            w = stack.pop();
            onStack[w] = 0;
            comp[w] = compCount;
          } while (w !== v);
          compCount++;
        }
      }
    }
  }
  const sizes = new Int32Array(compCount);
  for (let i = 0; i < nodeCount; i++) sizes[comp[i]]++;
  let best = 0;
  for (let c = 1; c < compCount; c++) if (sizes[c] > sizes[best]) best = c;
  const keep = new Uint8Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) if (comp[i] === best) keep[i] = 1;
  return { keep, components: compCount };
}

/** Road edges split at junctions, over the whole fetched area. */
function extractEdges(roads) {
  const ways = roads.elements.filter((w) => w.type === 'way' && w.nodes?.length >= 2);
  const use = new Map();
  for (const w of ways) {
    w.nodes.forEach((id, i) => {
      const bump = i === 0 || i === w.nodes.length - 1 ? 2 : 1;
      use.set(id, (use.get(id) ?? 0) + bump);
    });
  }
  const nodeIndex = new Map();
  const nodeXY = [];
  const nodeOf = (id, lon, lat) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodeXY.length;
      nodeIndex.set(id, i);
      nodeXY.push(toXY(lon, lat));
    }
    return i;
  };
  const names = [''];
  const nameIdx = new Map([['', 0]]);
  const internName = (nm) => {
    if (!nameIdx.has(nm)) {
      nameIdx.set(nm, names.length);
      names.push(nm);
    }
    return nameIdx.get(nm);
  };
  const edges = [];
  for (const w of ways) {
    const cls = classOf(w.tags.highway);
    let oneway = onewayOf(w.tags);
    let ids = w.nodes;
    let geom = w.geometry;
    if (oneway === -1) {
      ids = [...ids].reverse();
      geom = [...geom].reverse();
      oneway = 1;
    }
    const name = internName(nameOf(w.tags));
    const lanes = Math.max(0, Math.min(8, parseInt(w.tags.lanes, 10) || 0));
    let start = 0;
    for (let i = 1; i < ids.length; i++) {
      if (i === ids.length - 1 || use.get(ids[i]) > 1) {
        const pts = [];
        for (let k = start; k <= i; k++) pts.push(toXY(geom[k].lon, geom[k].lat));
        let len = 0;
        for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        const a = nodeOf(ids[start], geom[start].lon, geom[start].lat);
        const b = nodeOf(ids[i], geom[i].lon, geom[i].lat);
        if (a !== b && len > 0.5) edges.push({ a, b, cls, oneway, name, lanes, len, pts: simplify(pts, 1.0) });
        start = i;
      }
    }
  }
  return { nodeXY, edges, names };
}

/** Dijkstra over road length from a source node; returns distances. */
function dijkstra(nodeCount, edges, source) {
  const adj = Array.from({ length: nodeCount }, () => []);
  for (const e of edges) {
    adj[e.a].push([e.b, e.len]);
    if (!e.oneway) adj[e.b].push([e.a, e.len]);
  }
  const dist = new Float64Array(nodeCount).fill(Infinity);
  dist[source] = 0;
  // Binary heap of [dist, node].
  const heap = [[0, source]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const [w, len] of adj[v]) {
      if (d + len < dist[w]) {
        dist[w] = d + len;
        push([dist[w], w]);
      }
    }
  }
  return dist;
}

/** Roads of these classes (trunk…tertiary) crossing the play-area edge become portals. */
const PORTAL_MAX_CLASS = 3;
/** Crossings closer than this (m) are one portal (the two halves of a dual carriageway). */
const PORTAL_MERGE_M = 90;
/** Landmarks up to this far outside the play area snap to an in-area kerb instead of going off-map. */
export const SNAP_IN_M = 350;

/**
 * Builds the routable graph of the playable area. Roads are clipped at the
 * play-area edge; main roads crossing it become portals — a boundary node
 * where outbound traffic leaves and another where it comes back in, joined by
 * a hidden turnaround — through which out-of-town destinations are reached.
 */
function buildGraph(roads, landmarks) {
  const full = extractEdges(roads);
  // Keep the full network's main component for out-of-town distances.
  const fullScc = largestScc(full.nodeXY.length, full.edges);
  const fullEdges = full.edges.filter((e) => fullScc.keep[e.a] && fullScc.keep[e.b]);

  const [px0, py0] = toXY(PLAY_BBOX.west, PLAY_BBOX.south);
  const [px1, py1] = toXY(PLAY_BBOX.east, PLAY_BBOX.north);
  const inside = ([x, y]) => x >= px0 && x <= px1 && y >= py0 && y <= py1;

  // Clip polylines at the boundary; crossing points become boundary nodes.
  const nodeXY = full.nodeXY.map((p) => p.slice());
  const edges = [];
  const crossings = [];
  const segmentExit = (p, q) => {
    // Parametric intersection of segment p→q with the play rectangle's border (p inside, q outside).
    let best = 1;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    for (const [lim, axis] of [
      [px0, 0],
      [px1, 0],
      [py0, 1],
      [py1, 1],
    ]) {
      const d = axis === 0 ? dx : dy;
      if (Math.abs(d) < 1e-9) continue;
      const t = (lim - p[axis]) / d;
      if (t > 0 && t < best) {
        const x = p[0] + dx * t;
        const y = p[1] + dy * t;
        if (x >= px0 - 0.01 && x <= px1 + 0.01 && y >= py0 - 0.01 && y <= py1 + 0.01) best = t;
      }
    }
    return [p[0] + dx * best, p[1] + dy * best];
  };
  const polyLen = (pts) => {
    let l = 0;
    for (let k = 1; k < pts.length; k++) l += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    return l;
  };
  for (const e of fullEdges) {
    const aIn = inside(full.nodeXY[e.a]);
    const bIn = inside(full.nodeXY[e.b]);
    if (aIn && bIn) {
      edges.push(e);
      continue;
    }
    if (!aIn && !bIn) continue;
    // One end inside: keep the inside part up to the border.
    const pts = aIn ? e.pts : [...e.pts].reverse();
    const kept = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      if (inside(pts[k])) {
        kept.push(pts[k]);
        continue;
      }
      kept.push(segmentExit(pts[k - 1], pts[k]));
      break;
    }
    const boundary = nodeXY.length;
    nodeXY.push(kept[kept.length - 1]);
    const inner = aIn ? e.a : e.b;
    // Direction: an edge a→b leaving from inside a (oneway) is outbound.
    const clipped = aIn
      ? { ...e, a: e.a, b: boundary, pts: kept, len: polyLen(kept) }
      : { ...e, a: boundary, b: e.b, pts: [...kept].reverse(), len: polyLen(kept) };
    if (clipped.len < 0.5) continue;
    edges.push(clipped);
    crossings.push({
      node: boundary,
      inner,
      outside: aIn ? e.b : e.a,
      cls: e.cls,
      name: e.name,
      // two-way roads serve both directions; one-way roads only the one they point.
      outbound: !e.oneway || aIn,
      inbound: !e.oneway || !aIn,
      x: kept[kept.length - 1][0],
      y: kept[kept.length - 1][1],
    });
  }

  // Group main-road crossings into portals and add hidden turnarounds.
  const main = crossings.filter((c) => c.cls <= PORTAL_MAX_CLASS);
  const portals = [];
  for (const c of main) {
    let p = portals.find((q) => Math.hypot(q.x - c.x, q.y - c.y) < PORTAL_MERGE_M);
    if (!p) {
      p = { x: c.x, y: c.y, crossings: [], name: c.name, cls: c.cls };
      portals.push(p);
    }
    p.crossings.push(c);
    if (c.cls < p.cls || (!p.name && c.name)) {
      p.name = c.name;
      p.cls = c.cls;
    }
  }
  const portalOut = [];
  for (const p of portals) {
    const out = p.crossings.find((c) => c.outbound);
    const inn = p.crossings.find((c) => c.inbound);
    if (!out || !inn) continue;
    if (out.node !== inn.node) {
      // Hidden U-turn beyond the edge of the map.
      const a = nodeXY[out.node];
      const b = nodeXY[inn.node];
      edges.push({ a: out.node, b: inn.node, cls: p.cls, oneway: 1, name: p.name, lanes: 0, len: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), pts: [a, b], virtual: 1 });
    }
    portalOut.push({ name: p.name, out: out.node, in: inn.node, x: p.x, y: p.y, fullOut: out.outside, fullIn: inn.outside });
  }

  const scc = largestScc(nodeXY.length, edges);
  const remap = new Int32Array(nodeXY.length).fill(-1);
  const nodes = [];
  for (let i = 0; i < nodeXY.length; i++) {
    if (scc.keep[i]) {
      remap[i] = nodes.length / 2;
      nodes.push(round(nodeXY[i][0], 1), round(nodeXY[i][1], 1));
    }
  }
  const outEdges = [];
  let keptLen = 0;
  let inLen = 0;
  for (const e of edges) {
    if (!e.virtual) inLen += e.len;
    if (remap[e.a] < 0 || remap[e.b] < 0) continue;
    if (!e.virtual) keptLen += e.len;
    const inner = e.pts.slice(1, -1).flatMap(([x, y]) => [round(x, 1), round(y, 1)]);
    outEdges.push([remap[e.a], remap[e.b], e.cls, e.oneway, e.name, round(e.len, 1), inner, e.lanes ?? 0, e.virtual ? 1 : 0]);
  }
  const portalsOut = portalOut
    .filter((p) => remap[p.out] >= 0 && remap[p.in] >= 0)
    .map((p, i) => ({ id: `p${i}`, name: full.names[p.name] || 'Road out of town', out: remap[p.out], in: remap[p.in], x: round(p.x, 1), y: round(p.y, 1), fullOut: p.fullOut }));

  // Out-of-town landmarks: shortest road distance from a portal's outside node.
  const offmap = [];
  const nearestFullNode = (x, y) => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < full.nodeXY.length; i++) {
      if (!fullScc.keep[i]) continue;
      const d = Math.hypot(full.nodeXY[i][0] - x, full.nodeXY[i][1] - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const distFrom = portalsOut.map((p) => dijkstra(full.nodeXY.length, fullEdges, p.fullOut));
  for (const l of landmarks) {
    const [x, y] = toXY(l.lon, l.lat);
    const dx = Math.max(px0 - x, 0, x - px1);
    const dy = Math.max(py0 - y, 0, y - py1);
    if (Math.hypot(dx, dy) <= SNAP_IN_M) continue;
    const target = nearestFullNode(x, y);
    // Places beyond the fetched roads: add the straight-line gap with a detour factor.
    const gap = Math.hypot(full.nodeXY[target][0] - x, full.nodeXY[target][1] - y) * 1.3;
    let best = -1;
    let bestD = Infinity;
    distFrom.forEach((dist, i) => {
      if (dist[target] < bestD) {
        bestD = dist[target];
        best = i;
      }
    });
    if (best < 0 || !Number.isFinite(bestD)) continue;
    // Plus the stretch from the boundary node to the portal's first outside node.
    const p = portalsOut[best];
    const stub = Math.hypot(full.nodeXY[p.fullOut][0] - p.x, full.nodeXY[p.fullOut][1] - p.y);
    offmap.push({ id: l.id, portal: best, extraM: round(bestD + stub + gap, 0) });
  }
  for (const p of portalsOut) delete p.fullOut;

  console.log(
    `graph: full ${full.nodeXY.length} nodes → play area ${nodes.length / 2} nodes / ${outEdges.length} edges; ` +
      `${round((100 * keptLen) / Math.max(1, inLen), 1)}% of in-area road length kept; ${portalsOut.length} portals; ${offmap.length} out-of-town landmarks`,
  );
  return { origin: ORIGIN, classes: CLASSES, names: full.names, nodes, edges: outEdges, portals: portalsOut, offmap };
}

function roadsGeoJSON(roads) {
  const features = [];
  for (const w of roads.elements) {
    if (w.type !== 'way' || !w.geometry) continue;
    const xy = w.geometry.map((g) => toXY(g.lon, g.lat));
    const simp = simplify(
      xy.map((p, i) => [...p, i]),
      1.2,
    );
    const coords = simp.map(([, , i]) => [round(w.geometry[i].lon, 6), round(w.geometry[i].lat, 6)]);
    const props = { c: CLASSES[classOf(w.tags.highway)] };
    const nm = nameOf(w.tags);
    if (nm) props.n = nm;
    if (w.tags.bridge && w.tags.bridge !== 'no') props.b = 1;
    if (onewayOf(w.tags)) props.o = onewayOf(w.tags);
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

// ------------------------------------------------------------------- areas
function simplifyRing(ring, tol) {
  const xy = ring.map(([lon, lat], i) => [...toXY(lon, lat), i]);
  const s = simplify(xy, tol);
  return s.map(([, , i]) => [round(ring[i][0], 6), round(ring[i][1], 6)]);
}

function simplifyGeometry(g, tol) {
  switch (g.type) {
    case 'LineString':
      return { type: g.type, coordinates: simplifyRing(g.coordinates, tol) };
    case 'MultiLineString':
      return { type: g.type, coordinates: g.coordinates.map((l) => simplifyRing(l, tol)) };
    case 'Polygon':
      return { type: g.type, coordinates: g.coordinates.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4) };
    case 'MultiPolygon':
      return {
        type: g.type,
        coordinates: g.coordinates
          .map((p) => p.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4))
          .filter((p) => p.length),
      };
    default:
      return g;
  }
}

function kindOf(tags) {
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin' || tags.waterway === 'dock')
    return 'water';
  if (tags.waterway) return `waterway_${tags.waterway}`;
  if (tags.amenity === 'place_of_worship') return tags.religion === 'buddhist' || !tags.religion ? 'temple' : 'worship';
  if (tags.amenity === 'university' || tags.amenity === 'college' || tags.amenity === 'school') return 'campus';
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.amenity === 'marketplace') return 'market';
  if (tags.aeroway === 'runway' || tags.aeroway === 'taxiway') return 'runway';
  if (tags.aeroway === 'apron') return 'apron';
  if (tags.aeroway === 'terminal') return 'terminal';
  if (tags.railway === 'rail') return 'rail';
  if (tags.railway === 'platform') return 'platform';
  if (tags.barrier === 'city_wall' || /wall/.test(tags.historic ?? '')) return 'wall';
  if (tags.landuse === 'forest' || tags.natural === 'wood' || tags.leisure === 'nature_reserve') return 'forest';
  if (tags.natural === 'scrub' || tags.natural === 'grassland' || tags.landuse === 'meadow' || tags.landuse === 'farmland' || tags.landuse === 'orchard')
    return 'rural';
  if (tags.leisure === 'pitch' || tags.leisure === 'stadium') return 'pitch';
  if (tags.leisure === 'golf_course') return 'golf';
  if (tags.landuse === 'cemetery') return 'cemetery';
  return 'park';
}

function areaLayer(raw, tolerance) {
  const gj = osmtogeojson(raw, { flatProperties: true });
  const features = [];
  for (const f of gj.features) {
    if (!f.geometry || f.geometry.type === 'Point') continue;
    const tags = f.properties;
    const kind = kindOf(tags);
    const props = { k: kind };
    const nm = tags['name:en'] || tags.name;
    if (nm && ['temple', 'campus', 'hospital', 'market', 'park', 'water', 'forest', 'golf'].includes(kind)) props.n = nm;
    const geometry = simplifyGeometry(f.geometry, tolerance);
    if (!geometry.coordinates?.length) continue;
    features.push({ type: 'Feature', properties: props, geometry });
  }
  return { type: 'FeatureCollection', features };
}

function buildingsLayer(raw) {
  const features = [];
  for (const w of raw.elements) {
    if (w.type !== 'way' || !w.geometry || w.geometry.length < 4) continue;
    const ring = simplifyRing(
      w.geometry.map((g) => [g.lon, g.lat]),
      0.8,
    );
    if (ring.length < 4) continue;
    const props = {};
    const levels = parseFloat(w.tags?.['building:levels']);
    if (levels > 1) props.l = Math.min(40, Math.round(levels));
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  return { type: 'FeatureCollection', features };
}

// -------------------------------------------------------------------- pois
function poiCategory(t) {
  if (t.aeroway) return 'airport';
  if (t.railway) return 'train';
  if (t.amenity === 'bus_station') return 'bus';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.amenity === 'place_of_worship') return t.religion === 'buddhist' || !t.religion ? 'temple' : 'worship';
  if (t.amenity === 'marketplace' || t.amenity === 'food_court') return 'market';
  if (t.shop === 'mall' || t.shop === 'department_store') return 'mall';
  if (t.shop === 'supermarket') return 'shop';
  if (t.amenity === 'hospital' || t.amenity === 'clinic') return 'hospital';
  if (t.amenity === 'university' || t.amenity === 'college') return 'university';
  if (t.amenity === 'school') return 'school';
  if (['bar', 'pub', 'nightclub'].includes(t.amenity)) return 'nightlife';
  if (['cafe', 'restaurant'].includes(t.amenity)) return t.amenity;
  if (['hostel', 'guest_house'].includes(t.tourism)) return 'hostel';
  if (['hotel', 'motel', 'apartment'].includes(t.tourism)) return 'hotel';
  if (['attraction', 'museum', 'viewpoint', 'zoo', 'theme_park', 'gallery'].includes(t.tourism)) return 'attraction';
  if (t.historic) return 'historic';
  if (t.leisure) return 'leisure';
  if (['cinema', 'theatre', 'arts_centre', 'library'].includes(t.amenity)) return 'attraction';
  return 'civic';
}

function buildPois(raw, graph) {
  // Grid index over graph nodes for nearest-node snapping.
  const CELL = 200;
  const grid = new Map();
  const n = graph.nodes.length / 2;
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(graph.nodes[2 * i] / CELL)},${Math.floor(graph.nodes[2 * i + 1] / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  // Nodes on busy roads only are awkward stops; prefer nodes whose edges are
  // not trunk roads, since tuk-tuks pull in on side streets.
  const trunkOnly = new Uint8Array(n).fill(1);
  for (const [a, b, cls] of graph.edges) {
    if (cls !== 0) trunkOnly[a] = trunkOnly[b] = 0;
  }
  const nearest = (x, y) => {
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let r = 0; r <= 4 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = Math.hypot(graph.nodes[2 * i] - x, graph.nodes[2 * i + 1] - y) + (trunkOnly[i] ? 60 : 0);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && r === 0) continue;
    }
    return [best, bestD];
  };

  const pois = [];
  const seen = new Set();
  for (const el of raw.elements) {
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || !inBbox(lon, lat)) continue;
    const cat = poiCategory(t);
    const name = t['name:en'] || t.name || (cat === 'fuel' ? t.brand || 'Fuel station' : '');
    if (!name) continue;
    const key = `${cat}|${name}`;
    if (seen.has(key) && cat !== 'fuel') continue;
    seen.add(key);
    const [x, y] = toXY(lon, lat);
    const [node, dist] = nearest(x, y);
    if (node < 0 || dist > 400) continue;
    const poi = { id: `${el.type[0]}${el.id}`, name, cat, x: round(x, 1), y: round(y, 1), node };
    if (t.name && t.name !== name) poi.th = t.name;
    if (cat === 'fuel') poi.lpg = t['fuel:lpg'] === 'yes' ? 1 : 0;
    if (t.stars) poi.stars = parseFloat(t.stars) || undefined;
    pois.push(poi);
  }
  const counts = {};
  for (const p of pois) counts[p.cat] = (counts[p.cat] ?? 0) + 1;
  console.log('pois:', counts);
  return pois;
}

// -------------------------------------------------------------------- main
async function write(name, data) {
  const text = JSON.stringify(data);
  await writeFile(new URL(name, OUT), text);
  console.log(`wrote public/data/${name} (${(text.length / 1e6).toFixed(2)} MB)`);
}

await mkdir(OUT, { recursive: true });
const roads = await loadRaw('roads');
if (!roads) throw new Error('roads extract is required');
const landmarks = JSON.parse(await readFile(new URL('../src/content/landmarks.json', import.meta.url), 'utf8'));
const graph = buildGraph(roads, landmarks);
await write('graph.json', graph);
await write('roads.geojson', roadsGeoJSON(roads));

for (const [name, tol] of [
  ['water', 2],
  ['green', 2],
  ['forest', 6],
  ['landuse', 1.5],
]) {
  const raw = await loadRaw(name);
  if (raw) await write(`${name}.geojson`, areaLayer(raw, tol));
}
const buildings = await loadRaw('buildings');
if (buildings) await write('buildings.geojson', buildingsLayer(buildings));
const pois = await loadRaw('pois');
if (pois) await write('pois.json', buildPois(pois, graph));
