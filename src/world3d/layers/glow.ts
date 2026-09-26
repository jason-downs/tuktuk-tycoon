// Cheap night lights without real light sources (docs/3d/architecture.md §11):
// - GlowSprites: additive camera-facing halos (lamp heads, lanterns, candles,
//   market bulbs), one draw call per set, with a minimum on-screen size so
//   distant lights still read as points, and an optional flicker.
// - LightPools: additive discs lying on the ground (the pool of light under a
//   street lamp, a candle's reflection on the river).
// Positions are three.js world space (X east, Y up, Z = −sim y).

import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type PerspectiveCamera,
} from 'three';

/** Shared per-frame values for the glow shaders. */
export interface GlowFrame {
  time: number;
  camera: PerspectiveCamera;
  /** Drawing-buffer height in pixels. */
  viewportHeight: number;
  fogNear: number;
  fogFar: number;
}

const glowVertex = /* glsl */ `
attribute vec4 iPos;    // xyz position, w world radius
attribute vec4 iColor;  // rgb colour, a flicker phase
uniform float uPixelAngle;
uniform float uMinPx;
uniform float uTime;
uniform float uFlicker;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  float depth = max(-mv.z, 0.01);
  float minR = depth * uPixelAngle * uMinPx;
  float r = max(iPos.w, minR);
  // A clamped glow spreads its light over the larger sprite, so distant lights keep a steady brightness.
  float energy = iPos.w / r;
  float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * (7.0 + 3.0 * fract(iColor.a * 7.3)) + iColor.a * 40.0))
                     * (0.6 + 0.4 * sin(uTime * 13.0 + iColor.a * 17.0));
  float fog = 1.0 - 0.85 * smoothstep(uFogNear, uFogFar, depth);
  mv.xy += position.xy * r;
  vUv = position.xy;
  vColor = iColor.rgb * energy * flick * fog;
  gl_Position = projectionMatrix * mv;
}
`;

const glowFragment = /* glsl */ `
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float halo = (1.0 - r2) * (1.0 - r2);
  float core = exp(-r2 * 18.0);
  gl_FragColor = vec4(vColor * (halo * 0.55 + core * 1.6) * uIntensity, 1.0);
}
`;

function quad(): Float32BufferAttribute {
  return new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3);
}

/** Pixel angle (radians per drawing-buffer pixel) at the centre of a perspective view. */
export function pixelAngle(camera: PerspectiveCamera, viewportHeight: number): number {
  return (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeight);
}

export class GlowSprites {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly posAttr: InstancedBufferAttribute;
  private readonly colAttr: InstancedBufferAttribute;
  count = 0;

  /**
   * @param minPx smallest on-screen radius in pixels
   * @param flicker 0 steady … 1 candle-like flicker
   */
  constructor(capacity: number, opts: { minPx?: number; flicker?: number } = {}) {
    this.capacity = capacity;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', quad());
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 4);
    this.posAttr = new InstancedBufferAttribute(this.pos, 4);
    this.colAttr = new InstancedBufferAttribute(this.col, 4);
    g.setAttribute('iPos', this.posAttr);
    g.setAttribute('iColor', this.colAttr);
    g.instanceCount = 0;
    const m = new ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: {
        uPixelAngle: { value: 0.001 },
        uMinPx: { value: opts.minPx ?? 1.6 },
        uTime: { value: 0 },
        uFlicker: { value: opts.flicker ?? 0 },
        uFogNear: { value: 1e5 },
        uFogFar: { value: 2e5 },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  /** Set instance i: world position, radius (m), linear RGB colour, flicker phase. */
  set(i: number, x: number, y: number, z: number, radius: number, r: number, g: number, b: number, phase = 0): void {
    const o = i * 4;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.pos[o + 3] = radius;
    this.col[o] = r;
    this.col[o + 1] = g;
    this.col[o + 2] = b;
    this.col[o + 3] = phase;
  }

  /** Move instance i without touching its size or colour. */
  move(i: number, x: number, y: number, z: number): void {
    this.pos[i * 4] = x;
    this.pos[i * 4 + 1] = y;
    this.pos[i * 4 + 2] = z;
  }

  /** Upload changed instances [0, count). */
  commit(colours = true): void {
    this.mesh.geometry.instanceCount = this.count;
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, this.count * 4);
    this.posAttr.needsUpdate = true;
    if (colours) {
      this.colAttr.clearUpdateRanges();
      this.colAttr.addUpdateRange(0, this.count * 4);
      this.colAttr.needsUpdate = true;
    }
  }

  /** Per-frame uniforms; intensity 0 hides the set without a draw call. */
  frame(f: GlowFrame, intensity: number): void {
    const u = this.mesh.material.uniforms;
    u.uTime.value = f.time;
    u.uPixelAngle.value = pixelAngle(f.camera, f.viewportHeight);
    u.uFogNear.value = f.fogNear;
    u.uFogFar.value = f.fogFar;
    u.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.004 && this.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const poolVertex = /* glsl */ `
attribute vec4 iPos;   // xyz centre, w radius
attribute vec3 iColor;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = position.xy;
  vColor = iColor;
  vec3 p = iPos.xyz + vec3(position.x, 0.0, -position.y) * iPos.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const poolFragment = /* glsl */ `
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float fall = (1.0 - r2);
  fall *= fall;
  gl_FragColor = vec4(vColor * fall * uIntensity, 1.0);
}
`;

export class LightPools {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly posAttr: InstancedBufferAttribute;
  private readonly colAttr: InstancedBufferAttribute;
  count = 0;

  constructor(capacity: number) {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', quad());
    // Counter-clockwise seen from above (the quad lies in X/Z with +Y up).
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 3);
    this.posAttr = new InstancedBufferAttribute(this.pos, 4);
    this.colAttr = new InstancedBufferAttribute(this.col, 3);
    g.setAttribute('iPos', this.posAttr);
    g.setAttribute('iColor', this.colAttr);
    g.instanceCount = 0;
    const m = new ShaderMaterial({
      vertexShader: poolVertex,
      fragmentShader: poolFragment,
      uniforms: { uIntensity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  set(i: number, x: number, y: number, z: number, radius: number, r: number, g: number, b: number): void {
    this.pos.set([x, y, z, radius], i * 4);
    this.col.set([r, g, b], i * 3);
  }

  move(i: number, x: number, y: number, z: number): void {
    this.pos[i * 4] = x;
    this.pos[i * 4 + 1] = y;
    this.pos[i * 4 + 2] = z;
  }

  commit(): void {
    this.mesh.geometry.instanceCount = this.count;
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, this.count * 4);
    this.posAttr.needsUpdate = true;
    this.colAttr.clearUpdateRanges();
    this.colAttr.addUpdateRange(0, this.count * 3);
    this.colAttr.needsUpdate = true;
  }

  frame(intensity: number): void {
    this.mesh.material.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.004 && this.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** A plain BufferGeometry of line segments (wires), built from a flat xyz list. */
export function lineGeometry(xyz: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(xyz, 3));
  g.computeBoundingSphere();
  return g;
}
