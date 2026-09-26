import landmarksJson from '../content/landmarks.json';
import { OFFMAP_TRIPS } from '../content/offmap';
import { RoadGraph, type GraphJSON } from '../sim/graph';
import { Router } from '../sim/routing';
import type { Place, PlaceCategory } from '../sim/types';

/** Raw POI record from public/data/pois.json (see scripts/build-map.mjs). */
export interface PoiJSON {
  id: string;
  name: string;
  th?: string;
  cat: string;
  x: number;
  y: number;
  node: number;
  lpg?: number;
  stars?: number;
}

interface LandmarkJSON {
  id: string;
  name: string;
  th?: string;
  lat: number;
  lon: number;
  cat: string;
  notes?: string;
  riders?: string;
}

export interface World {
  graph: RoadGraph;
  router: Router;
  places: Place[];
  /** Places with an LPG pump. */
  lpgStations: Place[];
  landmarks: Place[];
}

const POI_CATEGORY: Record<string, PlaceCategory | null> = {
  airport: 'transport',
  train: 'transport',
  bus: 'transport',
  fuel: 'fuel',
  temple: 'temple',
  worship: 'temple',
  market: 'market',
  mall: 'mall',
  shop: 'shop',
  hospital: 'hospital',
  university: 'university',
  school: 'school',
  nightlife: 'nightlife',
  cafe: 'cafe',
  restaurant: 'restaurant',
  hostel: 'hostel',
  hotel: 'hotel',
  attraction: 'attraction',
  historic: 'attraction',
  leisure: 'park',
  civic: 'civic',
};

const LANDMARK_CATEGORY: Record<string, PlaceCategory> = {
  gate: 'gate',
  temple: 'temple',
  attraction: 'attraction',
  museum: 'museum',
  market: 'market',
  mall: 'mall',
  transport: 'transport',
  university: 'university',
  hospital: 'hospital',
  viewpoint: 'viewpoint',
  nightlife: 'nightlife',
  park: 'park',
  hotel_area: 'hotel',
};

/** Base ride-generation weight per ordinary POI category. */
const POI_WEIGHT: Record<PlaceCategory, number> = {
  gate: 3,
  temple: 0.8,
  market: 2,
  mall: 3,
  transport: 6,
  university: 1.5,
  school: 0.3,
  hospital: 1.5,
  nightlife: 0.7,
  attraction: 1,
  museum: 0.8,
  viewpoint: 0.6,
  park: 0.5,
  hotel: 1,
  hostel: 0.8,
  cafe: 0.35,
  restaurant: 0.25,
  shop: 0.8,
  fuel: 0,
  civic: 0.3,
};

const LANDMARK_WEIGHT = 8;

export function buildWorld(graphJson: GraphJSON, pois: PoiJSON[]): World {
  const graph = new RoadGraph(graphJson);
  const router = new Router(graph);
  const places: Place[] = [];
  const landmarks: Place[] = [];

  const offmapById = new Map((graphJson.offmap ?? []).map((o) => [o.id, o]));
  for (const l of landmarksJson as LandmarkJSON[]) {
    const [x, y] = graph.projection.toXY(l.lon, l.lat);
    const off = offmapById.get(l.id);
    const portal = off ? graph.portals[off.portal] : undefined;
    // Out-of-town places are reached through their portal's outbound node.
    const node = portal ? portal.out : graph.nearestNode(x, y, 500);
    if (node < 0) continue;
    const cat = LANDMARK_CATEGORY[l.cat] ?? 'attraction';
    const place: Place = {
      idx: places.length,
      id: l.id,
      name: l.name,
      th: l.th,
      cat,
      x,
      y,
      node,
      landmark: true,
      weight: LANDMARK_WEIGHT * (cat === 'transport' ? 2 : 1),
      notes: l.notes,
    };
    if (off) {
      const trip = OFFMAP_TRIPS[l.id] ?? {};
      place.offmap = { portal: off.portal, extraM: off.extraM, roundTrip: !!trip.roundTrip, waitS: (trip.waitMin ?? 0) * 60, fare: trip.fare };
    }
    places.push(place);
    landmarks.push(place);
  }

  const lpgStations: Place[] = [];
  for (const p of pois) {
    const cat = POI_CATEGORY[p.cat];
    if (!cat) continue;
    // Skip POIs that duplicate a curated landmark.
    if (landmarks.some((l) => Math.hypot(l.x - p.x, l.y - p.y) < 80 && (l.cat === cat || l.name === p.name))) continue;
    if (p.node < 0 || p.node >= graph.nodeCount) continue;
    const place: Place = {
      idx: places.length,
      id: p.id,
      name: p.name,
      th: p.th,
      cat,
      x: p.x,
      y: p.y,
      node: p.node,
      landmark: false,
      weight: POI_WEIGHT[cat] * (p.stars ? 1 + p.stars / 5 : 1),
      lpg: p.lpg === 1,
    };
    places.push(place);
    if (place.lpg) lpgStations.push(place);
  }
  return { graph, router, places, lpgStations, landmarks };
}

export async function loadWorld(base = 'data/'): Promise<World> {
  const [graphJson, pois] = await Promise.all([
    fetch(`${base}graph.json`).then((r) => r.json() as Promise<GraphJSON>),
    fetch(`${base}pois.json`).then((r) => r.json() as Promise<PoiJSON[]>),
  ]);
  return buildWorld(graphJson, pois);
}
