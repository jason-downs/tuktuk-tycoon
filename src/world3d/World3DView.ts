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
import type { World } from '../data/world';
import type { Game } from '../sim/game';
import type { Pose } from '../sim/graph';
import { kerbPoint, manualControl, whoDrives, type KerbPoint } from '../sim/manual';
import type { Place, RideRequest, Vehicle } from '../sim/types';
import { canPanWithKeys, sendPlayerTo } from '../ui/mode';
import { ui } from '../ui/store';
import type { GameView } from '../ui/view';
import { anchorBuffers, KERB_FLOATS, type SimAnchors } from './build/anchors';
import type { TiledCity } from './build/world';
import { bookmarkView } from './bookmarks';
import { DriveCamera, manageElevation, type CameraMode } from './camera';
import { aimCutaway, applyCutaway, compileCutaway, createCutaway } from './cutaway';
import { DriveHud } from './driveHud';
import { Hud, type CityStatus } from './hud';
import { PointerGestures, type PinchStep } from './gestures';
import { FrameStats } from './stats';
import { edgeLanes } from './kinematics';
import { CityLayer } from './layers/city';
import { CrowdLayer } from './layers/crowds';
import { renderPixelRatio } from './env/quality';
import { Environment, type EnvState } from './layers/environment';
import { MarkerLayer } from './layers/markers';
import { PeopleLayer } from './layers/people';
import { SignalLayer } from './layers/signals';
import type { FrameInfo, ViewContext, WorldLayer } from './layers/types';
import { VehicleLayer } from './layers/vehicles';
import { ShaderWarmup } from './shaderWarmup';
import { unpackSpots } from './signalSpots';
import { simAnchors } from './simAnchors';

export interface World3DOptions {
  base: string;
}

interface BuildResult {
  built: TiledCity;
  play: [number, number, number, number];
  keep: [number, number, number, number];
}

let cityPromise: Promise<BuildResult> | null = null;

/**
 * Start building the city while the title screen shows, so a new game opens
 * on a finished city (World3DView picks up the same build). The flat
 * ?view=map page never shows it. A failed build here is retried when the 3D
 * view opens, which reports it.
 */
export function preloadCity(base: string, search: string, world: World): void {
  if (new URLSearchParams(search).get('view') === 'map') return;
  loadCityMeshes(base, () => simAnchors(world)).catch(() => {});
}

/**
 * Add the city once its build arrives, unless the view has gone. If the build
 * fails, or adding it throws, the HUD says so in place of "Building…" and a
 * notice gives the error.
 */
export function trackCityBuild(
  build: Promise<BuildResult>,
  hud: { city: CityStatus },
  game: Pick<Game, 'notify'>,
  alive: () => boolean,
  add: (res: BuildResult) => void,
): Promise<void> {
  return build
    .then((res) => {
      if (!alive()) return;
      add(res);
      hud.city = 'ready';
    })
    .catch((err: unknown) => {
      if (!alive()) return;
      hud.city = 'failed';
      game.notify(`Could not build the 3D city: ${String(err)}`, 'bad');
    });
}

/**
 * Build the static city once per page (in a worker); remounts reuse it.
 * `anchors` gives the simulation's candidate spots for traffic lights and
 * waiting passengers, which the build settles against the city it draws.
 */
