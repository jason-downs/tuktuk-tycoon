// Drive-mode HUD over the 3D view: arrows at the screen edge pointing to the
// nearest waiting passengers out of view, "E" prompts when a passenger or a
// pump is close enough to use, and waving hands above passengers who heard
// your horn.

import { ARCHETYPES } from '../content/archetypes';
import { passengerBadge } from '../map/sprites';
import { kerbsidePassenger, pumpNearby, PICKUP_MAX_SPEED, walkingPassenger } from '../sim/manual';
import type { RideRequest } from '../sim/types';
import type { FrameInfo, ViewContext } from './layers/types';

/** Nearest waiting passengers considered for edge arrows, and the most arrows drawn. */
const ARROW_CANDIDATES = 5;
const MAX_ARROWS = 4;
/** Arrows keep this far (px) inside the screen edge; more at the top for the top bar and at the bottom for the minimap and pad. */
const INSET = { side: 34, top: 96, bottom: 150 };
/** Passengers this close (m) to a horn toot wave harder, for this long (ms). */
export const HORN_RADIUS_M = 60;
export const HORN_MS = 1600;

interface Hail {
  req: RideRequest;
  x: number;
  y: number;
  d: number;
}

export class DriveHud {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly ctx: ViewContext;

  constructor(ctx: ViewContext, container: HTMLElement) {
    this.ctx = ctx;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-overlay drive-hud';
    container.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  draw(frame: FrameInfo, width: number, height: number, dpr: number): void {
    const cw = Math.round(width * dpr);
    const ch = Math.round(height * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const s = frame.ui;
    if (s.mode !== 'drive' || s.planner) return;
    const game = this.ctx.game;
    const v = game.playerVehicle();
    if (!v || v.task.kind === 'away') return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pose = game.vehiclePose(v);

    const hails: Hail[] = [];
    for (const req of game.visibleTo(v)) {
      if (req.claimedBy !== null && req.claimedBy !== v.id) continue;
      if (game.place(req.from).offmap) continue;
      const k = this.ctx.kerbOf(req);
      hails.push({ req, x: k.x, y: k.y, d: Math.hypot(k.x - pose.x, k.y - pose.y) });
    }
    hails.sort((a, b) => a.d - b.d);

    // Horn: hands waving above the passengers who heard it.
    const horn = s.horn;
    if (horn && frame.now - horn.at < HORN_MS) {
      const t = (frame.now - horn.at) / HORN_MS;
      g.font = '22px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.globalAlpha = 1 - t * t;
      for (const h of hails) {
        if (Math.hypot(h.x - horn.x, h.y - horn.y) > HORN_RADIUS_M) continue;
        const p = this.ctx.screenOf(h.x, h.y, 3.2 * this.ctx.vehicleScale());
        if (!p) continue;
        g.save();
        g.translate(p.x, p.y - 18);
        g.rotate(Math.sin(frame.now / 70 + h.req.id) * 0.5);
        g.fillText('👋', 0, 0);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    // "E" prompts.
    const slow = v.speed < PICKUP_MAX_SPEED;
    const free = v.task.kind !== 'trip' && v.task.kind !== 'haggle' && v.task.kind !== 'broken';
    if (free && !walkingPassenger(game)) {
      const near = kerbsidePassenger(game, v);
      if (near) {
        const k = this.ctx.kerbOf(near);
        const p = this.ctx.screenOf(k.x, k.y, 3.4 * this.ctx.vehicleScale());
        if (p) this.prompt(p.x, p.y - 34, slow ? 'E  pick up' : 'Stop to pick up', slow);
      } else if (v.fuel < 0.99 && pumpNearby(game, v)) {
        const p = this.ctx.screenOf(pose.x, pose.y, 3 * this.ctx.vehicleScale());
        if (p) this.prompt(p.x, p.y - 30, slow ? 'E  fill up' : 'Stop to fill up', slow);
      }
    }

    // Edge arrows to the nearest passengers out of view.
    let drawn = 0;
    const cx = width / 2;
    const cy = height * 0.55;
    for (const h of hails.slice(0, ARROW_CANDIDATES)) {
      if (drawn >= MAX_ARROWS) break;
      const p = this.ctx.screenOf(h.x, h.y, 1.5);
      let dx: number;
      let dy: number;
      if (p && p.x >= INSET.side && p.x <= width - INSET.side && p.y >= INSET.top && p.y <= height - INSET.bottom) continue;
      if (p) {
        dx = p.x - cx;
        dy = p.y - cy;
      } else {
        // Behind the camera: use the bearing relative to the view direction.
        const yaw = this.ctx.rig.yaw;
        const ox = h.x - this.ctx.rig.tx;
        const oy = h.y - this.ctx.rig.ty;
        dx = ox * Math.cos(yaw) - oy * Math.sin(yaw);
        dy = -(ox * Math.sin(yaw) + oy * Math.cos(yaw));
        if (dy < 0) dy = -dy;
      }
      const at = edgePoint(cx, cy, dx, dy, width, height);
      if (!at) continue;
      this.arrow(at.x, at.y, Math.atan2(dy, dx), h, frame.now);
      drawn++;
    }
  }

  private prompt(x: number, y: number, text: string, ready: boolean): void {
    const g = this.g;
    g.font = '700 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = g.measureText(text).width + 18;
    g.fillStyle = ready ? 'rgba(232, 185, 35, 0.95)' : 'rgba(43, 29, 18, 0.85)';
    g.beginPath();
    g.roundRect(x - w / 2, y - 12, w, 24, 12);
    g.fill();
    g.fillStyle = ready ? '#2b1d12' : '#fbf3e2';
    g.fillText(text, x, y + 0.5);
  }

  private arrow(x: number, y: number, angle: number, h: Hail, now: number): void {
    const g = this.g;
    const info = ARCHETYPES[h.req.archetype];
    const r = 17;
    g.save();
    g.translate(x, y);
    // Pointer towards the passenger.
    g.save();
    g.rotate(angle);
    g.fillStyle = info.color;
    g.beginPath();
    g.moveTo(r + 11, 0);
    g.lineTo(r - 2, -9);
    g.lineTo(r - 2, 9);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = 'rgba(255, 250, 240, 0.95)';
    g.strokeStyle = info.color;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const sz = r * 1.5 * (1 + Math.sin(now / 300 + h.req.id) * 0.04);
    g.drawImage(passengerBadge(h.req.archetype), -sz / 2, -sz / 2, sz, sz);
    const label = h.d < 1000 ? `${Math.round(h.d / 10) * 10} m` : `${(h.d / 1000).toFixed(1)} km`;
    g.font = '700 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(43, 29, 18, 0.9)';
    g.strokeText(label, 0, r + 4);
    g.fillStyle = '#fbf3e2';
    g.fillText(label, 0, r + 4);
    g.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}

/** Where a ray from (cx, cy) along (dx, dy) leaves the inset screen rectangle. */
export function edgePoint(cx: number, cy: number, dx: number, dy: number, width: number, height: number): { x: number; y: number } | null {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const x0 = INSET.side;
  const x1 = Math.max(x0 + 1, width - INSET.side);
  const y0 = Math.min(INSET.top, height / 2 - 1);
  const y1 = Math.max(y0 + 1, height - INSET.bottom);
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (x1 - cx) / dx);
  if (dx < 0) t = Math.min(t, (x0 - cx) / dx);
  if (dy > 0) t = Math.min(t, (y1 - cy) / dy);
  if (dy < 0) t = Math.min(t, (y0 - cy) / dy);
  if (!Number.isFinite(t) || t < 0) return null;
  return { x: cx + dx * t, y: cy + dy * t };
}
