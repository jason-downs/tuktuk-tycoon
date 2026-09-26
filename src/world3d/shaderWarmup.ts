// Shader variants the 3D view switches between while it runs, compiled up
// front. Whether the sun casts shadows is part of every lit program (three.js
// keys programs on the number of shadow-casting lights), and it flips at
// sunrise, at dusk and when the camera zooms out past the shadow range; the
// Drive-mode cutaway is a define on the city and model materials. Compiling a
// variant on first use stalls that frame for every material at once, so each
// one is compiled when the city has loaded.

import type { Camera, DirectionalLight, Scene } from 'three';
import { compileCutaway, type Cutaway } from './cutaway';

/** The part of WebGLRenderer this needs. */
export interface ShaderCompiler {
  compile(scene: Scene, camera: Camera): unknown;
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
