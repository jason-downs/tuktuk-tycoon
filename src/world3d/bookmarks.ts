// Named camera views for screenshot comparison (docs/plan-3d.md, "Checks"):
// the same framing every time, so a before/after pair of screenshots differs
// only in what changed. In dev builds, window.__world3d.showBookmark(name)
// puts the Manage-mode camera there.

import type { World } from '../data/world';

export interface Bookmark {
  /** Landmark id the view centres on; null centres on the map origin. */
  landmark: string | null;
  /** Camera distance (m) and compass bearing of the view (degrees, 0 = looking north). */
  dist: number;
  yawDeg: number;
}

export const BOOKMARKS: Record<string, Bookmark> = {
  tha_phae_gate: { landmark: 'tha_phae_gate', dist: 180, yawDeg: 270 },
  wat_chedi_luang: { landmark: 'wat_chedi_luang', dist: 220, yawDeg: 30 },
  night_bazaar: { landmark: 'night_bazaar', dist: 200, yawDeg: 330 },
  nimman: { landmark: 'one_nimman', dist: 260, yawDeg: 45 },
  riverside: { landmark: 'iron_bridge', dist: 260, yawDeg: 90 },
  airport: { landmark: 'cnx_airport', dist: 900, yawDeg: 0 },
  overview: { landmark: null, dist: 4500, yawDeg: 0 },
};

const DEG = Math.PI / 180;

/** Where a bookmark puts the camera (sim metres, metres, radians), or null for an unknown name or landmark. */
export function bookmarkView(world: World, name: string): { x: number; y: number; dist: number; yaw: number } | null {
  const b = BOOKMARKS[name];
  if (!b) return null;
  const place = b.landmark === null ? { x: 0, y: 0 } : world.landmarks.find((l) => l.id === b.landmark);
  if (!place) return null;
  return { x: place.x, y: place.y, dist: b.dist, yaw: b.yawDeg * DEG };
}
