import { Map as MLMap, setWorkerUrl } from 'maplibre-gl';
// MapLibre resolves its worker relative to its own module URL, which breaks
// once Vite bundles it; hand it a Vite-bundled worker instead.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ARCHETYPES } from '../content/archetypes';
import { bookingTag } from '../sim/business';
import { calendar, daylight } from '../sim/clock';
import type { Game } from '../sim/game';
import type { Pose } from '../sim/graph';
import type { Place, RideRequest, Vehicle } from '../sim/types';
import { ui } from '../ui/store';
import { OVERLAY_PAINTERS, type PaintContext } from './painters';
import type { GameView } from '../ui/view';
import { buildStyle } from './style';
import { TUKTUK_SPRITE_H, TUKTUK_SPRITE_W, emojiImage, onewayArrow, passengerBadge, tuktukSprite } from './sprites';

const LANDMARK_ICON: Record<string, [string, string]> = {
  gate: ['🏯', '#a4502c'],
  temple: ['🛕', '#d9a13b'],
  market: ['🧺', '#d9772b'],
  mall: ['🛍️', '#b0569b'],
  transport: ['🚌', '#3d6fb6'],
  university: ['🎓', '#6f4bb5'],
  hospital: ['🏥', '#c94c4c'],
  viewpoint: ['🌉', '#3f8fb3'],
  nightlife: ['🍻', '#8e44ad'],
  attraction: ['📸', '#2e8b74'],
  museum: ['🏛️', '#7a6a52'],
  park: ['🌳', '#4f9a4a'],
  hotel: ['🏨', '#51708f'],
};

const ICON_OVERRIDE: Record<string, string> = {
  cnx_airport: '✈️',
  railway_station: '🚆',
  chiang_mai_zoo: '🦒',
  night_safari: '🐅',
  thapae_boxing: '🥊',
  loi_kroh_boxing: '🥊',
  three_kings: '👑',
  wat_doi_suthep: '⛰️',
  sunday_walking_street: '🏮',
  saturday_walking_street: '🏮',
  night_bazaar: '🏮',
};

const HIT_RADIUS = 20;

setWorkerUrl(maplibreWorkerUrl);

export interface MapViewOptions {
  base: string;
}

export class MapView implements GameView {
  readonly kind = 'map' as const;
  readonly map: MLMap;
  private readonly overlay: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly game: Game;
  private raf = 0;
  private dpr = 1;
  private hoverRequest: number | null = null;
  private readonly pose: Pose = { x: 0, y: 0, heading: 0 };
  private destroyed = false;

