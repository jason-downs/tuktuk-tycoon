// Shader warm-up: the variants the 3D view flips between at run time (the sun
// casting shadows or not, the Drive-mode cutaway on or off, the shadow
// casters' depth programs) are all compiled when the city loads, so none of
// them is compiled in the middle of a frame.

import { BoxGeometry, DirectionalLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { applyCutaway, compileCutaway, createCutaway } from '../src/world3d/cutaway';
import { compileShaderVariants } from '../src/world3d/shaderWarmup';

function scene(castShadow: boolean) {
  const s = new Scene();
  const sun = new DirectionalLight();
  sun.castShadow = castShadow;
  s.add(sun);
  const mat = new MeshLambertMaterial();
  const cut = createCutaway();
  applyCutaway(mat, cut);
  s.add(new Mesh(new BoxGeometry(), mat));
  /** The light and define state each compile saw; the log also has each frame drawn. */
  const seen: string[] = [];
  const log: string[] = [];
  const state = () => `shadows ${sun.castShadow}, cutaway ${'USE_CUTAWAY' in (mat.defines ?? {})}`;
  const renderer = {
    compile: () => {
      seen.push(state());
      log.push(`compile: ${state()}`);
    },
    render: () => log.push(`draw: ${state()}`),
  };
  return { s, sun, mat, cut, seen, log, renderer };
}

describe('shader warm-up', () => {
  it('compiles with the sun casting shadows and not, with and without the cutaway', () => {
    const t = scene(false);
    compileShaderVariants(t.renderer, t.s, new PerspectiveCamera(), t.sun, t.cut);
    expect([...t.seen].sort()).toEqual(['shadows false, cutaway false', 'shadows false, cutaway true', 'shadows true, cutaway false', 'shadows true, cutaway true']);
    // The shadow casters' depth programs: a frame without shadows, then two with them, as at sunrise.
    expect(t.log.filter((e) => e.startsWith('draw'))).toEqual(['draw: shadows false, cutaway false', 'draw: shadows true, cutaway false', 'draw: shadows true, cutaway false']);
    expect(t.log.slice(-3).every((e) => e.startsWith('draw'))).toBe(true);
  });

  it('leaves the sun and the cutaway as they were', () => {
    for (const [shadows, cutOn] of [
      [false, false],
      [true, true],
      [true, false],
    ]) {
      const t = scene(shadows);
      compileCutaway(t.cut, cutOn);
      compileShaderVariants(t.renderer, t.s, new PerspectiveCamera(), t.sun, t.cut);
      expect(t.sun.castShadow).toBe(shadows);
      expect(t.cut.compiled).toBe(cutOn);
      expect('USE_CUTAWAY' in (t.mat.defines ?? {})).toBe(cutOn);
      // The state in use when the frame renders was compiled first.
      expect(t.seen[0]).toBe(`shadows ${shadows}, cutaway ${cutOn}`);
      expect(t.log.filter((e) => e.startsWith('draw')).every((e) => e.endsWith(`cutaway ${cutOn}`))).toBe(true);
    }
  });
});
