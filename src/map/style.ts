import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';

// Warm "Lanna" palette: sand ground, teak roads, temple gold, moat blue.
export const PALETTE = {
  land: '#efe5cf',
  forest: '#b5cf98',
  rural: '#dde4b6',
  park: '#c5dfa4',
  pitch: '#b3d693',
  golf: '#bfe0a0',
  cemetery: '#d4d8bd',
  campus: '#ece0c3',
  hospital: '#f1d6d0',
  market: '#f4d7ad',
  temple: '#f5cf7c',
  templeLine: '#cf9a2e',
  apron: '#d9d2c4',
  runway: '#b6ae9f',
  water: '#86c0dc',
  waterLine: '#6aaccd',
  wall: '#a4502c',
  rail: '#8c8579',
  building: '#dfcdb0',
  buildingLine: '#c8b391',
  buildingShadow: 'rgba(90, 64, 30, 0.22)',
  casing: '#c2ad88',
  trunk: '#f3b85b',
  primary: '#f8d27e',
  secondary: '#fce3a4',
  tertiary: '#fff3d2',
  minor: '#fffdf7',
  service: '#f7f1e3',
  label: '#4a3b2a',
  labelHalo: 'rgba(255, 250, 240, 0.9)',
} as const;

const CLASS_ORDER = ['service', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk'];

type Z = [number, number][];
const widthExpr = (stops: Z): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.7], ['zoom'], ...stops.flat()] as unknown as ExpressionSpecification;

// Road fill widths in px at zoom stops.
const ROAD_WIDTH: Record<string, Z> = {
  trunk: [
    [11, 1.6],
    [14, 5],
    [16, 13],
    [18, 38],
  ],
  primary: [
    [11, 1.2],
    [14, 4],
    [16, 11],
    [18, 32],
  ],
  secondary: [
    [11, 0.9],
    [14, 3.2],
    [16, 9],
    [18, 27],
  ],
  tertiary: [
    [11, 0.6],
    [14, 2.4],
    [16, 7.5],
    [18, 22],
  ],
  unclassified: [
    [12, 0.4],
    [14, 1.6],
    [16, 5.5],
    [18, 17],
  ],
  residential: [
    [12, 0.3],
    [14, 1.4],
    [16, 5],
    [18, 15],
  ],
  living_street: [
    [13, 0.3],
    [16, 3.5],
    [18, 11],
  ],
  service: [
    [13, 0.2],
    [16, 2.5],
    [18, 8],
  ],
};

const ROAD_COLOR: Record<string, string> = {
  trunk: PALETTE.trunk,
  primary: PALETTE.primary,
  secondary: PALETTE.secondary,
  tertiary: PALETTE.tertiary,
  unclassified: PALETTE.minor,
  residential: PALETTE.minor,
  living_street: PALETTE.minor,
  service: PALETTE.service,
};

const MIN_ZOOM: Record<string, number> = {
  trunk: 0,
  primary: 0,
  secondary: 0,
  tertiary: 11,
  unclassified: 12,
  residential: 12.5,
  living_street: 13.5,
  service: 14,
};

