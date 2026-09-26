// 2D HUD canvas over the 3D view: passenger badges with patience rings and
// fares, landmark names, status icons over fleet tuk-tuks, and the overlay
// painters shared with the flat map.

import { ARCHETYPES } from '../content/archetypes';
import { OVERLAY_PAINTERS, type PaintContext } from '../map/painters';
import { passengerBadge } from '../map/sprites';
import type { RideRequest, Vehicle } from '../sim/types';
import type { FrameInfo, ViewContext } from './layers/types';

/** Flat-map painters the 3D view replaces with scene objects (rivals, closures) or scene fog (weather tint). */
const SKIP_2D_PAINTERS = new Set(['rivals', 'weather-tint', 'closures']);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly ctx: ViewContext;
  /** Set while the static city is still being generated. */
  loading = true;

  constructor(ctx: ViewContext, container: HTMLElement) {
    this.ctx = ctx;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-overlay';
    container.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /** Height above the kerb where passenger badges float. */
  badgeHeight(): number {
    return 2.6 * this.ctx.vehicleScale();
  }

  draw(frame: FrameInfo, width: number, height: number, dpr: number): void {
    const g = this.g;
    const { game, rig } = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const player = game.playerVehicle();
    const pc: PaintContext = {
      ctx: g,
      game,
      width,
      height,
      zoom: 16 - Math.log2(rig.dist / 180),
      now: frame.now,
      toScreen: (x, y) => this.ctx.screenOf(x, y, 0) ?? { x: -9999, y: -9999 },
    };
    for (const p of OVERLAY_PAINTERS) if (p.layer === 'under' && !SKIP_2D_PAINTERS.has(p.id)) p.paint(pc);

    if (this.loading) {
      g.fillStyle = 'rgba(43,29,18,0.85)';
      g.font = '600 15px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Building Chiang Mai…', width / 2, height / 2);
    }

    // Landmark names when close enough.
    if (rig.dist < 900) {
      g.font = '700 12px system-ui, sans-serif';
      g.textAlign = 'center';
      for (const l of game.world.landmarks) {
        if (Math.hypot(l.x - rig.tx, l.y - rig.ty) > rig.dist * 3) continue;
        const p = this.ctx.screenOf(l.x, l.y, 12);
        if (!p || p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(255,248,232,0.9)';
        g.strokeText(l.name, p.x, p.y);
        g.fillStyle = '#3b2a18';
        g.fillText(l.name, p.x, p.y);
      }
    }

    // Passenger badges above heads.
    const badge = clamp(38 - rig.dist / 120, 22, 36);
    const h = this.badgeHeight();
    for (const r of game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      const k = this.ctx.kerbOf(r);
      const p = this.ctx.screenOf(k.x, k.y, h);
      if (!p || p.x < -40 || p.y < -40 || p.x > width + 40 || p.y > height + 40) continue;
      this.drawBadge(r, p.x, p.y - badge * 0.3, badge, frame.now, r.id === frame.ui.selectedRequest || r.id === this.ctx.hoverRequest);
    }

    // Status icons above fleet tuk-tuks.
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.font = `${Math.round(clamp(26 - rig.dist / 150, 14, 24))}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    for (const v of game.state.vehicles) {
      const icon = statusIcon(v);
      const m = icon ? this.ctx.vehicleMesh(v.id) : undefined;
      if (!m) continue;
      const p = this.ctx.screenOf(m.position.x, -m.position.z, 2.6 * this.ctx.vehicleScale());
      if (p) g.fillText(icon, p.x, p.y);
    }
    g.textBaseline = 'alphabetic';
    for (const p of OVERLAY_PAINTERS) if (p.layer === 'over') p.paint(pc);
  }

  private drawBadge(r: RideRequest, x: number, y: number, size: number, now: number, highlight: boolean): void {
    const g = this.g;
    const info = ARCHETYPES[r.archetype];
    const left = Math.max(0, (r.expiresAt - this.ctx.game.state.time) / (r.expiresAt - r.spawnedAt));
    const sz = size * (highlight ? 1.2 : 1) * (1 + Math.sin(now / 260 + r.id) * 0.05);
    g.save();
    g.translate(x, y);
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(0, 0, sz / 2 + 3, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = left > 0.5 ? '#3aa35b' : left > 0.2 ? '#e0a526' : '#d6453d';
    g.beginPath();
    g.arc(0, 0, sz / 2 + 3, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    g.stroke();
    g.drawImage(passengerBadge(r.archetype), -sz / 2, -sz / 2, sz, sz);
    if (r.party > 1) {
      g.fillStyle = info.color;
      g.beginPath();
      g.arc(sz / 2 - 2, -sz / 2 + 2, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '700 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(r.party), sz / 2 - 2, -sz / 2 + 2.5);
    }
    if (this.ctx.rig.dist < 700 || highlight) {
      const label = r.fixedFare !== null ? `📱฿${r.fixedFare}` : `~฿${r.fairFare}`;
      g.font = '700 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const tw = g.measureText(label).width + 10;
      g.fillStyle = 'rgba(59, 42, 24, 0.88)';
      const by = -sz / 2 - 22;
      g.beginPath();
      g.roundRect(-tw / 2, by, tw, 17, 8);
      g.fill();
      g.fillStyle = '#ffe9a8';
      g.fillText(label, 0, by + 13);
    }
    g.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}

function statusIcon(v: Vehicle): string {
  switch (v.task.kind) {
    case 'broken':
      return '🔧';
    case 'offduty':
      return '💤';
    case 'refuel':
      return '⛽';
    case 'haggle':
      return '💬';
    default:
      return v.fuel < 0.12 ? '⚠️' : '';
  }
}
