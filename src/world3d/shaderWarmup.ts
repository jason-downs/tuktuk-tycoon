// Shader variants the 3D view switches between while it runs, compiled up
// front. Whether the sun casts shadows is part of every lit program (three.js
// keys programs on the number of shadow-casting lights), and it flips at
// sunrise, at dusk and when the camera zooms out past the shadow range; the
// Drive-mode cutaway is a define on the city and model materials. Compiling a
// variant on first use stalls that frame for every material at once, so each
// one is compiled when the city has loaded, and the variants of anything added
// to the scene after that (festival and market decor, rain curtains) in the
// frame it arrives.

import type { Camera, DirectionalLight, Material, Mesh, Object3D, Scene } from 'three';
import { compileCutaway, type Cutaway } from './cutaway';

/** The part of WebGLRenderer this needs. */
export interface ShaderCompiler {
  compile(scene: Object3D, camera: Camera, targetScene?: Scene | null): unknown;
  render(scene: Scene, camera: Camera): void;
}

/**
 * Compile every material in the scene with the sun casting and not casting
 * shadows, with and without the cutaway, and make the shadow casters' depth
 * programs; leaves the sun and the cutaway as they were.
 *
 * Depth programs are made only in a frame's shadow pass, which runs before
 * that frame sets up its lights: the first frame with shadows uses the
 * previous frame's shadowless light state, and the frames after it their
 * own. Drawing the scene once without shadows and twice with them makes both.
 */
export function compileShaderVariants(renderer: ShaderCompiler, scene: Scene, camera: Camera, sun: DirectionalLight, cutaway: Cutaway): void {
  const shadows = sun.castShadow;
  const cut = cutaway.compiled;
  for (const cutOn of [cut, !cut]) {
    compileCutaway(cutaway, cutOn);
    for (const cast of [shadows, !shadows]) {
      sun.castShadow = cast;
      renderer.compile(scene, camera);
    }
  }
  compileCutaway(cutaway, cut);
  for (const cast of [false, true, true]) {
    sun.castShadow = cast;
    renderer.render(scene, camera);
  }
  sun.castShadow = shadows;
}

type AnyMaterial = Material & {
  isMeshLambertMaterial?: boolean;
  isMeshPhongMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  isMeshToonMaterial?: boolean;
  isShadowMaterial?: boolean;
  isShaderMaterial?: boolean;
  lights?: boolean;
};

/** Whether three.js switches this material's program when the lights change: the materials it lights. */
function isLit(mat: Material): boolean {
  const m = mat as AnyMaterial;
  return !!(m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial || m.isMeshToonMaterial || m.isShadowMaterial || (m.isShaderMaterial && m.lights));
}

/** The drawable objects under `root` with a lit material. */
function litObjects(root: Object3D, out: Object3D[]): void {
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (m && (Array.isArray(m) ? m.some(isLit) : isLit(m))) out.push(o);
  });
}

/**
 * Compile the lit materials of objects added to the scene with the sun
 * casting and not casting shadows, and with and without the cutaway when one
 * of them carries it; leaves the sun and the cutaway as they were. Shadow
 * casters among them use the shadow map's shared depth materials, whose
 * programs the load-time warm-up made.
 */
export function compileAddedVariants(renderer: ShaderCompiler, objects: readonly Object3D[], scene: Scene, camera: Camera, sun: DirectionalLight, cutaway: Cutaway): void {
  const lit: Object3D[] = [];
  for (const o of objects) litObjects(o, lit);
  if (!lit.length) return;
  const shadows = sun.castShadow;
  const cut = cutaway.compiled;
  const carriesCut = lit.some((o) => {
    const m = (o as Mesh).material as Material | Material[];
    return (Array.isArray(m) ? m : [m]).some((x) => cutaway.materials.includes(x));
  });
  for (const cutOn of carriesCut ? [cut, !cut] : [cut]) {
    compileCutaway(cutaway, cutOn);
    for (const cast of [shadows, !shadows]) {
      sun.castShadow = cast;
      for (const o of lit) renderer.compile(o, camera, scene);
    }
  }
  compileCutaway(cutaway, cut);
  sun.castShadow = shadows;
}

/**
 * Keeps the view's shader variants compiled before they are drawn: all of them
 * at the first `run` after `warmAll` (the city has loaded), and from then on
 * those of each object added to the scene, at the next `run`. Call `run` after
 * the layers' update and before the frame renders.
 */
export class ShaderWarmup {
  private readonly renderer: ShaderCompiler;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly sun: DirectionalLight;
  private readonly cutaway: Cutaway;
  private pendingAll = false;
  private warmed = false;
  /** Objects added to the scene since the last run, once the full warm-up has run. */
  private readonly added: Object3D[] = [];
  private readonly onChildAdded = (e: { child: Object3D }): void => {
    if (this.warmed) this.added.push(e.child);
  };

  constructor(renderer: ShaderCompiler, scene: Scene, camera: Camera, sun: DirectionalLight, cutaway: Cutaway) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.cutaway = cutaway;
    scene.addEventListener('childadded', this.onChildAdded);
  }

  /** Compile every variant of everything in the scene at the next run. */
  warmAll(): void {
    this.pendingAll = true;
  }

  run(): void {
    if (this.pendingAll) {
      this.pendingAll = false;
      this.warmed = true;
      this.added.length = 0;
      compileShaderVariants(this.renderer, this.scene, this.camera, this.sun, this.cutaway);
      return;
    }
    if (!this.added.length) return;
    // Objects taken out again before the frame are not drawn.
    const still = this.added.filter((o) => o.parent === this.scene);
    this.added.length = 0;
    compileAddedVariants(this.renderer, still, this.scene, this.camera, this.sun, this.cutaway);
  }

  dispose(): void {
    this.scene.removeEventListener('childadded', this.onChildAdded);
    this.added.length = 0;
  }
}
