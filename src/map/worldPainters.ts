// Map effects for the living city: weather (rain streaks, storm flashes, haze
// and fog tints), festival lights (Yi Peng lanterns and krathongs, Chinese New
// Year lanterns, Songkran splashes), road closures, and ambient traffic
// (songthaews, rival tuk-tuks, cars, motorbikes). Particle counts are capped and
// positions are derived from time, so frames allocate almost nothing.

import { ROAD_SETS, type RoadEffect } from '../content/events';
import { calendar } from '../sim/clock';
import { roadSetEdges } from '../sim/closures';
import { activeOccurrences, type EventOccurrence } from '../sim/events';
import type { Game } from '../sim/game';
import type { Pose } from '../sim/graph';
import { RIVAL_KINDS, rivalsOf } from '../sim/rivals';
import { currentWeather, hazeActive } from '../sim/weather';
import { registerPainter, type PaintContext } from './painters';
import { tuktukSprite } from './sprites';

// ------------------------------------------------------------ shared state
let eventCache: { minute: number; game: Game | null; active: EventOccurrence[] } = { minute: -1, game: null, active: [] };

function activeNow(game: Game): EventOccurrence[] {
  const minute = Math.floor(game.state.time / 60);
  if (eventCache.minute !== minute || eventCache.game !== game) eventCache = { minute, game, active: activeOccurrences(game.state.time) };
  return eventCache.active;
}

const isActive = (game: Game, id: string): boolean => activeNow(game).some((o) => o.event.id === id);

/** Smoothed effect strengths so weather fades in and out instead of popping. */
const fx = { dark: 0, rain: 0, storm: 0, haze: 0, fog: 0, cloud: 0, last: 0 };

function ease(now: number): number {
  const dt = fx.last ? Math.min(0.25, (now - fx.last) / 1000) : 0.25;
  fx.last = now;
  return 1 - Math.exp(-dt * 1.5);
}

