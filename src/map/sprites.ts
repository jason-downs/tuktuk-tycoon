// Procedurally drawn sprites for the overlay canvas: top-down tuk-tuks in each
// livery and round passenger badges. Drawn once at high resolution and reused.

import { ARCHETYPES } from '../content/archetypes';
import { PAINTS } from '../content/paints';
import type { Archetype } from '../sim/types';

/** Sprite pixels per metre of tuk-tuk (a tuk-tuk is ~3 m long, 1.4 m wide). */
export const TUKTUK_SPRITE_W = 96;
export const TUKTUK_SPRITE_H = 56;
export const TUKTUK_LENGTH_M = 3.1;

const cache = new Map<string, HTMLCanvasElement>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Top-down tuk-tuk facing +x (east), centred in a TUKTUK_SPRITE_W × TUKTUK_SPRITE_H canvas. */
export function tuktukSprite(paintId: string, lit = false): HTMLCanvasElement {
  const key = `tt:${paintId}:${lit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const paint = PAINTS[paintId] ?? PAINTS.nakhon_blue;
  const [c, ctx] = canvas(TUKTUK_SPRITE_W, TUKTUK_SPRITE_H);
  ctx.translate(TUKTUK_SPRITE_W / 2, TUKTUK_SPRITE_H / 2);

  if (lit) {
    const g = ctx.createRadialGradient(40, 0, 2, 40, 0, 30);
    g.addColorStop(0, 'rgba(255, 236, 170, 0.75)');
    g.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(48, -18);
    ctx.lineTo(48, 18);
    ctx.closePath();
    ctx.fill();
  }

  // Shadow.
  ctx.fillStyle = 'rgba(40, 25, 10, 0.28)';
  ctx.beginPath();
  ctx.ellipse(1, 3, 30, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rear wheels and front wheel.
  ctx.fillStyle = '#1a1a1a';
  roundRect(ctx, -24, -21, 12, 6, 2);
  ctx.fill();
  roundRect(ctx, -24, 15, 12, 6, 2);
  ctx.fill();
  roundRect(ctx, 20, -3, 10, 6, 2);
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(-21, -20, 6, 4);
  ctx.fillRect(-21, 16, 6, 4);

  // Body: wide passenger tub tapering to a narrow nose.
  ctx.fillStyle = paint.body;
  ctx.beginPath();
  ctx.moveTo(-29, -15);
  ctx.lineTo(4, -15);
  ctx.quadraticCurveTo(18, -13, 30, -6);
  ctx.quadraticCurveTo(34, 0, 30, 6);
  ctx.quadraticCurveTo(18, 13, 4, 15);
  ctx.lineTo(-29, 15);
  ctx.quadraticCurveTo(-32, 0, -29, -15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Pinstripe.
  ctx.strokeStyle = paint.trim;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-27, -12.5);
  ctx.lineTo(4, -12.5);
  ctx.quadraticCurveTo(17, -11, 27, -5);
  ctx.moveTo(-27, 12.5);
  ctx.lineTo(4, 12.5);
  ctx.quadraticCurveTo(17, 11, 27, 5);
  ctx.stroke();

  // Canopy roof.
  ctx.fillStyle = paint.canopy;
  roundRect(ctx, -27, -13.5, 37, 27, 6);
  ctx.fill();
  const sheen = ctx.createLinearGradient(0, -13, 0, 13);
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = sheen;
  roundRect(ctx, -27, -13.5, 37, 27, 6);
  ctx.fill();
  // Canopy trim and roof sign.
  ctx.strokeStyle = paint.trim;
  ctx.lineWidth = 1.4;
  roundRect(ctx, -25, -11.5, 33, 23, 5);
  ctx.stroke();
  ctx.fillStyle = '#f4d03f';
  roundRect(ctx, 2, -4, 6, 8, 1.5);
  ctx.fill();

  // Windscreen.
  ctx.fillStyle = 'rgba(170, 215, 240, 0.9)';
  roundRect(ctx, 11, -8, 5, 16, 2);
  ctx.fill();
  // Headlight.
  ctx.fillStyle = lit ? '#fff7c2' : '#fdf2c0';
  ctx.beginPath();
  ctx.arc(31, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  cache.set(key, c);
  return c;
}

export const BADGE_SIZE = 56;

/** Round passenger badge with the archetype's emoji. */
export function passengerBadge(arch: Archetype): HTMLCanvasElement {
  const key = `pb:${arch}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const info = ARCHETYPES[arch];
  const [c, ctx] = canvas(BADGE_SIZE, BADGE_SIZE);
  const r = BADGE_SIZE / 2 - 4;
  ctx.fillStyle = 'rgba(40, 25, 10, 0.3)';
  ctx.beginPath();
  ctx.arc(BADGE_SIZE / 2 + 1, BADGE_SIZE / 2 + 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.arc(BADGE_SIZE / 2, BADGE_SIZE / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = info.color;
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.1)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(info.icon, BADGE_SIZE / 2, BADGE_SIZE / 2 + 2);
  cache.set(key, c);
  return c;
}

/** Emoji icon image for MapLibre (landmark categories). */
export function emojiImage(emoji: string, bg: string, size = 44): ImageData {
  const [, ctx] = canvas(size, size);
  const r = size / 2 - 3;
  ctx.fillStyle = 'rgba(40,25,10,0.25)';
  ctx.beginPath();
  ctx.arc(size / 2 + 1, size / 2 + 1.5, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.05)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 1.5);
  return ctx.getImageData(0, 0, size, size);
}

/** Small arrow for one-way streets, pointing +x. */
export function onewayArrow(): ImageData {
  const [, ctx] = canvas(24, 12);
  ctx.fillStyle = '#7a6a52';
  ctx.beginPath();
  ctx.moveTo(2, 4.5);
  ctx.lineTo(14, 4.5);
  ctx.lineTo(14, 1);
  ctx.lineTo(22, 6);
  ctx.lineTo(14, 11);
  ctx.lineTo(14, 7.5);
  ctx.lineTo(2, 7.5);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, 24, 12);
}
