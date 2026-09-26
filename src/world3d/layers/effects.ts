// Particle-style weather and festival effects, each one draw call and animated
// on the GPU from a handful of uniforms:
// - Rain: streaks in a box that travels with the view but wraps in world
//   space, so drops do not swim when the camera moves; density follows the
//   rain strength and the quality preset.
// - Mist: soft, slowly drifting layers low over the moat and the Ping on
//   cool-season mornings and in fog.
// - Songkran splashes: bursts of thrown water along the moat banks near the
//   view centre.

import {
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { hash01 } from '../build/mesh';
import { pixelAngle } from './glow';

const quadPositions = () => new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3);

// ------------------------------------------------------------------- rain
const rainVertex = /* glsl */ `
attribute vec4 iSeed;
uniform vec3 uCenter;
uniform float uSize;
uniform float uTime;
uniform vec3 uVel;
uniform float uLen;
uniform float uPixelAngle;
varying float vA;
varying float vT;
void main() {
  vec3 halfSize = vec3(uSize * 0.5);
  vec3 base = iSeed.xyz * uSize + uVel * uTime * (0.85 + 0.3 * iSeed.w);
  // Wrap into the box around the view in world space: drops stay put as the box moves.
  vec3 p = mod(base - uCenter + halfSize, uSize) - halfSize + uCenter;
  vec3 dir = normalize(uVel);
  vec3 toCam = cameraPosition - p;
  float depth = length(toCam);
  vec3 side = normalize(cross(dir, toCam / depth));
  // About a pixel wide at any distance; drops right at the lens are shortened and faded out.
  float len = min(uLen, depth * 0.05);
  vec3 wp = p + dir * ((position.y * 0.5 + 0.5) * len) + side * (position.x * depth * uPixelAngle * 0.8);
  vec3 rel = abs(p - uCenter) / halfSize;
  vA = (1.0 - smoothstep(0.55, 1.0, max(rel.x, max(rel.y, rel.z)))) * step(0.0, p.y) * smoothstep(uSize * 0.05, uSize * 0.18, depth);
  vT = position.y * 0.5 + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const rainFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying float vT;
void main() {
  gl_FragColor = vec4(uColor, vA * uOpacity * mix(0.15, 1.0, vT));
}
`;

export class Rain {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly max: number;

