// The 2.5-D world view: a three.js city generated from OpenStreetMap data, a
// tilted follow camera, and layers for the environment, the static city,
// vehicles, people and markers, with a 2D HUD canvas on top.

import {
  MeshLambertMaterial,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { calendar } from '../sim/clock';
import type { Game } from '../sim/game';
import type { Pose } from '../sim/graph';
import type { Place, RideRequest, Vehicle } from '../sim/types';
import { ui } from '../ui/store';
import type { GameView } from '../ui/view';
import type { BuiltCity } from './build/world';
import { Hud } from './hud';
import { CityLayer } from './layers/city';
import { Environment } from './layers/environment';
import { MarkerLayer } from './layers/markers';
import { PeopleLayer } from './layers/people';
import type { FrameInfo, ViewContext, WorldLayer } from './layers/types';
import { VehicleLayer } from './layers/vehicles';

export interface World3DOptions {
  base: string;
}

interface BuildResult {
  built: BuiltCity;
  play: [number, number, number, number];
  keep: [number, number, number, number];
}

let cityPromise: Promise<BuildResult> | null = null;

/** Build the static city once per page (in a worker); remounts reuse it. */
export function loadCityMeshes(base: string): Promise<BuildResult> {
  if (!cityPromise) {
    cityPromise = new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./build/worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ ok: boolean; built?: BuiltCity; play?: BuildResult['play']; keep?: BuildResult['keep']; error?: string }>) => {
        worker.terminate();
        if (e.data.ok && e.data.built) resolve({ built: e.data.built, play: e.data.play!, keep: e.data.keep! });
        else reject(new Error(e.data.error ?? 'city build failed'));
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage({ url: new URL('data/city3d.json', base).href });
    });
    cityPromise.catch(() => (cityPromise = null));
  }
  return cityPromise;
}

