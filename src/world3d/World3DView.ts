// The 2.5-D world view: a three.js city generated from OpenStreetMap data, a
// tilted follow camera, 3D tuk-tuks, traffic and waiting passengers, with a 2D
// HUD canvas on top for badges, pins and the existing overlay painters.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NeutralToneMapping,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { ARCHETYPES } from '../content/archetypes';
import { OVERLAY_PAINTERS, type PaintContext } from '../map/painters';
import { passengerBadge } from '../map/sprites';
import { calendar, daylight } from '../sim/clock';
import type { Game } from '../sim/game';
import type { Pose } from '../sim/graph';
import { RIVAL_KINDS, rivalsOf } from '../sim/rivals';
import type { Place, RideRequest, Vehicle } from '../sim/types';
import { ui } from '../ui/store';
import type { GameView } from '../ui/view';
import type { PackedMesh } from './build/mesh';
import { LAYERS, TREE_KINDS, type BuiltCity, type LayerId } from './build/world';
import { armGeometry, carGeometry, motorbikeGeometry, personGeometry, songthaewGeometry, treeGeometry, tuktukGeometry } from './models';

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
/** Flat-map painters the 3D view replaces with scene objects (rivals) or scene fog (weather tint). */
const SKIP_2D_PAINTERS = new Set(['rivals', 'weather-tint']);
const HIT_RADIUS = 22;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** City vertex colours are sRGB bytes; convert to linear in the shader. */
function cityMaterial(opts: { polygonOffset?: number } = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n\tvColor.rgb = pow(vColor.rgb, vec3(2.2));');
  };
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = opts.polygonOffset;
    m.polygonOffsetUnits = opts.polygonOffset;
  }
  return m;
}