  constructor(scene: Scene, max: number) {
    this.max = max;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', quadPositions());
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(max * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = hash01(i, 101);
    g.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    const m = new ShaderMaterial({
      vertexShader: rainVertex,
      fragmentShader: rainFragment,
      uniforms: {
        uCenter: { value: new Vector3() },
        uSize: { value: 100 },
        uTime: { value: 0 },
        uVel: { value: new Vector3(0, -40, 0) },
        uLen: { value: 3 },
        uPixelAngle: { value: 0.001 },
        uColor: { value: new Color() },
        uOpacity: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    scene.add(this.mesh);
  }

  /**
   * @param strength rain 0–1 (storms 1)
   * @param density share of the pool to draw (quality preset / pool size)
   */
  update(
    time: number,
    camera: PerspectiveCamera,
    viewportHeight: number,
    target: Vector3,
    dist: number,
    strength: number,
    density: number,
    color: Color,
    windX: number,
  ): void {
    const n = Math.round(this.max * density * Math.min(1, strength * 1.15));
    this.mesh.visible = n > 20;
    if (!this.mesh.visible) return;
    this.mesh.geometry.instanceCount = n;
    const u = this.mesh.material.uniforms;
    const size = Math.max(40, Math.min(420, dist * 0.9));
    // Box centred between the camera and the view target.
    u.uCenter.value.copy(camera.position).lerp(target, 0.45);
    u.uSize.value = size;
    // Wrapped so the drop positions keep float precision in long sessions.
    u.uTime.value = time % 1000;
    const fall = size * 0.45;
    u.uVel.value.set(windX * fall * 0.18, -fall, windX * fall * 0.06);
    u.uLen.value = size * 0.022;
    u.uPixelAngle.value = pixelAngle(camera, viewportHeight);
    u.uColor.value.copy(color);
    u.uOpacity.value = 0.3 + 0.3 * strength;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ------------------------------------------------------------------- mist
const mistVertex = /* glsl */ `
attribute vec4 iPuff; // world x, world z, radius, height
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 drift = vec2(sin(uTime * 0.05 + iPuff.x * 0.01), cos(uTime * 0.04 + iPuff.y * 0.013)) * iPuff.z * 0.25;
  vec3 p = vec3(iPuff.x + drift.x + position.x * iPuff.z, iPuff.w, iPuff.y + drift.y - position.y * iPuff.z);
  vUv = position.xy;
  vSeed = fract(iPuff.x * 0.137 + iPuff.y * 0.271);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const mistFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float n = vnoise(vUv * 2.3 + vSeed * 17.0 + uTime * 0.03) * 0.6 + vnoise(vUv * 5.1 - uTime * 0.05) * 0.4;
  float a = (1.0 - r2) * (1.0 - r2) * smoothstep(0.25, 0.85, n) * uOpacity;
  gl_FragColor = vec4(uColor, a);
}
`;

export class Mist {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;

  /** @param anchors fx_mist anchors (x, y sim metres, yaw, radius per 4 floats); at most `max` puffs are drawn. */
  constructor(scene: Scene, anchors: Float32Array, max: number) {
    const n = anchors.length / 4;
    const stride = Math.max(1, Math.ceil((n * 2) / Math.max(1, max)));
    const puffs: number[] = [];
    for (let i = 0; i < n; i += stride) {
      const x = anchors[i * 4];
      const y = anchors[i * 4 + 1];
      const r = anchors[i * 4 + 3];
      // Two layers: a dense one on the water and a wider, thinner one above.
      puffs.push(x, -y, r * 1.2, 0.7, x + r * 0.3, -y - r * 0.2, r * 1.6, 2.2);
    }
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', quadPositions());
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iPuff', new InstancedBufferAttribute(new Float32Array(puffs), 4));
    g.instanceCount = puffs.length / 4;
    const m = new ShaderMaterial({
      vertexShader: mistVertex,
      fragmentShader: mistFragment,
      uniforms: { uColor: { value: new Color() }, uOpacity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(time: number, strength: number, color: Color): void {
    const u = this.mesh.material.uniforms;
    u.uOpacity.value = 0.5 * strength;
    u.uTime.value = time;
    u.uColor.value.copy(color);
    this.mesh.visible = strength > 0.01;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --------------------------------------------------------------- splashes
const splashVertex = /* glsl */ `
attribute vec4 iA; // origin xyz, birth time
attribute vec4 iB; // velocity xyz, radius
uniform float uTime;
uniform float uLife;
uniform float uPixelAngle;
uniform float uMinPx;
varying vec2 vUv;
varying float vA;
void main() {
  float t = uTime - iA.w;
  vec3 p = iA.xyz + iB.xyz * t + vec3(0.0, -4.9, 0.0) * t * t;
  float alive = step(0.0, t) * step(t, uLife) * step(-0.2, p.y);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float r = max(iB.w, -mv.z * uPixelAngle * uMinPx) * alive;
  mv.xy += position.xy * r;
  vUv = position.xy;
  vA = alive * (1.0 - smoothstep(uLife * 0.55, uLife, t));
  gl_Position = projectionMatrix * mv;
}
`;

const splashFragment = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vA;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(uColor, vA * (1.0 - r2) * 0.85);
}
`;

const DROPS_PER_BURST = 18;
const SPLASH_LIFE = 1.2;

export class Splashes {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly aAttr: InstancedBufferAttribute;
  private readonly bAttr: InstancedBufferAttribute;
  private readonly next: Float64Array;
  private readonly banks: Float32Array;
  private near: number[] = [];
  private nearAt = { x: Infinity, y: Infinity, r: 0 };
  private rand = 0;
  private running = false;

  /** @param banks fx_moat anchors (x, y, yaw away from the water, scale). */
  constructor(scene: Scene, banks: Float32Array, drops: number) {
    this.banks = banks;
    const bursts = Math.max(1, Math.floor(drops / DROPS_PER_BURST));
    const n = bursts * DROPS_PER_BURST;
    this.a = new Float32Array(n * 4).fill(-1e6);
    this.b = new Float32Array(n * 4);
    this.aAttr = new InstancedBufferAttribute(this.a, 4);
    this.bAttr = new InstancedBufferAttribute(this.b, 4);
    this.next = new Float64Array(bursts);
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', quadPositions());
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iA', this.aAttr);
    g.setAttribute('iB', this.bAttr);
    g.instanceCount = n;
    const m = new ShaderMaterial({
      vertexShader: splashVertex,
      fragmentShader: splashFragment,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: SPLASH_LIFE },
        uPixelAngle: { value: 0.001 },
        uMinPx: { value: 1.2 },
        uColor: { value: new Color('#d8ecff') },
      },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 26;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  private rnd(): number {
    return hash01(this.rand++, 211);
  }

  /** Bank anchors within r of the view centre, refreshed when the view moves. */
  private nearBanks(x: number, y: number, r: number): number[] {
    if (Math.hypot(x - this.nearAt.x, y - this.nearAt.y) > r * 0.25 || Math.abs(r - this.nearAt.r) > r * 0.25) {
      this.near = [];
      for (let i = 0; i < this.banks.length; i += 4) if (Math.hypot(this.banks[i] - x, this.banks[i + 1] - y) < r) this.near.push(i);
      this.nearAt = { x, y, r };
    }
    return this.near;
  }

  /**
   * @param strength 0–1 share of bursts active
   * @param tx, ty view centre (sim metres)
   */
  update(
    time: number,
    camera: PerspectiveCamera,
    viewportHeight: number,
    tx: number,
    ty: number,
    dist: number,
    strength: number,
    light: number,
  ): void {
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) {
      this.running = false;
      return;
    }
    if (!this.running) {
      // Stagger the first bursts so they do not all fire together.
      for (let k = 0; k < this.next.length; k++) this.next[k] = time + this.rnd() * 2.5;
      this.running = true;
    }
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    u.uPixelAngle.value = pixelAngle(camera, viewportHeight);
    u.uColor.value.setRGB(0.75 * light + 0.1, 0.85 * light + 0.1, 0.95 * light + 0.12);
    const near = this.nearBanks(tx, ty, Math.max(120, dist * 1.2));
    const active = Math.round(this.next.length * strength);
    this.aAttr.clearUpdateRanges();
    this.bAttr.clearUpdateRanges();
    let changed = false;
    for (let k = 0; k < active; k++) {
      if (time < this.next[k]) continue;
      this.next[k] = time + SPLASH_LIFE + this.rnd() * 1.8;
      if (!near.length) continue;
      const bi = near[Math.floor(this.rnd() * near.length)];
      const bx = this.banks[bi];
      const by = this.banks[bi + 1];
      const yaw = this.banks[bi + 2];
      // Thrown from the bank towards the road (away from the water), or scooped up out of the moat.
      const dirX = Math.cos(yaw);
      const dirY = Math.sin(yaw);
      const throwOut = this.rnd() < 0.6 ? 1 : -0.6;
      const start = time + this.rnd() * 0.3;
      for (let d = 0; d < DROPS_PER_BURST; d++) {
        const i = (k * DROPS_PER_BURST + d) * 4;
        const speed = 2.5 + this.rnd() * 3;
        const side = (this.rnd() - 0.5) * 2.4;
        this.a[i] = bx + (this.rnd() - 0.5) * 0.6;
        this.a[i + 1] = 1.1 + this.rnd() * 0.4;
        this.a[i + 2] = -(by + (this.rnd() - 0.5) * 0.6);
        this.a[i + 3] = start + this.rnd() * 0.08;
        this.b[i] = dirX * speed * throwOut - dirY * side;
        this.b[i + 1] = 2.5 + this.rnd() * 3.5;
        this.b[i + 2] = -(dirY * speed * throwOut + dirX * side);
        this.b[i + 3] = 0.1 + this.rnd() * 0.12;
      }
      this.aAttr.addUpdateRange(k * DROPS_PER_BURST * 4, DROPS_PER_BURST * 4);
      this.bAttr.addUpdateRange(k * DROPS_PER_BURST * 4, DROPS_PER_BURST * 4);
      changed = true;
    }
    if (changed) {
      this.aAttr.needsUpdate = true;
      this.bAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
