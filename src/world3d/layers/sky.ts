// The sky around the camera: a gradient dome (zenith → horizon, with the
// twilight glow on the sun's side), the sun disc and its glow, the moon with
// its phase, procedural drifting clouds, stars at night, and lightning bolts in
// storms. The dome's horizon matches the scene fog colour, and it is drawn
// without tone mapping exactly like three.js fog, so the far city and the Doi
// Suthep backdrop dissolve into the sky without a seam.

import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { hash01 } from '../build/mesh';
import { FLASH_SLOT } from '../env/atmosphere';

/** Dome radius: inside the camera's far plane (40 km), outside the ground (≈ 20 km). */
const DOME_RADIUS = 25_000;
const STAR_RADIUS = 24_000;
const STAR_COUNT = 1600;

export interface SkyInput {
  time: number;
  zenith: Color;
  horizon: Color;
  fog: Color;
  sunDir: Vector3;
  sunColor: Color;
  /** Sun disc and glow strength 0–1. */
  sunGlow: number;
  moonDir: Vector3;
  /** Moon visibility 0–1 (night, above the horizon). */
  moonGlow: number;
  cloud: number;
  cloudLit: Color;
  cloudShade: Color;
  stars: number;
  /** Lightning flash 0–1. */
  flash: number;
  /** Smoke haze 0–1: blurs the sun into a red disc. */
  haze: number;
  /** 0–1: how far up the horizon colour reaches (haze, fog and storms flatten the sky into the murk). */
  lift: number;
  pixelRatio: number;
}

const domeVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * ${DOME_RADIUS.toFixed(1)}, 1.0);
}
`;

const domeFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform vec3 uMoonDir;
uniform float uMoonGlow;
uniform float uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uFlash;
uniform float uHaze;
uniform float uLift;
uniform float uStars;
uniform float uTime;
varying vec3 vDir;

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
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec2 dxz = normalize(d.xz + vec2(1e-5, 0.0));
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float sunward = pow(0.5 + 0.5 * dot(dxz, sxz), 3.0);
  // Twilight colour on the sun's side of the horizon, the haze colour opposite.
  vec3 horizon = mix(uFog, uHorizon, 0.3 + 0.7 * sunward);
  vec3 col = mix(horizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5 + 1.5 * uLift));

  // Sun: disc plus a wide and a tight glow; smoke flattens it into a dim red ball.
  float cs = dot(d, uSunDir);
  float disc = smoothstep(0.99985 - uHaze * 0.0001, 0.99992, cs);
  float glow = pow(max(cs, 0.0), 10.0) * 0.22 + pow(max(cs, 0.0), 160.0) * 0.55;
  float sunVis = uSunGlow * (1.0 - 0.85 * uCloud) * smoothstep(-0.02, 0.01, uSunDir.y + 0.01);
  // Murk scatters the glow evenly into the fog colour; the disc still shows through, dim and red in smoke.
  col += uSunColor * (disc * (5.0 - 3.5 * uHaze) + glow * (1.0 - 0.9 * uLift)) * sunVis;

  // Moon: the hemisphere facing the sun; the rest shows faint earthshine at night and sky by day.
  float cm = dot(d, uMoonDir);
  float moonR = 0.0245;
  if (cm > 0.999 && uMoonGlow > 0.001) {
    vec3 e1 = uSunDir - uMoonDir * dot(uSunDir, uMoonDir);
    float l1 = length(e1);
    e1 = l1 > 1e-4 ? e1 / l1 : normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 e2 = cross(uMoonDir, e1);
    vec3 off = d - uMoonDir * cm;
    float u = dot(off, e1) / moonR;
    float v = dot(off, e2) / moonR;
    float rr = u * u + v * v;
    if (rr < 1.0) {
      vec3 n = u * e1 + v * e2 - sqrt(1.0 - rr) * uMoonDir;
      float lit = smoothstep(-0.05, 0.08, dot(n, uSunDir));
      float edge = smoothstep(1.0, 0.9, rr);
      col = mix(col, vec3(0.93, 0.92, 0.86), edge * uMoonGlow * (1.0 - 0.8 * uCloud) * max(lit, 0.08 * uStars));
    }
  }
  col += vec3(0.55, 0.6, 0.75) * pow(max(cm, 0.0), 900.0) * 0.12 * uMoonGlow;

  // Clouds on a virtual layer overhead, fading into the haze towards the horizon.
  if (h > 0.0 && uCloud > 0.01) {
    vec2 uv = d.xz / (h + 0.08) * 0.55 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv);
    // Smoke hides the clouds; murk takes the sunlit edge off them.
    float cover = smoothstep(0.64 - 0.5 * uCloud, 0.86 - 0.38 * uCloud, n) * smoothstep(0.015, 0.2, h) * (1.0 - 0.85 * uHaze);
    vec3 cc = mix(uCloudLit, uCloudShade, smoothstep(0.45, 0.95, n));
    cc += uSunColor * 0.25 * pow(max(cs, 0.0), 6.0) * uSunGlow * (1.0 - uLift);
    col = mix(col, cc, cover * 0.92);
    col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.75 * cover);
  } else {
    col += vec3(0.75, 0.8, 1.0) * uFlash * 0.2;
  }

  // Below the horizon line the dome is pure fog colour, like the fogged ground in front of it.
  col = mix(uFog, col, smoothstep(-0.02, 0.05, h));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const starVertex = /* glsl */ `