  constructor(container: HTMLElement, game: Game, opts: MapViewOptions) {
    this.game = game;
    const graph = game.world.graph;
    const start = game.playerVehicle();
    const startPose = start ? game.vehiclePose(start) : { x: 0, y: 0 };
    const [lon, lat] = graph.projection.toLngLat(startPose.x, startPose.y);
    this.map = new MLMap({
      container,
      style: buildStyle(opts.base),
      center: [lon, lat],
      zoom: 16,
      minZoom: 11.5,
      maxZoom: 19,
      maxBounds: [
        [98.86, 18.7],
        [99.1, 18.88],
      ],
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true, customAttribution: 'Map data © OpenStreetMap contributors (ODbL)' },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disable();

    this.overlay = document.createElement('canvas');
    this.overlay.className = 'map-overlay';
    container.appendChild(this.overlay);
    this.ctx = this.overlay.getContext('2d')!;
    this.resize();
    this.map.on('resize', () => this.resize());
    this.map.on('load', () => this.onLoad());
    this.map.on('styleimagemissing', (e) => {
      if (e.id === 'oneway' && !this.map.hasImage('oneway')) this.map.addImage('oneway', onewayArrow(), { pixelRatio: 1 });
    });
    this.map.on('dragstart', () => ui.set({ follow: false }));
    this.map.on('click', (e) => this.onClick(e.point.x, e.point.y));
    this.map.on('contextmenu', (e) => this.onDriveHere(e.lngLat.lng, e.lngLat.lat));
    this.map.on('mousemove', (e) => this.onHover(e.point.x, e.point.y));
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.map.remove();
  }

  /** Centre the camera on a game-space point. */
  flyTo(x: number, y: number, zoom?: number): void {
    const [lng, lat] = this.game.world.graph.projection.toLngLat(x, y);
    this.map.easeTo({ center: [lng, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 15), duration: 600 });
  }

  private resize(): void {
    const rect = this.map.getContainer().getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(rect.width * this.dpr);
    this.overlay.height = Math.round(rect.height * this.dpr);
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
  }

  private onLoad(): void {
    const map = this.map;
    if (!map.hasImage('oneway')) map.addImage('oneway', onewayArrow(), { pixelRatio: 1 });
    const icons = new Set<string>();
    const features = this.game.world.landmarks.map((p) => {
      const [emoji, bg] = LANDMARK_ICON[p.cat] ?? ['📍', '#7a6a52'];
      const e = ICON_OVERRIDE[p.id] ?? emoji;
      const icon = `lm-${e}-${bg}`;
      if (!icons.has(icon)) {
        icons.add(icon);
        map.addImage(icon, emojiImage(e, bg, 64), { pixelRatio: 2 });
      }
      const [lng, lat] = this.game.world.graph.projection.toLngLat(p.x, p.y);
      return {
        type: 'Feature' as const,
        properties: { name: p.name, idx: p.idx, icon, rank: p.cat === 'transport' || p.cat === 'gate' ? 0 : 1 },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      };
    });
    map.addImage('fuel', emojiImage('⛽', '#2f7d4f', 48), { pixelRatio: 2 });
    const fuel = this.game.world.lpgStations.map((p) => {
      const [lng, lat] = this.game.world.graph.projection.toLngLat(p.x, p.y);
      return {
        type: 'Feature' as const,
        properties: { name: `${p.name} (LPG)`, idx: p.idx },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      };
    });
    map.addSource('landmarks', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addSource('fuel', { type: 'geojson', data: { type: 'FeatureCollection', features: fuel } });
    map.addLayer({
      id: 'fuel-icons',
      type: 'symbol',
      source: 'fuel',
      minzoom: 13.5,
      layout: { 'icon-image': 'fuel', 'icon-size': 0.9, 'icon-allow-overlap': false },
    });
    map.addLayer({
      id: 'landmark-icons',
      type: 'symbol',
      source: 'landmarks',
      minzoom: 12,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1],
        'symbol-sort-key': ['get', 'rank'],
        'text-field': ['step', ['zoom'], '', 14, ['get', 'name']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11.5,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'text-color': '#3b2a18',
        'text-halo-color': 'rgba(255, 248, 232, 0.95)',
        'text-halo-width': 1.6,
      },
    });
    map.on('mouseenter', 'landmark-icons', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'landmark-icons', () => (map.getCanvas().style.cursor = ''));
  }

  // ------------------------------------------------------------------ input
  private screenOf(x: number, y: number): { x: number; y: number } {
    const [lng, lat] = this.game.world.graph.projection.toLngLat(x, y);
    return this.map.project([lng, lat]);
  }

  private requestAt(px: number, py: number): RideRequest | null {
    let best: RideRequest | null = null;
    let bestD = HIT_RADIUS;
    for (const r of this.game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== this.game.playerVehicle()?.id) continue;
      const p = this.game.place(r.from);
      const s = this.screenOf(p.x, p.y);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  private vehicleAt(px: number, py: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = HIT_RADIUS;
    for (const v of this.game.state.vehicles) {
      const pose = this.game.vehiclePose(v, this.pose);
      const s = this.screenOf(pose.x, pose.y);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private onClick(px: number, py: number): void {
    const req = this.requestAt(px, py);
    if (req) {
      ui.set({ selectedRequest: req.id, selectedPlace: null });
      return;
    }
    const v = this.vehicleAt(px, py);
    if (v) {
      ui.set({ selectedVehicle: v.id, selectedRequest: null, selectedPlace: null, follow: true });
      return;
    }
    const hits = this.map.getLayer('landmark-icons')
      ? this.map.queryRenderedFeatures([px, py], { layers: ['landmark-icons', 'fuel-icons'] })
      : [];
    if (hits.length) {
      ui.set({ selectedPlace: hits[0].properties.idx as number, selectedRequest: null });
      return;
    }
    ui.set({ selectedRequest: null, selectedPlace: null });
  }

  private onDriveHere(lng: number, lat: number): void {
    const [x, y] = this.game.world.graph.projection.toXY(lng, lat);
    if (this.game.playerDriveTo(x, y)) this.game.notify('Heading there.', 'info');
  }

  private onHover(px: number, py: number): void {
    const req = this.requestAt(px, py);
    this.hoverRequest = req?.id ?? null;
    const overVehicle = !req && this.vehicleAt(px, py);
    if (req || overVehicle) this.map.getCanvas().style.cursor = 'pointer';
    else if (this.map.getCanvas().style.cursor === 'pointer' && !this.map.queryRenderedFeatures([px, py], { layers: this.map.getLayer('landmark-icons') ? ['landmark-icons'] : [] }).length)
      this.map.getCanvas().style.cursor = '';
  }

  // ------------------------------------------------------------------ frame
  private frame = (now: number): void => {
    if (this.destroyed) return;
    this.followCamera();
    this.applyLighting();
    this.draw(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private followTarget(): Vehicle | undefined {
    const s = ui.get();
    if (s.selectedVehicle !== null) return this.game.vehicle(s.selectedVehicle);
    return this.game.playerVehicle();
  }

  private followCamera(): void {
    if (!ui.get().follow || this.map.isMoving()) return;
    const v = this.followTarget();
    if (!v) return;
    const pose = this.game.vehiclePose(v, this.pose);
    const [lng, lat] = this.game.world.graph.projection.toLngLat(pose.x, pose.y);
    const c = this.map.getCenter();
    const k = 0.15;
    this.map.jumpTo({ center: [c.lng + (lng - c.lng) * k, c.lat + (lat - c.lat) * k] });
  }

  private lastLight = -1;

  private applyLighting(): void {
    const cal = calendar(this.game.state.time);
    const light = Math.round(daylight(cal.hour) * 50) / 50;
    if (light === this.lastLight) return;
    this.lastLight = light;
    const canvas = this.map.getCanvas();
    const b = 0.42 + 0.58 * light;
    const sat = 0.7 + 0.3 * light;
    canvas.style.filter = light >= 1 ? '' : `brightness(${b.toFixed(2)}) saturate(${sat.toFixed(2)}) hue-rotate(${Math.round((1 - light) * 12)}deg)`;
  }

  private tuktukLengthPx(): number {
    const z = this.map.getZoom();
    return Math.max(16, Math.min(46, 18 + (z - 13) * 5.5));
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const game = this.game;
    const s = ui.get();
    const night = daylight(calendar(game.state.time).hour) < 0.5;
    const player = game.playerVehicle();

    const pc: PaintContext = {
      ctx,
      game,
      width: w / this.dpr,
      height: h / this.dpr,
      zoom: this.map.getZoom(),
      now,
      toScreen: (x, y) => this.screenOf(x, y),
    };
    for (const p of OVERLAY_PAINTERS) if (p.layer === 'under') p.paint(pc);

    // Routes: player's (or selected vehicle's) remaining route.
    const routeVehicle = s.selectedVehicle !== null ? game.vehicle(s.selectedVehicle) : player;
    if (routeVehicle?.route) this.drawRoute(routeVehicle, routeVehicle === player ? '#e0457b' : '#3d6fb6');

    // Selected request: dashed line to the destination.
    const selReq = s.selectedRequest !== null ? game.state.requests.find((r) => r.id === s.selectedRequest) : undefined;
    if (selReq) this.drawRequestLink(selReq);
    if (player?.task.kind === 'trip') this.drawDestinationPin(game.place(player.task.trip.request.to), '#e0457b');

    // Passengers.
    const badge = Math.max(26, Math.min(40, this.tuktukLengthPx() * 0.95));
    for (const r of game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      const p = game.place(r.from);
      const sp = this.screenOf(p.x, p.y);
      if (sp.x < -50 || sp.y < -50 || sp.x > w / this.dpr + 50 || sp.y > h / this.dpr + 50) continue;
      this.drawPassenger(r, sp.x, sp.y, badge, now, r.id === s.selectedRequest || r.id === this.hoverRequest);
    }

    // Tuk-tuks.
    const len = this.tuktukLengthPx();
    for (const v of game.state.vehicles) {
      const pose = game.vehiclePose(v, this.pose);
      const sp = this.screenOf(pose.x, pose.y);
      if (sp.x < -60 || sp.y < -60 || sp.x > w / this.dpr + 60 || sp.y > h / this.dpr + 60) continue;
      this.drawTukTuk(v, sp.x, sp.y, pose.heading, len, night, v === player, v.id === s.selectedVehicle);
    }
    for (const p of OVERLAY_PAINTERS) if (p.layer === 'over') p.paint(pc);
  }

  private drawRoute(v: Vehicle, color: string): void {
    const route = v.route;
    if (!route) return;
    const graph = this.game.world.graph;
    const ctx = this.ctx;
    ctx.beginPath();
    const here = graph.poseAt(v.arc, v.s);
    let s0 = this.screenOf(here.x, here.y);
    ctx.moveTo(s0.x, s0.y);
    for (let i = v.routeIdx; i < route.arcs.length; i++) {
      const arc = route.arcs[i];
      const e = graph.edges[arc >> 1];
      const rev = (arc & 1) === 1;
      const n = e.pts.length / 2;
      for (let k = 0; k < n; k++) {
        const idx = rev ? n - 1 - k : k;
        const d = e.cum[idx];
        const along = rev ? e.len - d : d;
        if (i === v.routeIdx && along <= v.s) continue;
        s0 = this.screenOf(e.pts[2 * idx], e.pts[2 * idx + 1]);
        ctx.lineTo(s0.x, s0.y);
      }
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.5;
    ctx.stroke();
  }

  private drawRequestLink(r: RideRequest): void {
    const a = this.game.place(r.from);
    const b = this.game.place(r.to);
    const sa = this.screenOf(a.x, a.y);
    const sb = this.screenOf(b.x, b.y);
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(59, 42, 24, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.restore();
    this.drawDestinationPin(b, ARCHETYPES[r.archetype].color);
  }

  private drawDestinationPin(p: Place, color: string): void {
    const s = this.screenOf(p.x, p.y);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = 'rgba(40,25,10,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fffaf0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-4, -8, -11, -12, -11, -20);
    ctx.arc(0, -20, 11, Math.PI, 0);
    ctx.bezierCurveTo(11, -12, 4, -8, 0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(0, -20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,250,240,0.95)';
    ctx.strokeText(p.name, 0, -36);
    ctx.fillStyle = '#3b2a18';
    ctx.fillText(p.name, 0, -36);
    ctx.restore();
  }

  private drawPassenger(r: RideRequest, x: number, y: number, size: number, now: number, highlight: boolean): void {
    const ctx = this.ctx;
    const info = ARCHETYPES[r.archetype];
    const game = this.game;
    const left = Math.max(0, (r.expiresAt - game.state.time) / (r.expiresAt - r.spawnedAt));
    const pulse = 1 + Math.sin(now / 250 + r.id) * 0.06;
    const sz = size * pulse * (highlight ? 1.2 : 1);
    ctx.save();
    ctx.translate(x, y - sz * 0.35);
    // Patience ring.
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, sz / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = left > 0.5 ? '#3aa35b' : left > 0.2 ? '#e0a526' : '#d6453d';
    ctx.beginPath();
    ctx.arc(0, 0, sz / 2 + 3, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    ctx.stroke();
    ctx.drawImage(passengerBadge(r.archetype), -sz / 2, -sz / 2, sz, sz);
    if (r.party > 1) {
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(sz / 2 - 2, -sz / 2 + 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(r.party), sz / 2 - 2, -sz / 2 + 2.5);
    }
    if (this.map.getZoom() >= 14.5 || highlight) {
      const label = r.fixedFare !== null ? `${bookingTag(game, r)?.icon ?? '📱'}฿${r.fixedFare}` : `~฿${r.fairFare}`;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(59, 42, 24, 0.88)';
      const by = sz / 2 + 6;
      ctx.beginPath();
      ctx.roundRect(-tw / 2, by, tw, 17, 8);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(label, 0, by + 13);
    }
    ctx.restore();
  }

  private drawTukTuk(v: Vehicle, x: number, y: number, heading: number, len: number, night: boolean, isPlayer: boolean, selected: boolean): void {
    const ctx = this.ctx;
    const sprite = tuktukSprite(v.paint, night);
    const scale = len / (TUKTUK_SPRITE_W * 0.62);
    ctx.save();
    ctx.translate(x, y);
    if (isPlayer || selected) {
      ctx.fillStyle = isPlayer ? 'rgba(224, 69, 123, 0.22)' : 'rgba(61, 111, 182, 0.22)';
      ctx.strokeStyle = isPlayer ? '#e0457b' : '#3d6fb6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, len * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.rotate(-heading);
    ctx.drawImage(sprite, (-TUKTUK_SPRITE_W / 2) * scale, (-TUKTUK_SPRITE_H / 2) * scale, TUKTUK_SPRITE_W * scale, TUKTUK_SPRITE_H * scale);
    ctx.restore();
    const status = this.statusIcon(v);
    if (status) {
      ctx.font = `${Math.round(len * 0.5)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(status, x, y - len * 0.45);
    }
  }

  private statusIcon(v: Vehicle): string {
    switch (v.task.kind) {
      case 'broken':
        return '🔧';
      case 'offduty':
        return '💤';
      case 'refuel':
        return '⛽';
      case 'trip':
        return ARCHETYPES[v.task.trip.request.archetype].icon;
      case 'haggle':
        return '💬';
      default:
        return v.fuel < 0.12 ? '⚠️' : '';
    }
  }
}
