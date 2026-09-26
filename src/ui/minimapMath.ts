// Projections for the minimap. Sim metres have x east and y north; canvas
// pixels have x right and y down. The overview is north-up and fits the whole
// road network; the radar is centred on the tuk-tuk and turns with it, so the
// direction of travel always points up.

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The road network's extent plus a margin, sim metres. */
export function graphBounds(nodeX: ArrayLike<number>, nodeY: ArrayLike<number>, margin = 60): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nodeX.length; i++) {
    minX = Math.min(minX, nodeX[i]);
    maxX = Math.max(maxX, nodeX[i]);
    minY = Math.min(minY, nodeY[i]);
    maxY = Math.max(maxY, nodeY[i]);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

// --------------------------------------------------------------- overview
/** A north-up view of `bounds` drawn into a width × height pixel box (letterboxed, same scale on both axes). */
export interface OverviewFrame {
  bounds: Bounds;
  /** Pixels per metre. */
  scale: number;
  /** Pixel offset of bounds.minX / bounds.maxY. */
  ox: number;
  oy: number;
}

export function overviewFrame(bounds: Bounds, width: number, height: number): OverviewFrame {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = Math.min(width / w, height / h);
  return { bounds, scale, ox: (width - w * scale) / 2, oy: (height - h * scale) / 2 };
}

export function overviewToScreen(f: OverviewFrame, x: number, y: number): { x: number; y: number } {
  return { x: f.ox + (x - f.bounds.minX) * f.scale, y: f.oy + (f.bounds.maxY - y) * f.scale };
}

export function screenToOverview(f: OverviewFrame, px: number, py: number): { x: number; y: number } {
  return { x: f.bounds.minX + (px - f.ox) / f.scale, y: f.bounds.maxY - (py - f.oy) / f.scale };
}

// ------------------------------------------------------------------ radar
/** A heading-up disc: sim point (x, y) at pixel (cx, cy), radiusM metres out to radiusPx pixels. */
export interface RadarFrame {
  cx: number;
  cy: number;
  x: number;
  y: number;
  /** Direction of travel, radians counter-clockwise from east; drawn pointing up. */
  heading: number;
  radiusM: number;
  radiusPx: number;
}

/** Canvas rotation (radians, clockwise on screen) that turns north-up into heading-up. */
export const radarRotation = (heading: number): number => heading - Math.PI / 2;

/** Pixel position of a sim point on the radar, and whether it lies inside the disc. */
export function radarToScreen(f: RadarFrame, x: number, y: number): { x: number; y: number; inside: boolean } {
  const s = f.radiusPx / f.radiusM;
  const sx = (x - f.x) * s;
  const sy = -(y - f.y) * s;
  const a = radarRotation(f.heading);
  const c = Math.cos(a);
  const n = Math.sin(a);
  const rx = sx * c - sy * n;
  const ry = sx * n + sy * c;
  return { x: f.cx + rx, y: f.cy + ry, inside: Math.hypot(rx, ry) <= f.radiusPx };
}

/** The sim point under a radar pixel. */
export function screenToRadar(f: RadarFrame, px: number, py: number): { x: number; y: number } {
  const s = f.radiusPx / f.radiusM;
  const a = -radarRotation(f.heading);
  const dx = px - f.cx;
  const dy = py - f.cy;
  const sx = dx * Math.cos(a) - dy * Math.sin(a);
  const sy = dx * Math.sin(a) + dy * Math.cos(a);
  return { x: f.x + sx / s, y: f.y - sy / s };
}

/** Where a point outside the radar shows on its rim, and the on-screen angle towards it. */
export function radarRim(f: RadarFrame, x: number, y: number, inset = 8): { x: number; y: number; angle: number } {
  const p = radarToScreen(f, x, y);
  const angle = Math.atan2(p.y - f.cy, p.x - f.cx);
  const r = f.radiusPx - inset;
  return { x: f.cx + Math.cos(angle) * r, y: f.cy + Math.sin(angle) * r, angle };
}