const DEG = Math.PI / 180;
const HIT_RADIUS = 22;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class World3DView implements GameView, ViewContext {
  readonly kind = '3d' as const;
  readonly game: Game;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 1, 40_000);
  readonly renderer: WebGLRenderer;
  readonly modelMat = new MeshLambertMaterial({ vertexColors: true });
  /** Camera rig: target (sim metres), distance, compass yaw of the view direction. */
  readonly rig = { tx: 0, ty: 0, dist: 220, yaw: 0 };
  hoverRequest: number | null = null;

  private readonly container: HTMLElement;
  private readonly env: Environment;
  private readonly vehicles: VehicleLayer;
  private readonly layers: WorldLayer[] = [];
  private readonly hud: Hud;
  private city: CityLayer | null = null;
  private tiltOffset = 0;
  private fly: { fromX: number; fromY: number; toX: number; toY: number; fromD: number; toD: number; t: number } | null = null;
  private raf = 0;
  private last = performance.now();
  private destroyed = false;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private readonly pose: Pose = { x: 0, y: 0, heading: 0 };
  private readonly v3 = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private drag: { button: number; x: number; y: number; moved: boolean; groundX: number; groundY: number } | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(container: HTMLElement, game: Game, opts: World3DOptions) {
    this.game = game;
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = 'world-gl';
    container.appendChild(this.renderer.domElement);
    this.hud = new Hud(this, container);

    this.env = new Environment(this);
    this.vehicles = new VehicleLayer(this);
    this.layers.push(this.env, this.vehicles, new PeopleLayer(this), new MarkerLayer(this));

    const start = game.playerVehicle();
    if (start) {
      const p = game.vehiclePose(start);
      this.rig.tx = p.x;
      this.rig.ty = p.y;
    }

    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.cleanups.push(() => ro.disconnect());
    this.bindInput();

    loadCityMeshes(opts.base).then(
      (res) => {
        if (this.destroyed) return;
        this.city = new CityLayer(this, res.built);
        this.layers.push(this.city);
        if (this.city.materials.backdrop) this.env.setBackdropMaterial(this.city.materials.backdrop);
        this.hud.loading = false;
      },
      (err: unknown) => game.notify(`Could not build the 3D city: ${String(err)}`, 'bad'),
    );
    this.raf = requestAnimationFrame(this.frame);
    // Dev builds expose the view for console debugging and automated play-testing.
    if (import.meta.env.DEV) (window as unknown as { __world3d: World3DView }).__world3d = this;
  }

  /** Place the camera directly (debugging and screenshots). */
  setCamera(x: number, y: number, dist: number, yaw = this.rig.yaw): void {
    this.rig.tx = x;
    this.rig.ty = y;
    this.rig.dist = dist;
    this.rig.yaw = yaw;
    this.fly = null;
    ui.set({ follow: false });
  }

  flyTo(x: number, y: number, zoom?: number): void {
    const toD = zoom !== undefined ? clamp(180 * 2 ** (16 - zoom), 25, 6000) : Math.min(this.rig.dist, 260);
    this.fly = { fromX: this.rig.tx, fromY: this.rig.ty, toX: x, toY: y, fromD: this.rig.dist, toD, t: 0 };
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    for (const l of this.layers) l.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as Material | Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------- ViewContext
  vehicleScale(): number {
    return Math.max(1.3, this.rig.dist / 150);
  }

  laneOffset(arc: number): number {
    const e = this.game.world.graph.edges[arc >> 1];
    return e.oneway ? 0 : e.cls <= 3 ? 2.2 : 1.4;
  }

  placeVehicle(obj: Object3D, arc: number, s: number, scale: number, lift = 0): void {
    const p = this.game.world.graph.poseAt(arc, s, this.pose);
    const off = this.laneOffset(arc);
    obj.position.set(p.x - Math.sin(p.heading) * off, lift, -(p.y + Math.cos(p.heading) * off));
    obj.rotation.set(0, p.heading, 0);
    obj.scale.setScalar(scale);
  }

  screenOf(x: number, y: number, h = 0): { x: number; y: number } | null {
    this.v3.set(x, h, -y).project(this.camera);
    if (this.v3.z > 1 || this.v3.z < -1) return null;
    return { x: (this.v3.x * 0.5 + 0.5) * this.width, y: (-this.v3.y * 0.5 + 0.5) * this.height };
  }

  kerbOf(req: RideRequest): { x: number; y: number } {
    const place = this.game.place(req.from);
    const g = this.game.world.graph;
    const nx = g.nodeX[place.node];
    const ny = g.nodeY[place.node];
    const dx = place.x - nx;
    const dy = place.y - ny;
    const d = Math.hypot(dx, dy) || 1;
    const off = Math.min(d, 6);
    return { x: nx + (dx / d) * off, y: ny + (dy / d) * off };
  }

  vehicleMesh(id: number): Mesh | undefined {
    return this.vehicles.meshOf(id);
  }

  // ---------------------------------------------------------------- setup
  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.hud.resize(this.width, this.height, this.dpr);
  }

  // ---------------------------------------------------------------- input
  private groundAt(px: number, py: number): { x: number; y: number } | null {
    const ndc = new Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: hit.x, y: -hit.z };
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      const g = this.groundAt(p.x, p.y);
      this.drag = { button: e.button, x: p.x, y: p.y, moved: false, groundX: g?.x ?? this.rig.tx, groundY: g?.y ?? this.rig.ty };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (!this.drag) {
        this.onHover(p.x, p.y);
        return;
      }
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!this.drag.moved) {
        this.drag.moved = true;
        if (this.drag.button === 0) ui.set({ follow: false });
      }
      if (this.drag.button === 0) {
        // Keep the grabbed ground point under the cursor.
        const g = this.groundAt(p.x, p.y);
        if (g) {
          this.rig.tx += this.drag.groundX - g.x;
          this.rig.ty += this.drag.groundY - g.y;
          this.fly = null;
        }
      } else {
        this.rig.yaw += (e.movementX || 0) * 0.006;
        this.tiltOffset = clamp(this.tiltOffset - (e.movementY || 0) * 0.004, -0.35, 0.5);
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!d || d.moved) return;
      const p = local(e);
      if (d.button === 0) this.onClick(p.x, p.y);
      else if (d.button === 2) {
        const g = this.groundAt(p.x, p.y);
        if (g && this.game.playerDriveTo(g.x, g.y)) this.game.notify('Heading there.', 'info');
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.rig.dist = clamp(this.rig.dist * Math.exp(e.deltaY * 0.0012), 22, 6000);
      this.fly = null;
    };
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    });
  }

  private requestAt(px: number, py: number): RideRequest | null {
    let best: RideRequest | null = null;
    let bestD = HIT_RADIUS;
    const player = this.game.playerVehicle();
    for (const r of this.game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      const k = this.kerbOf(r);
      for (const h of [1, this.hud.badgeHeight()]) {
        const s = this.screenOf(k.x, k.y, h);
        if (!s) continue;
        const d = Math.hypot(s.x - px, s.y - py);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
    }
    return best;
  }

  private vehicleAt(px: number, py: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = HIT_RADIUS + 6;
    for (const v of this.game.state.vehicles) {
      const m = this.vehicleMesh(v.id);
      if (!m) continue;
      const s = this.screenOf(m.position.x, -m.position.z, 1.2);
      if (!s) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private placeAt(px: number, py: number): Place | null {
    let best: Place | null = null;
    let bestD = HIT_RADIUS;
    for (const p of [...this.game.world.landmarks, ...this.game.world.lpgStations]) {
      const s = this.screenOf(p.x, p.y, 12);
      if (!s) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        bestD = d;
        best = p;
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
      const player = this.game.playerVehicle();
      ui.set({ selectedVehicle: v === player ? null : v.id, selectedRequest: null, selectedPlace: null, follow: true });
      return;
    }
    const place = this.rig.dist < 1500 ? this.placeAt(px, py) : null;
    if (place) {
      ui.set({ selectedPlace: place.idx, selectedRequest: null });
      return;
    }
    ui.set({ selectedRequest: null, selectedPlace: null });
  }

  private onHover(px: number, py: number): void {
    const req = this.requestAt(px, py);
    this.hoverRequest = req?.id ?? null;
    this.renderer.domElement.style.cursor = req || this.vehicleAt(px, py) ? 'pointer' : '';
  }

  // ---------------------------------------------------------------- frame
  private frame = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.game.update(dt);
    this.updateCamera(dt);
    const info: FrameInfo = { now, dt, hour: calendar(this.game.state.time).hour, ui: ui.get() };
    for (const l of this.layers) l.update(info);
    this.renderer.render(this.scene, this.camera);
    this.hud.draw(info, this.width, this.height, this.dpr);
    this.raf = requestAnimationFrame(this.frame);
  };

  private followTarget(): Vehicle | undefined {
    const s = ui.get();
    if (s.selectedVehicle !== null) return this.game.vehicle(s.selectedVehicle);
    return this.game.playerVehicle();
  }

  /** Camera elevation: ~40° above the horizon at follow distance, flatter close in, steeper far out. */
  private elevation(): number {
    const d = this.rig.dist;
    const e = 28 + 12 * clamp(d / 160, 0, 1) + 26 * smooth(250, 3500, d);
    return clamp(e * DEG + this.tiltOffset, 10 * DEG, 85 * DEG);
  }

  private updateCamera(dt: number): void {
    const rig = this.rig;
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.7);
      const k = smooth(0, 1, this.fly.t);
      rig.tx = this.fly.fromX + (this.fly.toX - this.fly.fromX) * k;
      rig.ty = this.fly.fromY + (this.fly.toY - this.fly.fromY) * k;
      rig.dist = this.fly.fromD + (this.fly.toD - this.fly.fromD) * k;
      if (this.fly.t >= 1) this.fly = null;
    } else if (ui.get().follow) {
      const v = this.followTarget();
      if (v) {
        const p = this.game.vehiclePose(v, this.pose);
        const ahead = Math.min(0.12 * rig.dist, 25) * clamp(v.speed / 8, 0, 1);
        const gx = p.x + Math.cos(p.heading) * ahead;
        const gy = p.y + Math.sin(p.heading) * ahead;
        const k = 1 - Math.exp(-dt * 5);
        rig.tx += (gx - rig.tx) * k;
        rig.ty += (gy - rig.ty) * k;
      }
    }
    const el = this.elevation();
    const fx = Math.sin(rig.yaw);
    const fz = -Math.cos(rig.yaw);
    const horiz = Math.cos(el) * rig.dist;
    this.camera.position.set(rig.tx - fx * horiz, Math.sin(el) * rig.dist, -rig.ty - fz * horiz);
    this.camera.lookAt(rig.tx, 0, -rig.ty);
    this.camera.near = clamp(rig.dist * 0.02, 0.4, 60);
    this.camera.far = 40_000;
    this.camera.updateProjectionMatrix();
  }
}
