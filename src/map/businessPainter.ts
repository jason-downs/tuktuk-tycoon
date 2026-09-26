// Company places on the map: rented depots (a garage badge with the zone's
// name) and partner hotels (a gold bell), drawn under passengers and tuk-tuks.

import { activeDepots, businessState, hotelSite } from '../sim/business';
import { registerPainter, type PaintContext } from './painters';

/** Zoom below which company places are not drawn (the city is too small to read them). */
const MIN_ZOOM = 12.5;
/** Zoom from which depot names are written under the badge. */
const LABEL_ZOOM = 14;

const badgeCache = new Map<string, HTMLCanvasElement>();

/** Round badge with an emoji, rendered once at 2× for crisp scaling. */
function badge(emoji: string, fill: string): HTMLCanvasElement {
  const key = `${emoji}|${fill}`;
  const hit = badgeCache.get(key);
  if (hit) return hit;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2 - 5;
  g.fillStyle = 'rgba(40, 25, 10, 0.3)';
  g.beginPath();
  g.arc(size / 2 + 1.5, size / 2 + 2.5, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fffaf0';
  g.lineWidth = 4;
  g.stroke();
  g.font = `${Math.round(r * 1.05)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, size / 2, size / 2 + 2);
  badgeCache.set(key, c);
  return c;
}

function label(p: PaintContext, text: string, x: number, y: number): void {
  const ctx = p.ctx;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 250, 240, 0.95)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#3b2a18';
  ctx.fillText(text, x, y);
}

registerPainter({
  id: 'business-places',
  layer: 'under',
  paint(p: PaintContext) {
    const game = p.game;
    if (!game.state.systems.business || p.zoom < MIN_ZOOM) return;
    const st = businessState(game);
    const size = Math.max(18, Math.min(32, (p.zoom - 11) * 7));
    const off = (x: number, y: number) => x < -40 || y < -40 || x > p.width + 40 || y > p.height + 40;
    for (const id of Object.keys(st.hotels)) {
      const site = hotelSite(game.world, id);
      if (!site) continue;
      const s = p.toScreen(site.place.x, site.place.y);
      if (off(s.x, s.y)) continue;
      const b = size * 0.8;
      p.ctx.drawImage(badge('🛎️', '#d9a21b'), s.x - b / 2, s.y - b - 4, b, b);
    }
    for (const d of activeDepots(game)) {
      const s = p.toScreen(d.x, d.y);
      if (off(s.x, s.y)) continue;
      p.ctx.drawImage(badge('🏠', '#3d6fb6'), s.x - size / 2, s.y - size / 2, size, size);
      if (p.zoom >= LABEL_ZOOM) label(p, `${d.zone.name} depot`, s.x, s.y + size / 2 + 12);
    }
  },
});
