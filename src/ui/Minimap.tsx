import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { ARCHETYPES } from '../content/archetypes';
import type { Game } from '../sim/game';
import type { RoadGraph } from '../sim/graph';
import { kerbPoint, setAutodrive } from '../sim/manual';
import {
  graphBounds,
  overviewFrame,
  overviewToScreen,
  radarRim,
  radarRotation,
  radarToScreen,
  screenToOverview,
  screenToRadar,
  type Bounds,
  type OverviewFrame,
  type RadarFrame,
} from './minimapMath';
import type { OverlayProps } from './overlays';
import { ui, useUI } from './store';
import './drive/drive.css';

/** Metres per pixel of the pre-rendered road map. */
const MPP = 4;
/** Radar radius, metres, and the sizes of both minimaps in CSS pixels. */
const RADAR_M = 500;
const RADAR_PX = 176;
const OVERVIEW_W = 250;
/** Redraws per second. */
const FPS = 15;
const PLAYER = '#e0457b';
const FLEET = '#5d8fe0';

interface RoadImage {
  canvas: HTMLCanvasElement;
  bounds: Bounds;
}

const images = new WeakMap<RoadGraph, RoadImage>();

/** The road network drawn once at MPP metres per pixel, north up. */
function roadImage(graph: RoadGraph): RoadImage {
  let img = images.get(graph);
  if (img) return img;
  const bounds = graphBounds(graph.nodeX, graph.nodeY);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((bounds.maxX - bounds.minX) / MPP);
  canvas.height = Math.ceil((bounds.maxY - bounds.minY) / MPP);
  const g = canvas.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Minor roads first so main roads draw on top.
  for (let cls = 7; cls >= 0; cls--) {
    g.strokeStyle = cls <= 1 ? 'rgba(244, 215, 122, 0.95)' : cls <= 3 ? 'rgba(251, 243, 226, 0.85)' : 'rgba(233, 220, 194, 0.45)';
    g.lineWidth = cls <= 1 ? 3.4 : cls <= 3 ? 2.4 : cls === 7 ? 0.9 : 1.3;
    g.beginPath();
    for (const e of graph.edges) {
      if (e.cls !== cls || e.virtual) continue;
      for (let k = 0; k < e.pts.length / 2; k++) {
        const x = (e.pts[2 * k] - bounds.minX) / MPP;
        const y = (bounds.maxY - e.pts[2 * k + 1]) / MPP;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.stroke();
  }
  img = { canvas, bounds };
  images.set(graph, img);
  return img;
}

/** Where the player's tuk-tuk is heading: the passenger to fetch, the drop-off, or the end of its route. */
function destinationOf(game: Game): { x: number; y: number } | null {
  const v = game.playerVehicle();
  if (!v) return null;
  const g = game.world.graph;
  const t = v.task;
  if (t.kind === 'trip') {
    const p = game.place(t.trip.request.to);
    return { x: g.nodeX[p.node], y: g.nodeY[p.node] };
  }
  if (t.kind === 'pickup') {
    const r = game.state.requests.find((q) => q.id === t.requestId);
    if (r) return kerbPoint(game, game.place(r.from));
  }
  if (v.route) return { x: g.nodeX[v.route.target], y: g.nodeY[v.route.target] };
  return null;
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(20, 12, 5, 0.8)';
  g.lineWidth = 1;
  g.stroke();
}

/** A triangle pointing along `angle` (canvas radians). */
function pointer(g: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, fill: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = fill;
  g.strokeStyle = 'rgba(20, 12, 5, 0.85)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(size, 0);
  g.lineTo(-size * 0.7, -size * 0.65);
  g.lineTo(-size * 0.35, 0);
  g.lineTo(-size * 0.7, size * 0.65);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * Minimap in the corner. Drive: a heading-up radar of the roads within
 * RADAR_M metres, with waiting passengers, the fleet and the way to your
 * destination. Manage: a north-up map of the whole area with the camera's
 * view outlined; click to fly the camera there. Right-click either to send
 * your tuk-tuk somewhere.
 */
export function Minimap({ game, view }: OverlayProps) {
  const mode = useUI((s) => s.mode);
  const planner = useUI((s) => s.planner);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef<{ radar: RadarFrame | null; overview: OverviewFrame | null }>({ radar: null, overview: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || planner) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const roads = roadImage(game.world.graph);
    const b = roads.bounds;
    const overviewH = Math.round((OVERVIEW_W * (b.maxY - b.minY)) / (b.maxX - b.minX));
    const w = mode === 'drive' ? RADAR_PX : OVERVIEW_W;
    const h = mode === 'drive' ? RADAR_PX : overviewH;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    let heading: number | null = null;
    let raf = 0;
    let last = 0;

    const drawRadar = (dt: number) => {
      const v = game.playerVehicle();
      const r = w / 2;
      g.save();
      g.beginPath();
      g.arc(r, r, r - 1, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = 'rgba(24, 16, 9, 0.9)';
      g.fillRect(0, 0, w, h);
      if (!v) {
        g.restore();
        return;
      }
      const pose = game.vehiclePose(v);
      if (heading === null) heading = pose.heading;
      else {
        let d = pose.heading - heading;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        heading += d * (1 - Math.exp(-dt / 0.35));
      }
      const f: RadarFrame = { cx: r, cy: r, x: pose.x, y: pose.y, heading, radiusM: RADAR_M, radiusPx: r - 2 };
      frame.current.radar = f;
      const s = f.radiusPx / f.radiusM;
      g.save();
      g.translate(r, r);
      g.rotate(radarRotation(heading));
      g.scale(s * MPP, s * MPP);
      g.drawImage(roads.canvas, -(pose.x - b.minX) / MPP, -(b.maxY - pose.y) / MPP);
      g.restore();
      // Range ring.
      g.strokeStyle = 'rgba(232, 185, 35, 0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(r, r, f.radiusPx / 2, 0, Math.PI * 2);
      g.stroke();
      for (const other of game.state.vehicles) {
        if (other === v) continue;
        const p = game.vehiclePose(other);
        const q = radarToScreen(f, p.x, p.y);
        if (q.inside) dot(g, q.x, q.y, 3.2, FLEET);
      }
      for (const req of game.visibleTo(v)) {
        if (req.claimedBy !== null && req.claimedBy !== v.id) continue;
        const k = kerbPoint(game, game.place(req.from));
        const q = radarToScreen(f, k.x, k.y);
        if (q.inside) dot(g, q.x, q.y, 4, ARCHETYPES[req.archetype].color);
      }
      const dest = destinationOf(game);
      if (dest) {
        const q = radarToScreen(f, dest.x, dest.y);
        if (q.inside) dot(g, q.x, q.y, 5.5, PLAYER);
        else {
          const rim = radarRim(f, dest.x, dest.y, 10);
          pointer(g, rim.x, rim.y, rim.angle, 9, PLAYER);
        }
      }
      const north = radarRim(f, pose.x, pose.y + RADAR_M * 2, 9);
      g.font = '700 10px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#f4d77a';
      g.fillText('N', north.x, north.y);
      pointer(g, r, r, -Math.PI / 2, 8, PLAYER);
      g.restore();
      g.strokeStyle = 'rgba(232, 185, 35, 0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r, r, r - 1, 0, Math.PI * 2);
      g.stroke();
    };

    const drawOverview = () => {
      const f = overviewFrame(b, w, h);
      frame.current.overview = f;
      g.fillStyle = 'rgba(24, 16, 9, 0.9)';
      g.fillRect(0, 0, w, h);
      g.drawImage(roads.canvas, f.ox, f.oy, (b.maxX - b.minX) * f.scale, (b.maxY - b.minY) * f.scale);
      const fp = view?.footprint?.();
      if (fp && fp.length) {
        g.beginPath();
        fp.forEach((p, i) => {
          const q = overviewToScreen(f, p.x, p.y);
          if (i === 0) g.moveTo(q.x, q.y);
          else g.lineTo(q.x, q.y);
        });
        g.closePath();
        g.fillStyle = 'rgba(232, 185, 35, 0.12)';
        g.fill();
        g.strokeStyle = 'rgba(244, 215, 122, 0.9)';
        g.lineWidth = 1.5;
        g.stroke();
      }
      for (const req of game.visibleRequests()) {
        const p = game.place(req.from);
        const q = overviewToScreen(f, p.x, p.y);
        dot(g, q.x, q.y, 1.8, ARCHETYPES[req.archetype].color);
      }
      const player = game.playerVehicle();
      for (const v of game.state.vehicles) {
        if (v.task.kind === 'away') continue;
        const p = game.vehiclePose(v);
        const q = overviewToScreen(f, p.x, p.y);
        dot(g, q.x, q.y, v === player ? 4 : 3, v === player ? PLAYER : FLEET);
      }
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / FPS) return;
      const dt = last ? Math.min(0.5, (now - last) / 1000) : 0;
      last = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (mode === 'drive') drawRadar(dt);
      else drawOverview();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game, view, mode, planner]);

  if (planner) return null;

  const simAt = (e: ReactMouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const f = frame.current;
    if (mode === 'drive') return f.radar ? screenToRadar(f.radar, px, py) : null;
    return f.overview ? screenToOverview(f.overview, px, py) : null;
  };

  return (
    <div className={`minimap minimap-${mode}`} aria-label={mode === 'drive' ? 'Radar' : 'City overview'}>
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          if (mode !== 'manage') return;
          const p = simAt(e);
          if (!p || !view) return;
          ui.set({ follow: false });
          view.flyTo(p.x, p.y);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = simAt(e);
          if (!p || !game.playerDriveTo(p.x, p.y)) return;
          if (ui.get().mode === 'drive') setAutodrive(game, true);
          game.notify('Heading there.', 'info');
        }}
      />
      <div className="minimap-hint">{mode === 'drive' ? 'Right-click: drive there' : 'Click: look · right-click: drive there'}</div>
    </div>
  );
}