function geometryOf(m: PackedMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('normal', new BufferAttribute(m.normal, 3));
  g.setAttribute('color', new BufferAttribute(m.color, 3, true));
  g.setIndex(new BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Sky colours by daylight (0 night … 1 day) and whether it's golden hour. */
function skyColour(light: number, golden: number, out: Color): Color {
  const night = new Color('#131a33');
  const day = new Color('#a9cbe6');
  const dusk = new Color('#f0b17a');
  out.copy(night).lerp(day, light);
  if (golden > 0) out.lerp(dusk, golden * 0.55);
  return out;
}

export class World3DView implements GameView {
  readonly kind = '3d' as const;
  private readonly game: Game;
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 1, 40_000);
  private readonly hud: HTMLCanvasElement;
  private readonly hudCtx: CanvasRenderingContext2D;
  private readonly hemi = new HemisphereLight('#cfe3f5', '#b89f7a', 1.1);
  private readonly sun = new DirectionalLight('#fff4e0', 2.2);
  private readonly fog = new Fog('#a9cbe6', 400, 3000);
  private readonly sky = new Color('#a9cbe6');
  private readonly modelMat = new MeshLambertMaterial({ vertexColors: true });
  private readonly layerMats: Partial<Record<LayerId, MeshLambertMaterial>> = {};
  private staticReady = false;
  private raf = 0;
  private last = performance.now();
  private destroyed = false;
  private dpr = 1;
  private width = 1;
  private height = 1;

  // Camera rig (sim coordinates for the target).
  private tx = 0;
  private ty = 0;
  private dist = 220;
  private yaw = 0;
  private tiltOffset = 0;
  private fly: { fromX: number; fromY: number; toX: number; toY: number; fromD: number; toD: number; t: number } | null = null;

  // Entities.
  private readonly fleet = new Map<number, Mesh>();
  private readonly fleetPaint = new Map<number, string>();
  private readonly rivals: Mesh[] = [];
  private readonly people = new Map<number, { group: Group; arms: Object3D[]; party: number }>();
  private readonly playerRing: Mesh;
  private readonly selectRing: Mesh;
  private readonly beacon: Mesh;
  private readonly pickupBeacon: Mesh;
  private routeMesh: Mesh | null = null;
  private routeKey = '';
  private routeBuiltAt = 0;
  private readonly pose: Pose = { x: 0, y: 0, heading: 0 };
  private readonly v3 = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);

  // Input.
  private drag: { button: number; x: number; y: number; moved: boolean; groundX: number; groundY: number } | null = null;
  private hoverRequest: number | null = null;
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
    this.hud = document.createElement('canvas');
    this.hud.className = 'map-overlay';
    container.appendChild(this.hud);
    this.hudCtx = this.hud.getContext('2d')!;

    this.scene.background = this.sky;
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const ringGeo = new RingGeometry(2.4, 3.1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.playerRing = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#e0457b', transparent: true, opacity: 0.85, depthWrite: false }));
    this.playerRing.renderOrder = 5;
    this.scene.add(this.playerRing);
    this.selectRing = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#3d6fb6', transparent: true, opacity: 0.85, depthWrite: false }));
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);
    const beaconGeo = new CylinderGeometry(2.2, 2.2, 70, 16, 1, true);
    beaconGeo.translate(0, 35, 0);
    this.beacon = new Mesh(beaconGeo, new MeshBasicMaterial({ color: '#e0457b', transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    this.beacon.visible = false;
    this.scene.add(this.beacon);
    this.pickupBeacon = new Mesh(beaconGeo, new MeshBasicMaterial({ color: '#3aa35b', transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    this.pickupBeacon.visible = false;
    this.scene.add(this.pickupBeacon);

    const start = game.playerVehicle();
    if (start) {
      const p = game.vehiclePose(start);
      this.tx = p.x;
      this.ty = p.y;
    }

    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.cleanups.push(() => ro.disconnect());
    this.bindInput();

    loadCityMeshes(opts.base).then(
      (res) => !this.destroyed && this.addStatic(res),
      (err: unknown) => game.notify(`Could not build the 3D city: ${String(err)}`, 'bad'),
    );
    this.raf = requestAnimationFrame(this.frame);
    // Dev builds expose the view for console debugging and automated play-testing.
    if (import.meta.env.DEV) (window as unknown as { __world3d: World3DView }).__world3d = this;
  }

  /** Camera state, for debugging and tests. */
  get cameraState(): { x: number; y: number; dist: number; yaw: number } {
    return { x: this.tx, y: this.ty, dist: this.dist, yaw: this.yaw };
  }

  /** Place the camera directly (debugging and screenshots). */
  setCamera(x: number, y: number, dist: number, yaw = this.yaw): void {
    this.tx = x;
    this.ty = y;
    this.dist = dist;
    this.yaw = yaw;
    this.fly = null;
    ui.set({ follow: false });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as Material | Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.hud.remove();
  }

  flyTo(x: number, y: number, zoom?: number): void {
    const toD = zoom !== undefined ? clamp(180 * 2 ** (16 - zoom), 25, 6000) : Math.min(this.dist, 260);
    this.fly = { fromX: this.tx, fromY: this.ty, toX: x, toY: y, fromD: this.dist, toD, t: 0 };
  }

  // ------------------------------------------------------------------ setup
  private addStatic(res: BuildResult): void {
    const { built } = res;
    for (const id of LAYERS) {
      const mesh = built.layers[id];
      if (!mesh.index.length) continue;
      const mat = cityMaterial({ polygonOffset: id === 'roads' ? -2 : id === 'water' ? -1 : 0 });
      if (id === 'backdrop') {
        mat.fog = false;
      }
      this.layerMats[id] = mat;
      const m = new Mesh(geometryOf(mesh), mat);
      m.frustumCulled = id !== 'ground';
      m.receiveShadow = id !== 'backdrop';
      m.castShadow = id === 'buildings' || id === 'structures';
      m.renderOrder = id === 'ground' ? -3 : id === 'water' ? -2 : id === 'roads' ? -1 : 0;
      this.scene.add(m);
    }
    // Trees: one instanced mesh per kind.
    const t = built.trees;
    const counts = new Map<number, number>();
    for (let i = 0; i < t.length; i += 4) counts.set(t[i + 3], (counts.get(t[i + 3]) ?? 0) + 1);
    const inst = new Map<number, InstancedMesh>();
    for (const [k, n] of counts) {
      const im = new InstancedMesh(treeGeometry(TREE_KINDS[k]), this.modelMat, n);
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = true;
      inst.set(k, im);
      this.scene.add(im);
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const scl = new Vector3();
    const tint = new Color();
    for (let i = 0; i < t.length; i += 4) {
      const im = inst.get(t[i + 3])!;
      const s = t[i + 2];
      q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2));
      pos.set(t[i], 0, -t[i + 1]);
      scl.set(s, s * (0.9 + ((i * 7) % 5) * 0.05), s);
      m.compose(pos, q, scl);
      im.setMatrixAt(im.count, m);
      tint.setRGB(0.85 + ((i * 13) % 7) * 0.03, 0.9 + ((i * 17) % 5) * 0.03, 0.85 + ((i * 11) % 6) * 0.025);
      im.setColorAt(im.count, tint);
      im.count++;
    }
    for (const im of inst.values()) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
    this.staticReady = true;
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.hud.width = Math.round(this.width * this.dpr);
    this.hud.height = Math.round(this.height * this.dpr);
    this.hud.style.width = `${this.width}px`;
    this.hud.style.height = `${this.height}px`;
  }

  // ------------------------------------------------------------------ input
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
      this.drag = { button: e.button, x: p.x, y: p.y, moved: false, groundX: g?.x ?? this.tx, groundY: g?.y ?? this.ty };
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
          this.tx += this.drag.groundX - g.x;
          this.ty += this.drag.groundY - g.y;
          this.fly = null;
        }
      } else {
        this.yaw += (e.movementX || 0) * 0.006;
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
      this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0012), 22, 6000);
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

  /** Screen position of a sim point at height h, or null when behind the camera. */
  private screenOf(x: number, y: number, h = 0): { x: number; y: number } | null {
    this.v3.set(x, h, -y).project(this.camera);
    if (this.v3.z > 1 || this.v3.z < -1) return null;
    return { x: (this.v3.x * 0.5 + 0.5) * this.width, y: (-this.v3.y * 0.5 + 0.5) * this.height };
  }

  private kerbOf(req: RideRequest): { x: number; y: number } {
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

  private requestAt(px: number, py: number): RideRequest | null {
    let best: RideRequest | null = null;
    let bestD = HIT_RADIUS;
    const player = this.game.playerVehicle();
    for (const r of this.game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      const k = this.kerbOf(r);
      for (const h of [1, this.badgeHeight()]) {
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
      const p = this.game.vehiclePose(v, this.pose);
      const s = this.screenOf(p.x, p.y, 1.2);
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
      const s = this.screenOf(p.x, p.y, 4);
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
    const place = this.dist < 1500 ? this.placeAt(px, py) : null;
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

  // ------------------------------------------------------------------ frame
  private frame = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.game.update(dt);
    this.updateCamera(dt);
    this.updateLighting();
    this.syncVehicles();
    this.syncRivals();
    this.syncPeople(now);
    this.syncMarkers(now);
    this.renderer.render(this.scene, this.camera);
    this.drawHud(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private followTarget(): Vehicle | undefined {
    const s = ui.get();
    if (s.selectedVehicle !== null) return this.game.vehicle(s.selectedVehicle);
    return this.game.playerVehicle();
  }

  private elevation(): number {
    // ~40° above the horizon at follow distance (a "50° pitch"), flatter close in, steeper far out.
    const d = this.dist;
    const e = 28 + 12 * clamp(d / 160, 0, 1) + 26 * smooth(250, 3500, d);
    return clamp(e * DEG + this.tiltOffset, 10 * DEG, 85 * DEG);
  }

  private updateCamera(dt: number): void {
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.7);
      const k = smooth(0, 1, this.fly.t);
      this.tx = this.fly.fromX + (this.fly.toX - this.fly.fromX) * k;
      this.ty = this.fly.fromY + (this.fly.toY - this.fly.fromY) * k;
      this.dist = this.fly.fromD + (this.fly.toD - this.fly.fromD) * k;
      if (this.fly.t >= 1) this.fly = null;
    } else if (ui.get().follow) {
      const v = this.followTarget();
      if (v) {
        const p = this.game.vehiclePose(v, this.pose);
        const ahead = Math.min(0.12 * this.dist, 25) * clamp(v.speed / 8, 0, 1);
        const gx = p.x + Math.cos(p.heading) * ahead;
        const gy = p.y + Math.sin(p.heading) * ahead;
        const k = 1 - Math.exp(-dt * 5);
        this.tx += (gx - this.tx) * k;
        this.ty += (gy - this.ty) * k;
      }
    }
    const el = this.elevation();
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const horiz = Math.cos(el) * this.dist;
    this.camera.position.set(this.tx - fx * horiz, Math.sin(el) * this.dist, -this.ty - fz * horiz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.tx, 0, -this.ty);
    this.camera.near = clamp(this.dist * 0.02, 0.4, 60);
    this.camera.far = 40_000;
    this.camera.updateProjectionMatrix();
    this.fog.near = this.dist * 1.4 + 250;
    this.fog.far = this.dist * 4.5 + 1600;
  }

  private lastHour = -1;

  private updateLighting(): void {
    const cal = calendar(this.game.state.time);
    const hour = cal.hour;
    if (Math.abs(hour - this.lastHour) > 0.02) {
      this.lastHour = hour;
      const light = daylight(hour);
      const rise = 6.4;
      const set = 17.85;
      const t = clamp((hour - rise) / (set - rise), 0, 1);
      const elev = Math.sin(Math.PI * t) * 55 * DEG;
      const golden = light > 0 ? clamp(1 - elev / (14 * DEG), 0, 1) : 0;
      skyColour(light, golden, this.sky);
      this.fog.color.copy(this.sky);
      this.hemi.color.set(light > 0.3 ? '#cfe3f5' : '#6d7fb0');
      this.hemi.groundColor.set(light > 0.3 ? '#b89f7a' : '#2a2018');
      this.hemi.intensity = 0.35 + 0.85 * light;
      this.sun.intensity = 2.4 * light * (0.55 + 0.45 * clamp(elev / (25 * DEG), 0, 1));
      this.sun.color.set(golden > 0.2 ? '#ffc07a' : '#fff4e0');
      // East in the morning, south at noon (November), west in the evening.
      const az = Math.PI * t;
      this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.max(0.15, Math.sin(elev)), 0.55 * Math.sin(az) * Math.cos(elev)).normalize();
      this.renderer.toneMappingExposure = 1.05 + (1 - light) * 0.25;
      const back = this.layerMats.backdrop;
      if (back) back.color.set('#ffffff').lerp(this.sky, 0.5);
    }
    // Shadow box follows the camera target, snapped to shadow texels.
    const extent = clamp(this.dist * 1.3, 80, 700);
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 3000;
    cam.updateProjectionMatrix();
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    const cx = Math.round(this.tx / texel) * texel;
    const cy = Math.round(this.ty / texel) * texel;
    this.sun.target.position.set(cx, 0, -cy);
    this.sun.position.set(cx + this.sunDir.x * 1200, this.sunDir.y * 1200, -cy + this.sunDir.z * 1200);
    this.sun.castShadow = this.sun.intensity > 0.2 && this.dist < 2500;
  }

  private readonly sunDir = new Vector3(0.5, 0.8, 0.3);

  /** Left-hand traffic: shift a vehicle to the left of its direction on two-way roads. */
  private laneOffset(arc: number): number {
    const e = this.game.world.graph.edges[arc >> 1];
    return e.oneway ? 0 : e.cls <= 3 ? 2.2 : 1.4;
  }

  private placeVehicle(obj: Object3D, arc: number, s: number, scale: number, lift = 0): void {
    const p = this.game.world.graph.poseAt(arc, s, this.pose);
    const off = this.laneOffset(arc);
    const lx = -Math.sin(p.heading) * off;
    const ly = Math.cos(p.heading) * off;
    obj.position.set(p.x + lx, lift, -(p.y + ly));
    obj.rotation.set(0, p.heading, 0);
    obj.scale.setScalar(scale);
  }

  /** Vehicles and people are drawn larger than life when zoomed out so they stay readable. */
  private vehicleScale(): number {
    return Math.max(1.3, this.dist / 150);
  }

  private syncVehicles(): void {
    const seen = new Set<number>();
    const scale = this.vehicleScale();
    for (const v of this.game.state.vehicles) {
      seen.add(v.id);
      let mesh = this.fleet.get(v.id);
      if (!mesh || this.fleetPaint.get(v.id) !== v.paint) {
        if (mesh) this.scene.remove(mesh);
        mesh = new Mesh(tuktukGeometry(v.paint), this.modelMat);
        mesh.castShadow = true;
        this.fleet.set(v.id, mesh);
        this.fleetPaint.set(v.id, v.paint);
        this.scene.add(mesh);
      }
      const parked = v.route === null && v.speed < 0.1;
      this.placeVehicle(mesh, v.arc, v.s, scale);
      if (parked) {
        // Pull in to the kerb.
        const p = this.game.world.graph.poseAt(v.arc, v.s, this.pose);
        const off = this.laneOffset(v.arc) + 1.6;
        mesh.position.set(p.x - Math.sin(p.heading) * off, 0, -(p.y + Math.cos(p.heading) * off));
      }
    }
    for (const [id, mesh] of this.fleet) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.fleet.delete(id);
        this.fleetPaint.delete(id);
      }
    }
  }

  private syncRivals(): void {
    const sys = rivalsOf(this.game);
    const n = sys?.count ?? 0;
    const scale = this.vehicleScale();
    for (let i = 0; i < Math.max(n, this.rivals.length); i++) {
      if (i >= n) {
        if (this.rivals[i]) this.rivals[i].visible = false;
        continue;
      }
      const kind = RIVAL_KINDS[sys!.kind[i]];
      let mesh = this.rivals[i];
      const want = kind === 'songthaew' ? songthaewGeometry() : kind === 'car' ? carGeometry(i) : kind === 'motorbike' ? motorbikeGeometry(i) : tuktukGeometry(i % 3 === 0 ? 'coop_taxi' : 'nakhon_blue');
      if (!mesh) {
        mesh = new Mesh(want, this.modelMat);
        mesh.castShadow = true;
        this.rivals[i] = mesh;
        this.scene.add(mesh);
      } else if (mesh.geometry !== want) mesh.geometry = want;
      const route = sys!.routes[i];
      if (route) {
        mesh.visible = true;
        this.placeVehicle(mesh, route.arcs[sys!.idx[i]], sys!.s[i], scale);
      } else {
        const pose = sys!.poseOf(this.game, i, this.pose);
        mesh.visible = !!pose;
        if (pose) {
          mesh.position.set(pose.x, 0, -pose.y);
          mesh.rotation.set(0, pose.heading, 0);
          mesh.scale.setScalar(scale);
        }
      }
    }
  }

  private syncPeople(now: number): void {
    const game = this.game;
    const player = game.playerVehicle();
    const pp = player ? game.vehiclePose(player) : null;
    const seen = new Set<number>();
    const scale = Math.max(1.3, this.dist / 150);
    for (const r of game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      seen.add(r.id);
      let entry = this.people.get(r.id);
      if (!entry) {
        const group = new Group();
        const arms: Object3D[] = [];
        for (let k = 0; k < r.party; k++) {
          const body = new Mesh(personGeometry(r.archetype, r.id + k), this.modelMat);
          body.castShadow = true;
          body.position.set(0, 0, (k - (r.party - 1) / 2) * 0.7);
          const arm = new Mesh(armGeometry(), new MeshLambertMaterial({ color: r.archetype === 'monk' ? '#e8871e' : ARCHETYPES[r.archetype].color }));
          arm.position.set(0, 1.38, 0.27);
          body.add(arm);
          arms.push(arm);
          group.add(body);
        }
        this.scene.add(group);
        entry = { group, arms, party: r.party };
        this.people.set(r.id, entry);
      }
      const k = this.kerbOf(r);
      entry.group.position.set(k.x, 0, -k.y);
      // Face the road node.
      const place = game.place(r.from);
      const g = game.world.graph;
      entry.group.rotation.y = Math.atan2(g.nodeY[place.node] - k.y, g.nodeX[place.node] - k.x) || 0;
      entry.group.scale.setScalar(scale);
      // Wave when your tuk-tuk is near or the passenger is selected.
      const near = pp ? Math.hypot(pp.x - k.x, pp.y - k.y) < 90 : false;
      const waving = near || ui.get().selectedRequest === r.id || this.hoverRequest === r.id;
      entry.arms.forEach((arm, i) => {
        arm.rotation.x = waving ? Math.PI * 0.85 + Math.sin(now / 140 + i) * 0.35 : 0.1;
      });
    }
    for (const [id, entry] of this.people) {
      if (!seen.has(id)) {
        this.scene.remove(entry.group);
        entry.group.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh && m.material !== this.modelMat) (m.material as Material).dispose();
        });
        this.people.delete(id);
      }
    }
  }

  private syncMarkers(now: number): void {
    const game = this.game;
    const s = ui.get();
    const player = game.playerVehicle();
    const scale = this.vehicleScale();
    if (player) {
      const p = game.vehiclePose(player, this.pose);
      this.playerRing.position.set(p.x - Math.sin(p.heading) * (player.route ? this.laneOffset(player.arc) : this.laneOffset(player.arc) + 1.6), 0.2, -(p.y + Math.cos(p.heading) * (player.route ? this.laneOffset(player.arc) : this.laneOffset(player.arc) + 1.6)));
      this.playerRing.scale.setScalar(scale * (1 + Math.sin(now / 300) * 0.06));
    }
    const sel = s.selectedVehicle !== null ? game.vehicle(s.selectedVehicle) : undefined;
    this.selectRing.visible = !!sel;
    if (sel) {
      const m = this.fleet.get(sel.id);
      if (m) this.selectRing.position.set(m.position.x, 0.2, m.position.z);
      this.selectRing.scale.setScalar(scale);
    }
    // Destination beacon for the player's current trip; pickup beacon for a claimed passenger.
    const dest = player?.task.kind === 'trip' ? game.place(player.task.trip.request.to) : null;
    this.beacon.visible = !!dest;
    if (dest) {
      const g = game.world.graph;
      this.beacon.position.set(g.nodeX[dest.node], 0, -g.nodeY[dest.node]);
      this.beacon.scale.set(scale, Math.max(1, this.dist / 300), scale);
    }
    const selReq = s.selectedRequest !== null ? game.state.requests.find((r) => r.id === s.selectedRequest) : undefined;
    this.pickupBeacon.visible = !!selReq;
    if (selReq) {
      const to = game.place(selReq.to);
      const g = game.world.graph;
      this.pickupBeacon.position.set(g.nodeX[to.node], 0, -g.nodeY[to.node]);
      (this.pickupBeacon.material as MeshBasicMaterial).color.set(ARCHETYPES[selReq.archetype].color);
      this.pickupBeacon.scale.set(scale, Math.max(1, this.dist / 300), scale);
    }
    this.syncRoute(now, sel ?? player);
  }

  /** Ribbon along the remaining route of the player's (or selected) tuk-tuk. */
  private syncRoute(now: number, v: Vehicle | undefined): void {
    const route = v?.route;
    const key = route && v ? `${v.id}:${route.target}:${route.arcs.length}:${v.routeIdx}` : '';
    if (key === this.routeKey && now - this.routeBuiltAt < 300) return;
    this.routeKey = key;
    this.routeBuiltAt = now;
    if (this.routeMesh) {
      this.scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      this.routeMesh = null;
    }
    if (!route || !v) return;
    const g = this.game.world.graph;
    const pts: [number, number][] = [];
    const here = g.poseAt(v.arc, v.s);
    pts.push([here.x, here.y]);
    for (let i = v.routeIdx; i < route.arcs.length; i++) {
      const arc = route.arcs[i];
      const e = g.edges[arc >> 1];
      const rev = (arc & 1) === 1;
      const n = e.pts.length / 2;
      for (let k = 0; k < n; k++) {
        const idx = rev ? n - 1 - k : k;
        const along = rev ? e.len - e.cum[idx] : e.cum[idx];
        if (i === v.routeIdx && along <= v.s) continue;
        const last = pts[pts.length - 1];
        const x = e.pts[2 * idx];
        const y = e.pts[2 * idx + 1];
        if (Math.hypot(x - last[0], y - last[1]) > 0.5) pts.push([x, y]);
      }
    }
    if (pts.length < 2) return;
    const half = Math.max(1.1, this.dist * 0.004);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      pos.push(pts[i][0] + nx * half, 0.25, -(pts[i][1] + ny * half), pts[i][0] - nx * half, 0.25, -(pts[i][1] - ny * half));
      if (i > 0) {
        const o = (i - 1) * 2;
        idx.push(o + 1, o + 3, o + 2, o + 1, o + 2, o);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    const player = this.game.playerVehicle();
    const mat = new MeshBasicMaterial({ color: v === player ? '#e0457b' : '#3d6fb6', transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4;
    mat.polygonOffsetUnits = -4;
    this.routeMesh = new Mesh(geo, mat);
    this.routeMesh.renderOrder = 4;
    this.scene.add(this.routeMesh);
  }

  // ------------------------------------------------------------------ HUD
  private badgeHeight(): number {
    return 2.6 * Math.max(1.3, this.dist / 150);
  }

  private drawHud(now: number): void {
    const ctx = this.hudCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.hud.width, this.hud.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const game = this.game;
    const s = ui.get();
    const player = game.playerVehicle();
    const zoom = 16 - Math.log2(this.dist / 180);
    const pc: PaintContext = {
      ctx,
      game,
      width: this.width,
      height: this.height,
      zoom,
      now,
      toScreen: (x, y) => this.screenOf(x, y, 0) ?? { x: -9999, y: -9999 },
    };
    for (const p of OVERLAY_PAINTERS) if (p.layer === 'under' && !SKIP_2D_PAINTERS.has(p.id)) p.paint(pc);

    if (!this.staticReady) {
      ctx.fillStyle = 'rgba(43,29,18,0.85)';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Building Chiang Mai…', this.width / 2, this.height / 2);
    }

    // Landmark names when close enough.
    if (this.dist < 900) {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const l of game.world.landmarks) {
        const p = this.screenOf(l.x, l.y, 12);
        if (!p || p.x < 0 || p.y < 0 || p.x > this.width || p.y > this.height) continue;
        const d = Math.hypot(l.x - this.tx, l.y - this.ty);
        if (d > this.dist * 3) continue;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255,248,232,0.9)';
        ctx.strokeText(l.name, p.x, p.y);
        ctx.fillStyle = '#3b2a18';
        ctx.fillText(l.name, p.x, p.y);
      }
    }

    // Passenger badges above heads.
    const badge = clamp(38 - this.dist / 120, 22, 36);
    const h = this.badgeHeight();
    for (const r of game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      const k = this.kerbOf(r);
      const p = this.screenOf(k.x, k.y, h);
      if (!p || p.x < -40 || p.y < -40 || p.x > this.width + 40 || p.y > this.height + 40) continue;
      this.drawBadge(r, p.x, p.y - badge * 0.3, badge, now, r.id === s.selectedRequest || r.id === this.hoverRequest);
    }

    // Status icons above fleet tuk-tuks.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const v of game.state.vehicles) {
      const icon = this.statusIcon(v);
      if (!icon) continue;
      const m = this.fleet.get(v.id);
      if (!m) continue;
      const p = this.screenOf(m.position.x, -m.position.z, 2.6 * this.vehicleScale());
      if (!p) continue;
      ctx.font = `${Math.round(clamp(26 - this.dist / 150, 14, 24))}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
      ctx.fillText(icon, p.x, p.y);
    }
    ctx.textBaseline = 'alphabetic';
    for (const p of OVERLAY_PAINTERS) if (p.layer === 'over') p.paint(pc);
  }

  private drawBadge(r: RideRequest, x: number, y: number, size: number, now: number, highlight: boolean): void {
    const ctx = this.hudCtx;
    const info = ARCHETYPES[r.archetype];
    const left = Math.max(0, (r.expiresAt - this.game.state.time) / (r.expiresAt - r.spawnedAt));
    const sz = size * (highlight ? 1.2 : 1) * (1 + Math.sin(now / 260 + r.id) * 0.05);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
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
    if (this.dist < 700 || highlight) {
      const label = r.fixedFare !== null ? `📱฿${r.fixedFare}` : `~฿${r.fairFare}`;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(59, 42, 24, 0.88)';
      const by = -sz / 2 - 22;
      ctx.beginPath();
      ctx.roundRect(-tw / 2, by, tw, 17, 8);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(label, 0, by + 13);
    }
    ctx.restore();
  }

  private statusIcon(v: Vehicle): string {
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
}