export function loadCityMeshes(base: string, anchors?: () => SimAnchors): Promise<BuildResult> {
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
      const a = anchors?.();
      worker.postMessage({ url: new URL('data/city3d.json', base).href, anchors: a }, a ? anchorBuffers(a) : []);
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
/** A pinch pans the Manage camera once its midpoint has moved this far (CSS px); smaller wobble only zooms. */
const PINCH_PAN_PX = 12;
/** Drive mode: how far (m) a look-at without a zoom level stands off. */
const LOOK_DIST = 260;
/** Camera distance (m) for a web-map zoom level (16 ≈ street level). */
const zoomDistance = (zoom: number): number => clamp(180 * 2 ** (16 - zoom), 25, 6000);
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
  /** Compiles the shader variants the view switches between before they are drawn. */
  private readonly shaders: ShaderWarmup;
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
    this.shaders = new ShaderWarmup(this.renderer, this.scene, this.camera, this.env.sun, this.cutaway);
    this.cleanups.push(() => this.shaders.dispose());
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

    void trackCityBuild(loadCityMeshes(opts.base, () => simAnchors(game.world)), this.hud, game, () => !this.destroyed, (res) => {
      const city = new CityLayer(this, res.built);
      this.cityLayer = city;
      this.layers.push(city);
      this.addLayer(new SignalLayer(this, unpackSpots(res.built.signals)));
      for (const id of ['buildings', 'structures', 'windows', 'glow'] as const) {
        const mat = city.materials[id];
        if (mat) applyCutaway(mat, this.cutaway);
      }
      this.env.setCityMaterials(city.materials);
      this.env.onLight = (light) => city.setNight(1 - light);
      city.setNight(1 - this.env.light);
      this.shaders.warmAll();
    });
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

  /** Put the Manage-mode camera on a named view (bookmarks.ts), for screenshot comparison; false for an unknown name. */
  showBookmark(name: string): boolean {
    const v = bookmarkView(this.game.world, name);
    if (!v) return false;
    this.setCamera(v.x, v.y, v.dist, v.yaw);
    return true;
  }

  /** Show a point. In Manage mode the free camera flies there; in Drive mode the chase camera looks there for a while, then swings back. */
  flyTo(x: number, y: number, zoom?: number): void {
    if (this.cameraMode() !== 'manage') {
      this.driveCam.lookAt(x, y, zoom !== undefined ? zoomDistance(zoom) : LOOK_DIST, this.rig, performance.now());
      return;
    }
    const toD = zoom !== undefined ? zoomDistance(zoom) : Math.min(this.rig.dist, 260);
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
    const place = this.game.place(req.from);
    // The stand point the city build settled clear of buildings and street furniture, else the simulation's own.
    const kerbs = this.cityLayer?.built.kerbs;
    const k = place.idx * KERB_FLOATS;
    if (kerbs && k + 2 < kerbs.length && !Number.isNaN(kerbs[k])) return { x: kerbs[k], y: kerbs[k + 1], face: kerbs[k + 2] };
    return kerbPoint(this.game, place);
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

  envState(): Readonly<EnvState> {
    return this.env.state;
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
    const gestures = new PointerGestures();
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      const start = gestures.down(e.pointerId, p.x, p.y);
      el.setPointerCapture(e.pointerId);
      if (start !== 'single') {
        // A second finger turns the drag into a pinch.
        this.drag = null;
        return;
      }
      const g = this.groundAt(p.x, p.y);
      this.drag = { button: e.button, x: p.x, y: p.y, moved: false, groundX: g?.x ?? this.rig.tx, groundY: g?.y ?? this.rig.ty };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const pinch = gestures.move(e.pointerId, p.x, p.y);
      if (gestures.pinching) {
        if (pinch) this.onPinch(pinch);
        return;
      }
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
      if (gestures.up(e.pointerId) || !d || d.moved) return;
      const p = local(e);
      if (d.button === 0) this.onClick(p.x, p.y);
      else if (d.button === 2) {
        const g = this.groundAt(p.x, p.y);
        if (g) sendPlayerTo(this.game, g.x, g.y);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.driveCam.mode !== 'manage') {
        this.driveCam.wheel(Math.exp(e.deltaY * 0.0012), performance.now());
        return;
      }
      this.rig.dist = clamp(this.rig.dist * Math.exp(e.deltaY * 0.0012), 22, 6000);
      this.fly = null;
    };
    const onCancel = (e: PointerEvent) => {
      gestures.up(e.pointerId);
      this.drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
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
      if (PAN_KEYS[k] && !e.metaKey && !e.ctrlKey && !e.altKey && canPanWithKeys(this.game)) {
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
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    });
  }

  /** Two-finger pinch: zoom, and in Manage mode pan with the midpoint once it has clearly moved. */
  private onPinch(p: PinchStep): void {
    if (this.driveCam.mode !== 'manage') {
      this.driveCam.wheel(p.factor, performance.now());
      return;
    }
    this.rig.dist = clamp(this.rig.dist * p.factor, 22, 6000);
    this.fly = null;
    if (p.travel < PINCH_PAN_PX) return;
    const a = this.groundAt(p.prevMid.x, p.prevMid.y);
    const b = this.groundAt(p.mid.x, p.mid.y);
    if (!a || !b) return;
    if (ui.get().follow) ui.set({ follow: false });
    this.rig.tx += a.x - b.x;
    this.rig.ty += a.y - b.y;
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
    // After the layers' update, so what they added this frame is compiled before it is drawn.
    this.shaders.run();
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

  /** In Drive mode, cut a line of sight through to the player's tuk-tuk (not while the camera looks elsewhere). */
  private updateCutaway(): void {
    compileCutaway(this.cutaway, this.driveCam.mode !== 'manage');
    const player = this.driveCam.mode === 'manage' || this.driveCam.looking ? undefined : this.game.playerVehicle();
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
          pedalPresses: manualControl(this.game).presses,
          kerb: mode === 'kerbside' ? this.haggleKerb() : null,
        },
        dt,
        now,
      );
      this.placeCamera();
      return;
    }
    if (this.panKeys.size && canPanWithKeys(this.game)) {
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