/** Deterministic pseudo-random numbers for particles. */
function rand(i: number, salt: number): number {
  let h = Math.imul(i + 0x9e37 * salt, 0x85ebca6b) ^ 0x632be5ab;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const glowCache = new Map<string, HTMLCanvasElement>();

/** Soft round glow sprite (lanterns, candles). */
function glow(core: string, halo: string): HTMLCanvasElement {
  const key = `${core}|${halo}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, core);
  grad.addColorStop(0.25, halo);
  grad.addColorStop(1, 'rgba(255, 150, 40, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(key, c);
  return c;
}

// ---------------------------------------------------------- weather: tint
registerPainter({
  id: 'weather-tint',
  layer: 'under',
  paint(p: PaintContext) {
    const w = currentWeather(p.game);
    const k = ease(p.now);
    const hour = calendar(p.game.state.time).hour;
    const haze = hazeActive(w);
    const fogTarget = w.sky === 'fog' ? Math.max(0.25, Math.min(1, (9.5 - hour) / 3)) : 0;
    fx.dark += ((w.sky === 'storm' ? 0.22 : w.sky === 'rain' ? 0.13 : 0) - fx.dark) * k;
    fx.haze += ((haze === 2 ? 0.28 : haze === 1 ? 0.16 : 0) - fx.haze) * k;
    fx.fog += (fogTarget - fx.fog) * k;
    fx.cloud += ((w.sky === 'cloudy' ? 0.06 : 0) - fx.cloud) * k;
    const { ctx, width, height } = p;
    if (fx.cloud > 0.005) {
      ctx.fillStyle = `rgba(70, 80, 100, ${fx.cloud.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (fx.haze > 0.005) {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, `rgba(196, 164, 118, ${(fx.haze * 1.25).toFixed(3)})`);
      g.addColorStop(1, `rgba(176, 150, 118, ${(fx.haze * 0.8).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
    if (fx.fog > 0.005) {
      ctx.fillStyle = `rgba(236, 238, 240, ${(fx.fog * 0.32).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (fx.dark > 0.005) {
      ctx.fillStyle = `rgba(18, 26, 44, ${fx.dark.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
  },
});

// -------------------------------------------------------- road closures
function drawEdges(p: PaintContext, edges: Int32Array, closed: boolean): void {
  const { ctx, game } = p;
  const graph = game.world.graph;
  ctx.beginPath();
  for (const e of edges) {
    const pts = graph.edges[e].pts;
    for (let k = 0; k < pts.length; k += 2) {
      const s = p.toScreen(pts[k], pts[k + 1]);
      if (k === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
  }
  const w = Math.max(3, Math.min(8, (p.zoom - 12) * 1.6));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.strokeStyle = closed ? 'rgba(255, 250, 240, 0.85)' : 'rgba(255, 250, 240, 0.6)';
  ctx.lineWidth = w + 2.5;
  ctx.stroke();
  ctx.setLineDash(closed ? [w * 1.6, w * 1.2] : [w * 0.4, w * 1.4]);
  ctx.strokeStyle = closed ? 'rgba(214, 69, 61, 0.95)' : 'rgba(230, 140, 40, 0.9)';
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.setLineDash([]);
}

registerPainter({
  id: 'closures',
  layer: 'under',
  paint(p: PaintContext) {
    if (p.zoom < 12.8) return;
    const game = p.game;
    const seen = new Set<string>();
    for (const o of activeNow(game)) {
      for (const r of o.event.roads ?? ([] as RoadEffect[])) {
        // Area-wide slowdowns (the whole Old City) are not outlined; named roads are.
        if (!ROAD_SETS[r.set]?.roads || seen.has(r.set)) continue;
        seen.add(r.set);
        const edges = roadSetEdges(game.world.graph, r.set);
        if (edges.length) drawEdges(p, edges, !!r.closed);
      }
    }
  },
});

// ------------------------------------------------------------- traffic
const spriteCache = new Map<string, HTMLCanvasElement>();

function vehicleSprite(kind: 'songthaew' | 'car' | 'motorbike', variant: number): HTMLCanvasElement {
  const key = `${kind}:${variant}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.translate(64, 28);
  g.fillStyle = 'rgba(40, 25, 10, 0.28)';
  g.beginPath();
  if (kind === 'songthaew') {
    // Red pickup with a covered bench bed, facing +x.
    g.ellipse(1, 3, 52, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b8261f';
    g.beginPath();
    g.roundRect(-50, -18, 100, 36, 6);
    g.fill();
    g.fillStyle = '#e8e3da';
    g.beginPath();
    g.roundRect(-48, -16, 64, 32, 4);
    g.fill();
    g.strokeStyle = '#c8312b';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-46, -6);
    g.lineTo(14, -6);
    g.moveTo(-46, 6);
    g.lineTo(14, 6);
    g.stroke();
    g.fillStyle = '#8f1d18';
    g.beginPath();
    g.roundRect(20, -16, 26, 32, 5);
    g.fill();
    g.fillStyle = 'rgba(170, 215, 240, 0.95)';
    g.beginPath();
    g.roundRect(38, -13, 6, 26, 2);
    g.fill();
  } else if (kind === 'car') {
    const body = ['#f2f2ef', '#b9bec6', '#2f4f7a', '#8a2b2b'][variant % 4];
    g.ellipse(1, 3, 38, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(-36, -16, 72, 32, 9);
    g.fill();
    g.fillStyle = 'rgba(40, 55, 70, 0.85)';
    g.beginPath();
    g.roundRect(4, -13, 14, 26, 3);
    g.fill();
    g.beginPath();
    g.roundRect(-28, -12, 10, 24, 3);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.25)';
    g.beginPath();
    g.roundRect(-16, -13, 18, 26, 3);
    g.fill();
  } else {
    const helmet = ['#e8b923', '#d6453d', '#3d6fb6', '#f4f4f4'][variant % 4];
    g.ellipse(0, 2, 22, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.beginPath();
    g.roundRect(-20, -4, 40, 8, 4);
    g.fill();
    g.fillStyle = '#5a3b22';
    g.beginPath();
    g.ellipse(-4, 0, 8, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = helmet;
    g.beginPath();
    g.arc(0, 0, 5, 0, Math.PI * 2);
    g.fill();
  }
  spriteCache.set(key, c);
  return c;
}

const RIVAL_PAINTS = ['khao_soi', 'coop_taxi', 'ev_green', 'tung_lanna', 'kalae_teak'];
const DOT_COLOUR = ['#c8312b', '#e3a21a', '#e9e9e4', '#3a3a3a'];
/** Length of each kind relative to a tuk-tuk. */
const KIND_LEN = [1.6, 0.95, 1.45, 0.62];
const rivalPose: Pose = { x: 0, y: 0, heading: 0 };

registerPainter({
  id: 'rivals',
  layer: 'under',
  paint(p: PaintContext) {
    if (p.zoom < 12.3) return;
    const game = p.game;
    const sys = rivalsOf(game);
    if (!sys) return;
    const { ctx, width, height } = p;
    const tuk = Math.max(16, Math.min(46, 18 + (p.zoom - 13) * 5.5));
    const hour = calendar(game.state.time).hour;
    const night = hour < 6.3 || hour >= 18.2;
    const sprites = p.zoom >= 14;
    ctx.save();
    ctx.globalAlpha = 0.95;
    for (let i = 0; i < sys.count; i++) {
      const pose = sys.poseOf(game, i, rivalPose);
      if (!pose) continue;
      const s = p.toScreen(pose.x, pose.y);
      if (s.x < -40 || s.y < -40 || s.x > width + 40 || s.y > height + 40) continue;
      const kind = sys.kind[i];
      if (!sprites) {
        ctx.fillStyle = DOT_COLOUR[kind];
        ctx.beginPath();
        ctx.arc(s.x, s.y, kind === 3 ? 1.8 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const len = tuk * KIND_LEN[kind];
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(-pose.heading);
      if (RIVAL_KINDS[kind] === 'tuktuk') {
        const img = tuktukSprite(RIVAL_PAINTS[i % RIVAL_PAINTS.length], night);
        const scale = len / (img.width * 0.62);
        ctx.drawImage(img, (-img.width / 2) * scale, (-img.height / 2) * scale, img.width * scale, img.height * scale);
      } else {
        const img = vehicleSprite(RIVAL_KINDS[kind] as 'songthaew' | 'car' | 'motorbike', i);
        const w = RIVAL_KINDS[kind] === 'songthaew' ? 100 : RIVAL_KINDS[kind] === 'car' ? 72 : 40;
        const scale = len / w;
        ctx.drawImage(img, -64 * scale, -28 * scale, 128 * scale, 56 * scale);
      }
      ctx.restore();
    }
    ctx.restore();
  },
});

// ------------------------------------------------------------ festivals
function landmarkXY(game: Game, id: string): { x: number; y: number } | null {
  const l = game.world.landmarks.find((q) => q.id === id);
  return l ? { x: l.x, y: l.y } : null;
}

/** Sky lanterns drifting high across the view, from the licensed release sites outside the city. */
function skyLanterns(p: PaintContext, strength: number): void {
  const { ctx, width, height } = p;
  const t = p.now / 1000;
  const img = glow('rgba(255, 240, 190, 1)', 'rgba(255, 170, 60, 0.55)');
  const n = Math.round(34 * strength);
  for (let i = 0; i < n; i++) {
    const speed = 7 + rand(i, 1) * 10;
    const span = height + 80;
    const y = height + 40 - ((t * speed + rand(i, 2) * span) % span);
    const x = ((rand(i, 3) * (width + 120) + t * (3 + rand(i, 4) * 4) + Math.sin(t * 0.4 + i) * 14) % (width + 120)) - 60;
    const size = 9 + rand(i, 5) * 9;
    const fade = Math.min(1, Math.max(0, y / (height * 0.35)));
    ctx.globalAlpha = fade * (0.75 + 0.25 * Math.sin(t * 3 + i * 1.7)) * strength;
    ctx.drawImage(img, x - size, y - size, size * 2, size * 2);
    ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
    ctx.fillRect(x - size * 0.14, y - size * 0.2, size * 0.28, size * 0.36);
  }
  ctx.globalAlpha = 1;
}

/** Krathong candles floating downstream on the Ping between Nawarat Bridge and the Iron Bridge. */
function krathongs(p: PaintContext): void {
  const game = p.game;
  const a = landmarkXY(game, 'nawarat_bridge');
  const b = landmarkXY(game, 'iron_bridge');
  if (!a || !b || p.zoom < 13.5) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const t = p.now / 1000;
  const img = glow('rgba(255, 245, 200, 1)', 'rgba(255, 190, 80, 0.6)');
  const size = Math.max(4, Math.min(12, (p.zoom - 12) * 2.6));
  const { ctx } = p;
  for (let i = 0; i < 40; i++) {
    // Flows north → south, a little past each bridge.
    const u = ((rand(i, 7) + t * 0.006 * (0.5 + rand(i, 8))) % 1) * 1.3 - 0.15;
    const off = (rand(i, 9) - 0.5) * 50;
    const s = p.toScreen(a.x + dx * u + nx * off, a.y + dy * u + ny * off);
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 5 + i);
    ctx.drawImage(img, s.x - size, s.y - size, size * 2, size * 2);
  }
  ctx.globalAlpha = 1;
}

/** A ring of hanging lanterns around a landmark (Yi Peng displays at Tha Phae Gate, red lanterns at Warorot). */
function lanternDisplay(p: PaintContext, id: string, core: string, halo: string): void {
  if (p.zoom < 14) return;
  const at = landmarkXY(p.game, id);
  if (!at) return;
  const t = p.now / 1000;
  const img = glow(core, halo);
  const size = Math.max(6, Math.min(14, (p.zoom - 13) * 3));
  const { ctx } = p;
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + rand(i, 11) * 0.3;
    const r = 35 + rand(i, 12) * 45;
    const s = p.toScreen(at.x + Math.cos(ang) * r, at.y + Math.sin(ang) * r);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 2.2 + i * 2.1);
    ctx.drawImage(img, s.x - size, s.y - size, size * 2, size * 2);
  }
  ctx.globalAlpha = 1;
}

/** Moat bounds for Songkran splashes: calendar.md §7, moat roads span 18.7810–18.7960 N, 98.9775–98.9939 E. */
const MOAT = { s: 18.7815, n: 18.7955, w: 98.978, e: 98.9935 };

function songkranSplashes(p: PaintContext, strength: number): void {
  if (p.zoom < 13.3) return;
  const graph = p.game.world.graph;
  const [x0, y0] = graph.projection.toXY(MOAT.w, MOAT.s);
  const [x1, y1] = graph.projection.toXY(MOAT.e, MOAT.n);
  const w = x1 - x0;
  const h = y1 - y0;
  const per = 2 * (w + h);
  const t = p.now / 1000;
  const { ctx } = p;
  const scale = Math.max(0.6, Math.min(1.6, (p.zoom - 12) / 3));
  const n = Math.round(26 * strength);
  ctx.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const period = 1.4 + rand(i, 20) * 0.8;
    const phase = t / period + rand(i, 21);
    const cycle = Math.floor(phase);
    const local = phase - cycle;
    let d = rand(i * 131 + cycle, 22) * per;
    let x: number;
    let y: number;
    if (d < w) [x, y] = [x0 + d, y0];
    else if ((d -= w) < h) [x, y] = [x1, y0 + d];
    else if ((d -= h) < w) [x, y] = [x1 - d, y1];
    else [x, y] = [x0, y1 - (d - w)];
    const s = p.toScreen(x, y);
    const r = (4 + local * 16) * scale;
    const alpha = (1 - local) * 0.85;
    ctx.strokeStyle = `rgba(110, 190, 255, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(160, 215, 255, ${alpha.toFixed(3)})`;
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + rand(i, 23 + k) * 0.6;
      const rr = r * (1.1 + local * 0.6);
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr - local * 6 * scale, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

registerPainter({
  id: 'festival',
  layer: 'over',
  paint(p: PaintContext) {
    const game = p.game;
    const hour = calendar(game.state.time).hour;
    const dark = hour >= 17.8 || hour < 5;
    if (isActive(game, 'yi_peng') && dark) {
      lanternDisplay(p, 'tha_phae_gate', 'rgba(255, 236, 180, 1)', 'rgba(255, 160, 60, 0.55)');
      krathongs(p);
      skyLanterns(p, isActive(game, 'krathong_parade') ? 1 : 0.75);
    }
    if (isActive(game, 'chinese_new_year')) lanternDisplay(p, 'warorot_market', 'rgba(255, 200, 170, 1)', 'rgba(220, 40, 30, 0.6)');
    if (isActive(game, 'songkran')) songkranSplashes(p, 1);
    else if (isActive(game, 'songkran_buildup')) songkranSplashes(p, 0.45);
  },
});

// ---------------------------------------------------------- weather: fx
const STREAKS = 300;

registerPainter({
  id: 'weather-fx',
  layer: 'over',
  paint(p: PaintContext) {
    const w = currentWeather(p.game);
    // Per-frame easing, so streaks thicken and thin out over about a second.
    const k = 0.04;
    fx.rain += ((w.sky === 'rain' ? 0.6 : w.sky === 'storm' ? 1 : 0) - fx.rain) * k;
    fx.storm += ((w.sky === 'storm' ? 1 : 0) - fx.storm) * k;
    const { ctx, width, height } = p;
    if (fx.rain > 0.02) {
      const n = Math.round(Math.min(STREAKS, (width * height) / 3200) * fx.rain);
      const t = p.now / 1000;
      const slant = 0.18 + fx.storm * 0.2;
      const len = 11 + fx.storm * 8;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = 520 + rand(i, 30) * 380;
        const y = (rand(i, 31) * (height + 40) + t * v) % (height + 40) - 20;
        const x = (rand(i, 32) * (width + 60) + y * slant) % (width + 60) - 30;
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * slant, y + len);
      }
      ctx.strokeStyle = `rgba(205, 222, 245, ${(0.25 + 0.3 * fx.rain).toFixed(3)})`;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    if (fx.storm > 0.3) {
      // A subtle flash every few seconds.
      const period = 2600;
      const cycle = Math.floor(p.now / period);
      const into = p.now - cycle * period;
      if (rand(cycle, 40) < 0.3 && into < 220) {
        ctx.fillStyle = `rgba(235, 240, 255, ${(0.2 * (1 - into / 220) * fx.storm).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }
    }
  },
});
