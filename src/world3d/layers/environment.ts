// Sky, sun, ambient light, fog and the shadow box, driven by the game clock.

import { Color, DirectionalLight, Fog, HemisphereLight, Vector3, type Material, type MeshLambertMaterial } from 'three';
import { daylight } from '../../sim/clock';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Sky colours by daylight (0 night … 1 day) and how golden the light is. */
function skyColour(light: number, golden: number, out: Color): Color {
  const night = new Color('#131a33');
  const day = new Color('#a9cbe6');
  const dusk = new Color('#f0b17a');
  out.copy(night).lerp(day, light);
  if (golden > 0) out.lerp(dusk, golden * 0.55);
  return out;
}

export class Environment implements WorldLayer {
  readonly id = 'environment';
  readonly sky = new Color('#a9cbe6');
  readonly fog = new Fog('#a9cbe6', 400, 3000);
  readonly hemi = new HemisphereLight('#cfe3f5', '#b89f7a', 1.1);
  readonly sun = new DirectionalLight('#fff4e0', 2.2);
  /** Direction towards the sun (world space, normalised). */
  readonly sunDir = new Vector3(0.5, 0.8, 0.3);
  /** 0 at night … 1 in full daylight. */
  light = 1;
  private backdrop: MeshLambertMaterial | null = null;
  private lastHour = -1;
  private readonly ctx: ViewContext;

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    const { scene } = ctx;
    scene.background = this.sky;
    scene.fog = this.fog;
    scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  /** The backdrop mountains take the sky colour as atmospheric haze instead of fog. */
  setBackdropMaterial(m: MeshLambertMaterial): void {
    this.backdrop = m;
    this.lastHour = -1;
  }

  update(frame: FrameInfo): void {
    const { rig, renderer } = this.ctx;
    const hour = frame.hour;
    if (Math.abs(hour - this.lastHour) > 0.02) {
      this.lastHour = hour;
      const light = daylight(hour);
      this.light = light;
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
      renderer.toneMappingExposure = 1.05 + (1 - light) * 0.25;
      if (this.backdrop) this.backdrop.color.set('#ffffff').lerp(this.sky, 0.5);
    }
    this.fog.near = rig.dist * 1.4 + 250;
    this.fog.far = rig.dist * 4.5 + 1600;
    // Shadow box follows the camera target, snapped to shadow texels so it doesn't shimmer.
    const extent = clamp(rig.dist * 1.3, 80, 700);
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 3000;
    cam.updateProjectionMatrix();
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    const cx = Math.round(rig.tx / texel) * texel;
    const cy = Math.round(rig.ty / texel) * texel;
    this.sun.target.position.set(cx, 0, -cy);
    this.sun.position.set(cx + this.sunDir.x * 1200, this.sunDir.y * 1200, -cy + this.sunDir.z * 1200);
    this.sun.castShadow = this.sun.intensity > 0.2 && rig.dist < 2500;
  }

  dispose(): void {
    const scene = this.ctx.scene;
    scene.remove(this.hemi, this.sun, this.sun.target);
    this.sun.dispose();
    this.hemi.dispose();
    (this.backdrop as Material | null)?.dispose();
  }
}