attribute float aSize;
attribute float aBright;
uniform float uPixelRatio;
uniform float uTime;
varying float vB;
void main() {
  vec3 d = normalize(position);
  float tw = 0.75 + 0.25 * sin(uTime * (1.3 + aBright * 2.0) + aBright * 91.0);
  vB = aBright * tw * smoothstep(0.02, 0.2, d.y);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const starFragment = /* glsl */ `
uniform float uStars;
varying float vB;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.0, dot(c, c));
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vB * a * uStars, 1.0);
}
`;

export class Sky {
  private readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly stars: Points<BufferGeometry, ShaderMaterial>;
  private readonly boltMat = new LineBasicMaterial({ color: '#eef2ff', transparent: true, fog: false, depthWrite: false });
  private bolt: LineSegments | null = null;
  private boltKey = -1;
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    const geo = new SphereGeometry(1, 48, 24);
    const mat = new ShaderMaterial({
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uFog: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uSunGlow: { value: 1 },
        uMoonDir: { value: new Vector3(0, -1, 0) },
        uMoonGlow: { value: 0 },
        uCloud: { value: 0 },
        uCloudLit: { value: new Color() },
        uCloudShade: { value: new Color() },
        uFlash: { value: 0 },
        uHaze: { value: 0 },
        uLift: { value: 0 },
        uStars: { value: 0 },
        uTime: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(geo, mat);
    this.dome.frustumCulled = false;
    // Drawn after the opaque city with depth testing, so only pixels where the sky actually shows are shaded.
    this.dome.renderOrder = 1000;
    scene.add(this.dome);

    // Stars: deterministic points on the upper sky.
    const pos: number[] = [];
    const size: number[] = [];
    const bright: number[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const z = 0.02 + hash01(i, 1) * 0.98;
      const a = hash01(i, 2) * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.push(Math.cos(a) * r * STAR_RADIUS, z * STAR_RADIUS, Math.sin(a) * r * STAR_RADIUS);
      const b = hash01(i, 3);
      size.push(1 + b * b * 2.2);
      bright.push(0.35 + 0.65 * b);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new Float32BufferAttribute(size, 1));
    sg.setAttribute('aBright', new Float32BufferAttribute(bright, 1));
    const sm = new ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 }, uStars: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.stars = new Points(sg, sm);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;
    scene.add(this.stars);
  }

  update(cameraPos: Vector3, s: SkyInput, target: { x: number; z: number }): void {
    this.dome.position.copy(cameraPos);
    const u = this.dome.material.uniforms;
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.horizon);
    u.uFog.value.copy(s.fog);
    u.uSunDir.value.copy(s.sunDir);
    u.uSunColor.value.copy(s.sunColor);
    u.uSunGlow.value = s.sunGlow;
    u.uMoonDir.value.copy(s.moonDir);
    u.uMoonGlow.value = s.moonGlow;
    u.uCloud.value = s.cloud;
    u.uCloudLit.value.copy(s.cloudLit);
    u.uCloudShade.value.copy(s.cloudShade);
    u.uFlash.value = s.flash;
    u.uHaze.value = s.haze;
    u.uLift.value = s.lift;
    u.uStars.value = s.stars;
    u.uTime.value = s.time;
    this.stars.position.copy(cameraPos);
    const su = this.stars.material.uniforms;
    su.uPixelRatio.value = s.pixelRatio;
    su.uTime.value = s.time;
    su.uStars.value = s.stars * (1 - s.cloud * 0.9) * (1 - s.haze * 0.7);
    this.stars.visible = su.uStars.value > 0.01;
    this.updateBolt(s, target);
  }

  /** A jagged bolt from the cloud base to the ground, 1.2–3 km from the view centre, redrawn per flash. */
  private updateBolt(s: SkyInput, target: { x: number; z: number }): void {
    const key = Math.floor(s.time / FLASH_SLOT);
    if (s.flash > 0.05 && key !== this.boltKey && hash01(key, 5) < 0.55) {
      this.boltKey = key;
      if (this.bolt) {
        this.bolt.removeFromParent();
        this.bolt.geometry.dispose();
      }
      const ang = hash01(key, 6) * Math.PI * 2;
      const dist = 1200 + hash01(key, 7) * 1800;
      let x = target.x + Math.cos(ang) * dist;
      let z = target.z + Math.sin(ang) * dist;
      let y = 850;
      const pts: number[] = [];
      for (let i = 0; i < 14; i++) {
        const nx = x + (hash01(key * 31 + i, 8) - 0.5) * 90;
        const nz = z + (hash01(key * 31 + i, 9) - 0.5) * 90;
        const ny = y - 850 / 14;
        pts.push(x, y, z, nx, ny, nz);
        if (i === 4) pts.push(nx, ny, nz, nx + 140, ny - 160, nz + 60);
        x = nx;
        y = ny;
        z = nz;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      this.bolt = new LineSegments(g, this.boltMat);
      this.bolt.frustumCulled = false;
      this.scene.add(this.bolt);
    }
    if (this.bolt) {
      this.boltMat.opacity = s.flash;
      this.bolt.visible = s.flash > 0.05;
    }
  }

  dispose(): void {
    this.dome.removeFromParent();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.removeFromParent();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    if (this.bolt) {
      this.bolt.removeFromParent();
      this.bolt.geometry.dispose();
    }
    this.boltMat.dispose();
  }
}
