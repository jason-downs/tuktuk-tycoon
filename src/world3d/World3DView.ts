// The 2.5-D world view: a three.js city generated from OpenStreetMap data, a
// tilted camera, and layers for the environment, the static city, vehicles,
// people and markers, with a 2D HUD canvas on top. In Drive mode the camera
// chases the player's tuk-tuk (and drops to the kerb for the haggle); in
// Manage mode it is free to follow, pan (drag or WASD) and zoom.

import {
  MeshLambertMaterial,
  NeutralToneMapping,
  PCFShadowMap,
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
import { kerbPoint, manualControl, setAutodrive, whoDrives, type KerbPoint } from '../sim/manual';
import type { Place, RideRequest, Vehicle } from '../sim/types';
import { ui } from '../ui/store';
import type { GameView } from '../ui/view';
import type { TiledCity } from './build/world';
import { DriveCamera, manageElevation, type CameraMode } from './camera';
import { aimCutaway, applyCutaway, compileCutaway, createCutaway } from './cutaway';
import { DriveHud } from './driveHud';
import { Hud } from './hud';
import { FrameStats } from './stats';
import { edgeLanes } from './kinematics';
import { CityLayer } from './layers/city';
import { CrowdLayer } from './layers/crowds';
import { renderPixelRatio } from './env/quality';
import { Environment } from './layers/environment';
import { MarkerLayer } from './layers/markers';
import { PeopleLayer } from './layers/people';
import { SignalLayer } from './layers/signals';
import type { FrameInfo, ViewContext, WorldLayer } from './layers/types';
import { VehicleLayer } from './layers/vehicles';

export interface World3DOptions {
  base: string;
}

interface BuildResult {
  built: TiledCity;
  play: [number, number, number, number];
  keep: [number, number, number, number];
}

let cityPromise: Promise<BuildResult> | null = null;

/** Build the static city once per page (in a worker); remounts reuse it. */
export function loadCityMeshes(base: string): Promise<BuildResult> {
  if (!cityPromise) {
    cityPromise = new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./build/worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ ok: boolean; built?: TiledCity; play?: BuildResult['play']; keep?: BuildResult['keep']; error?: string }>) => {
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
/** Manage mode: the camera rises to at least this distance (m) when you leave Drive. */
const MANAGE_MIN_DIST = 380;
/** Manage mode keyboard pan, camera distances per real second. */
const PAN_RATE = 1.1;
const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, 1],
  arrowup: [0, 1],
  s: [0, -1],
  arrowdown: [0, -1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

export class World3DView implements GameView, ViewContext {
  readonly kind = '3d' as const;
  readonly game: Game;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 1, 40_000);
  readonly renderer: WebGLRenderer;
  readonly modelMat = new MeshLambertMaterial({ vertexColors: true });
  /** Drive-mode see-through around the player's tuk-tuk. */
  private readonly cutaway = createCutaway();
  /** Camera rig: target (sim metres), distance, compass yaw of the view direction, elevation above the horizon. */
  readonly rig = { tx: 0, ty: 0, dist: 220, yaw: 0, elev: 40 * DEG };
  hoverRequest: number | null = null;

  private readonly container: HTMLElement;
  private readonly env: Environment;
  private readonly vehicles: VehicleLayer;
  private readonly layers: WorldLayer[] = [];
  private readonly hud: Hud;
  private readonly driveHud: DriveHud;
  private readonly driveCam = new DriveCamera();
  /** Manage-mode pan keys held down. */
  private readonly panKeys = new Set<string>();
  /** Rendering runs while the view is shown (the city-map planner hides it). */
  private active = true;
  readonly stats: FrameStats;
  private cityLayer: CityLayer | null = null;
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
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'world-gl';
    container.appendChild(this.renderer.domElement);
    this.hud = new Hud(this, container);
    this.driveHud = new DriveHud(this, container);
    this.stats = new FrameStats(container);

    applyCutaway(this.modelMat, this.cutaway);
    this.env = new Environment(this);
    this.vehicles = new VehicleLayer(this);
    this.layers.push(this.env, this.vehicles, new PeopleLayer(this), new MarkerLayer(this));
    this.layers.push(new CrowdLayer(this));

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
    this.addLayer(new SignalLayer(this));

    loadCityMeshes(opts.base).then(
      (res) => {
        if (this.destroyed) return;
        const city = new CityLayer(this, res.built);
        this.cityLayer = city;
        this.layers.push(city);
        for (const id of ['buildings', 'structures', 'windows', 'glow'] as const) {
          const mat = city.materials[id];
          if (mat) applyCutaway(mat, this.cutaway);
        }
        this.env.setCityMaterials(city.materials);
        this.env.onLight = (light) => city.setNight(1 - light);
        city.setNight(1 - this.env.light);
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

  /** Pause rendering while another view (the city-map planner) is shown, and resume it. */
  setActive(active: boolean): void {
    if (active === this.active || this.destroyed) return;
    this.active = active;
    if (active) {
      this.last = performance.now();
      this.resize();
      this.raf = requestAnimationFrame(this.frame);
    } else {
      cancelAnimationFrame(this.raf);
    }
  }

  /** The ground the camera sees, as four corners in sim metres (clipped to a few camera distances towards the horizon). */
  footprint(): { x: number; y: number }[] {
    const max = this.rig.dist * 4;
    const corners: [number, number][] = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height],
      [0, this.height],
    ];
    return corners.map(([px, py]) => {
      const ndc = new Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = new Vector3();
      const ray = this.raycaster.ray;
      let x: number;
      let y: number;
      if (ray.intersectPlane(this.groundPlane, hit)) {
        x = hit.x;
        y = -hit.z;
      } else {
        x = this.rig.tx + ray.direction.x * max;
        y = this.rig.ty - ray.direction.z * max;
      }
      const dx = x - this.rig.tx;
      const dy = y - this.rig.ty;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        x = this.rig.tx + (dx / d) * max;
        y = this.rig.ty + (dy / d) * max;
      }
      return { x, y };
    });
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
    this.driveHud.dispose();
    this.stats.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------- ViewContext
  vehicleScale(): number {
    return Math.max(1.3, this.rig.dist / 150);
  }

  laneOffset(arc: number): number {
    return edgeLanes(this.game.world.graph).lane[arc >> 1];
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

  /** GameView: screen position of a sim point (the same as screenOf). */
  screenPoint(x: number, y: number, h = 0): { x: number; y: number } | null {
    return this.screenOf(x, y, h);
  }

  kerbOf(req: RideRequest): KerbPoint {
    return kerbPoint(this.game, this.game.place(req.from));
  }

  vehicleMesh(id: number): Object3D | undefined {
    return this.vehicles.meshOf(id);
  }

  city(): TiledCity | null {
    return this.cityLayer?.built ?? null;
  }

  addLayer(layer: WorldLayer): void {
    this.layers.push(layer);
  }

  // ---------------------------------------------------------------- setup
  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(renderPixelRatio());
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
      if (this.driveCam.mode !== 'manage') {
        // Drive mode: any drag looks around the tuk-tuk; the camera swings back behind it later.
        this.drag.moved = true;
        this.driveCam.orbit(e.movementX || 0, e.movementY || 0, performance.now());
        return;
      }
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
        if (g && this.game.playerDriveTo(g.x, g.y)) {
          // In Drive mode the GPS takes the wheel to get there; W takes it back.
          if (ui.get().mode === 'drive') setAutodrive(this.game, true);
          this.game.notify('Heading there.', 'info');
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.driveCam.mode !== 'manage') {
        this.driveCam.wheel(Math.exp(e.deltaY * 0.0012));
        return;
      }
      this.rig.dist = clamp(this.rig.dist * Math.exp(e.deltaY * 0.0012), 22, 6000);
      this.fly = null;
    };
    const onContext = (e: Event) => e.preventDefault();
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === '`') this.stats.toggle();
      const k = e.key.toLowerCase();
      if (PAN_KEYS[k] && !e.metaKey && !e.ctrlKey && !e.altKey && this.canPanWithKeys()) {
        this.panKeys.add(k);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.panKeys.delete(e.key.toLowerCase());
    const onBlur = () => this.panKeys.clear();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanups.push(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
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
    if (this.destroyed || !this.active) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.updateCamera(dt, now);
    const info: FrameInfo = { now, dt, hour: calendar(this.game.state.time).hour, ui: ui.get() };
    for (const l of this.layers) l.update(info);
    this.updateCutaway();
    this.renderer.render(this.scene, this.camera);
    this.hud.draw(info, this.width, this.height, this.dpr);
    this.driveHud.draw(info, this.width, this.height, this.dpr);
    this.stats.record(now, this.renderer);
    this.raf = requestAnimationFrame(this.frame);
  };

  private followTarget(): Vehicle | undefined {
    const s = ui.get();
    if (s.selectedVehicle !== null) return this.game.vehicle(s.selectedVehicle);
    return this.game.playerVehicle();
  }

  /** In Drive mode, cut a line of sight through to the player's tuk-tuk. */
  private updateCutaway(): void {
    compileCutaway(this.cutaway, this.driveCam.mode !== 'manage');
    const player = this.driveCam.mode === 'manage' ? undefined : this.game.playerVehicle();
    const proxy = player ? this.vehicles.meshOf(player.id) : undefined;
    if (!proxy) {
      aimCutaway(this.cutaway, this.camera, null, 0, 1);
      return;
    }
    const scale = proxy.scale.x;
    this.v3.copy(proxy.position).setY(proxy.position.y + 1.2 * scale);
    aimCutaway(this.cutaway, this.camera, this.v3, proxy.position.y, scale);
  }

  /** Which camera the frame uses: the chase or kerbside camera in Drive mode, else the free camera. */
  private cameraMode(): CameraMode {
    const s = ui.get();
    const player = this.game.playerVehicle();
    if (s.mode !== 'drive' || !player) return 'manage';
    return s.haggle && s.haggle.vehicleId === player.id ? 'kerbside' : 'chase';
  }

  /** Manage-mode keyboard panning: not while you steer by hand or haggle. */
  private canPanWithKeys(): boolean {
    const s = ui.get();
    return s.mode === 'manage' && !s.planner && s.haggle === null && !manualControl(this.game).on;
  }

  /** Where the passenger stands during the player's haggle. */
  private haggleKerb(): { x: number; y: number } | null {
    const h = ui.get().haggle;
    const req = h ? this.game.state.requests.find((r) => r.id === h.requestId) : undefined;
    return req ? this.kerbOf(req) : null;
  }

  private updateCamera(dt: number, now: number): void {
    const rig = this.rig;
    const mode = this.cameraMode();
    if (mode !== this.driveCam.mode) {
      if (mode === 'manage') {
        // Leaving Drive: rise to a district view over the same spot.
        this.fly = { fromX: rig.tx, fromY: rig.ty, toX: rig.tx, toY: rig.ty, fromD: rig.dist, toD: Math.max(rig.dist, MANAGE_MIN_DIST), t: 0 };
        this.tiltOffset = 0;
      }
      this.driveCam.setMode(mode, rig, now);
    }
    if (mode !== 'manage') {
      const v = this.game.playerVehicle()!;
      const p = this.game.vehiclePose(v, this.pose);
      const off = this.laneOffset(v.arc);
      this.driveCam.update(
        rig,
        {
          x: p.x - Math.sin(p.heading) * off,
          y: p.y + Math.cos(p.heading) * off,
          heading: p.heading,
          speed: v.speed,
          timeScale: this.game.timeScale,
          autodrive: whoDrives(this.game) !== 'hand',
          kerb: mode === 'kerbside' ? this.haggleKerb() : null,
        },
        dt,
        now,
      );
      this.placeCamera();
      return;
    }
    if (this.panKeys.size && this.canPanWithKeys()) {
      let fx = 0;
      let fy = 0;
      for (const k of this.panKeys) {
        fx += PAN_KEYS[k][0];
        fy += PAN_KEYS[k][1];
      }
      const step = rig.dist * PAN_RATE * dt;
      // Forward is the view direction on the ground; right is 90° clockwise from it.
      rig.tx += (Math.sin(rig.yaw) * fy + Math.cos(rig.yaw) * fx) * step;
      rig.ty += (Math.cos(rig.yaw) * fy - Math.sin(rig.yaw) * fx) * step;
      this.fly = null;
      if (ui.get().follow) ui.set({ follow: false });
    }
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
    rig.elev += (manageElevation(rig.dist, this.tiltOffset) - rig.elev) * (1 - Math.exp(-dt / 0.25));
    this.placeCamera();
  }

  /** Put the three.js camera where the rig says. */
  private placeCamera(): void {
    const rig = this.rig;
    const el = rig.elev;
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