export function buildStyle(base: string): StyleSpecification {
  const data = (name: string) => new URL(`data/${name}`, base).href;
  const kind = (...kinds: string[]): ExpressionSpecification => ['in', ['get', 'k'], ['literal', kinds]];

  const roadCasings = CLASS_ORDER.map((c) => ({
    id: `road-casing-${c}`,
    type: 'line' as const,
    source: 'roads',
    minzoom: Math.max(MIN_ZOOM[c], 13),
    filter: ['==', ['get', 'c'], c] as ExpressionSpecification,
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': PALETTE.casing,
      'line-width': widthExpr(ROAD_WIDTH[c].map(([z, w]) => [z, w + (z >= 15 ? 2 : 1)])),
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1] as ExpressionSpecification,
    },
  }));
  const roadFills = CLASS_ORDER.map((c) => ({
    id: `road-${c}`,
    type: 'line' as const,
    source: 'roads',
    minzoom: MIN_ZOOM[c],
    filter: ['==', ['get', 'c'], c] as ExpressionSpecification,
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': ROAD_COLOR[c],
      'line-width': widthExpr(ROAD_WIDTH[c]),
    },
  }));

  return {
    version: 8,
    name: 'Chiang Mai — Tuk-Tuk Tycoon',
    glyphs: new URL('fonts/{fontstack}/{range}.pbf', base).href.replace('%7Bfontstack%7D', '{fontstack}').replace('%7Brange%7D', '{range}'),
    sources: {
      roads: { type: 'geojson', data: data('roads.geojson'), attribution: '© OpenStreetMap contributors' },
      water: { type: 'geojson', data: data('water.geojson') },
      green: { type: 'geojson', data: data('green.geojson') },
      forest: { type: 'geojson', data: data('forest.geojson') },
      landuse: { type: 'geojson', data: data('landuse.geojson') },
      buildings: { type: 'geojson', data: data('buildings.geojson') },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': PALETTE.land } },
      { id: 'forest', type: 'fill', source: 'forest', paint: { 'fill-color': PALETTE.forest } },
      {
        id: 'green-forest',
        type: 'fill',
        source: 'green',
        filter: kind('forest'),
        paint: { 'fill-color': PALETTE.forest },
      },
      { id: 'green-rural', type: 'fill', source: 'green', filter: kind('rural'), paint: { 'fill-color': PALETTE.rural } },
      {
        id: 'green-park',
        type: 'fill',
        source: 'green',
        filter: kind('park', 'golf', 'cemetery', 'pitch'),
        paint: {
          'fill-color': [
            'match',
            ['get', 'k'],
            'golf',
            PALETTE.golf,
            'cemetery',
            PALETTE.cemetery,
            'pitch',
            PALETTE.pitch,
            PALETTE.park,
          ] as ExpressionSpecification,
        },
      },
      {
        id: 'landuse-fill',
        type: 'fill',
        source: 'landuse',
        filter: ['==', ['geometry-type'], 'Polygon'] as ExpressionSpecification,
        paint: {
          'fill-color': [
            'match',
            ['get', 'k'],
            'campus',
            PALETTE.campus,
            'hospital',
            PALETTE.hospital,
            'market',
            PALETTE.market,
            'temple',
            PALETTE.temple,
            'apron',
            PALETTE.apron,
            'terminal',
            PALETTE.building,
            'platform',
            PALETTE.apron,
            'rgba(0,0,0,0)',
          ] as ExpressionSpecification,
        },
      },
      {
        id: 'temple-outline',
        type: 'line',
        source: 'landuse',
        minzoom: 14,
        filter: kind('temple'),
        paint: { 'line-color': PALETTE.templeLine, 'line-width': 1.2, 'line-opacity': 0.8 },
      },
      {
        id: 'runway',
        type: 'line',
        source: 'landuse',
        filter: kind('runway'),
        paint: { 'line-color': PALETTE.runway, 'line-width': widthExpr([[12, 3], [14, 12], [16, 45], [18, 170]]) },
      },
      { id: 'water-fill', type: 'fill', source: 'water', filter: kind('water'), paint: { 'fill-color': PALETTE.water } },
      {
        id: 'waterway',
        type: 'line',
        source: 'water',
        filter: ['all', ['!=', ['get', 'k'], 'water'], ['==', ['geometry-type'], 'LineString']] as ExpressionSpecification,
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': PALETTE.waterLine,
          'line-width': [
            'interpolate',
            ['exponential', 1.7],
            ['zoom'],
            12,
            ['match', ['get', 'k'], 'waterway_river', 2, 'waterway_canal', 1, 0.4],
            16,
            ['match', ['get', 'k'], 'waterway_river', 10, 'waterway_canal', 5, 2.5],
          ] as ExpressionSpecification,
        },
      },
      {
        id: 'city-wall',
        type: 'line',
        source: 'landuse',
        filter: kind('wall'),
        layout: { 'line-cap': 'butt' },
        paint: { 'line-color': PALETTE.wall, 'line-width': widthExpr([[13, 1.5], [16, 5], [18, 14]]) },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'landuse',
        filter: kind('rail'),
        paint: { 'line-color': PALETTE.rail, 'line-width': 1.6, 'line-dasharray': [3, 2] },
      },
      {
        id: 'building-shadow',
        type: 'fill',
        source: 'buildings',
        minzoom: 14.5,
        paint: {
          'fill-color': PALETTE.buildingShadow,
          'fill-translate': [2, 2],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 1] as ExpressionSpecification,
        },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'buildings',
        minzoom: 14,
        paint: {
          'fill-color': PALETTE.building,
          'fill-outline-color': PALETTE.buildingLine,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] as ExpressionSpecification,
        },
      },
      ...roadCasings,
      ...roadFills,
      {
        id: 'road-oneway',
        type: 'symbol',
        source: 'roads',
        minzoom: 16,
        filter: ['==', ['get', 'o'], 1] as ExpressionSpecification,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 90,
          'icon-image': 'oneway',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.55, 18, 0.9] as ExpressionSpecification,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 0.55 },
      },
      {
        id: 'water-label',
        type: 'symbol',
        source: 'water',
        minzoom: 13,
        filter: ['all', ['has', 'n'], ['==', ['geometry-type'], 'LineString']] as ExpressionSpecification,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': '#2f6f94', 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1.2 },
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'roads',
        minzoom: 14,
        filter: ['all', ['has', 'n'], ['in', ['get', 'c'], ['literal', ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential']]]] as ExpressionSpecification,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13] as ExpressionSpecification,
          'text-max-angle': 30,
          'symbol-spacing': 320,
        },
        paint: { 'text-color': PALETTE.label, 'text-halo-color': PALETTE.labelHalo, 'text-halo-width': 1.4 },
      },
      {
        id: 'area-label',
        type: 'symbol',
        source: 'landuse',
        minzoom: 15.5,
        filter: ['all', ['has', 'n'], ['in', ['get', 'k'], ['literal', ['temple', 'campus', 'hospital', 'market']]]] as ExpressionSpecification,
        layout: {
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-max-width': 8,
        },
        paint: {
          'text-color': ['match', ['get', 'k'], 'temple', '#8a5a0b', '#6b5a45'] as ExpressionSpecification,
          'text-halo-color': PALETTE.labelHalo,
          'text-halo-width': 1.2,
        },
      },
    ],
  };
}
