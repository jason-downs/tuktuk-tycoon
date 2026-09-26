// Shader warm-up: the variants the 3D view flips between at run time (the sun
// casting shadows or not, the Drive-mode cutaway on or off, the shadow
// casters' depth programs) are all compiled when the city loads, and those of
// anything added to the scene later in the frame it arrives, so none of them
// is compiled in the middle of a frame at sunrise, dusk or a zoom.

import { BoxGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Scene, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { FX } from '../src/world3d/build/effects';
import { applyCutaway, compileCutaway, createCutaway } from '../src/world3d/cutaway';
import type { FestivalState } from '../src/world3d/env/festivals';
import { FestivalDecor } from '../src/world3d/layers/festivals';
import { compileShaderVariants, ShaderWarmup } from '../src/world3d/shaderWarmup';

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

/** A scene with a warm-up whose renderer records, per compile, each material it reached and the light and cutaway state. */
function warmScene(castShadow: boolean) {
  const t = scene(castShadow);
  const compiled: string[] = [];
  const nameOf = (m: Material) => m.name || m.customProgramCacheKey();
  const renderer = {
    compile: (root: Object3D) => {
      root.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        if (m) compiled.push(`${nameOf(m)}: shadows ${t.sun.castShadow}, cutaway ${t.cut.compiled}`);
      });
    },
    render: () => {},
  };
  const warm = new ShaderWarmup(renderer, t.s, new PerspectiveCamera(), t.sun, t.cut);
  return { ...t, compiled, warm };
}

const box = (mat: Material, name: string) => {
  mat.name = name;
  return new Mesh(new BoxGeometry(), mat);
};

describe('shader warm-up of what is added later', () => {
  it('compiles a lit object added after the city loaded for both light states, before its first frame', () => {
    const t = warmScene(true);
    t.s.add(box(new MeshLambertMaterial(), 'early'));
    t.warm.warmAll();
    t.warm.run();
    // The full warm-up covers what was there already.
    expect(t.compiled.filter((c) => c.startsWith('early'))).toHaveLength(4);
    t.compiled.length = 0;
    t.warm.run();
    expect(t.compiled).toEqual([]);

    t.s.add(box(new MeshLambertMaterial(), 'stall'));
    t.warm.run();
    expect([...t.compiled].sort()).toEqual(['stall: shadows false, cutaway false', 'stall: shadows true, cutaway false']);
    expect(t.sun.castShadow).toBe(true);
    // Once only.
    t.compiled.length = 0;
    t.warm.run();
    expect(t.compiled).toEqual([]);
  });

  it('adds the cutaway variants for an object that carries it, and leaves the sun and the cutaway as they were', () => {
    const t = warmScene(false);
    compileCutaway(t.cut, true);
    t.warm.warmAll();
    t.warm.run();
    t.compiled.length = 0;
    const krathong = new Mesh(new BoxGeometry(), t.mat);
    t.mat.name = 'model';
    t.s.add(krathong);
    t.warm.run();
    expect([...t.compiled].sort()).toEqual([
      'model: shadows false, cutaway false',
      'model: shadows false, cutaway true',
      'model: shadows true, cutaway false',
      'model: shadows true, cutaway true',
    ]);
    expect(t.compiled[0]).toBe('model: shadows false, cutaway true');
    expect(t.sun.castShadow).toBe(false);
    expect(t.cut.compiled).toBe(true);
    expect('USE_CUTAWAY' in (t.mat.defines ?? {})).toBe(true);
  });

  it('leaves out unlit objects, empty groups and objects taken out again before the frame', () => {
    const t = warmScene(true);
    t.warm.warmAll();
    t.warm.run();
    t.compiled.length = 0;
    t.s.add(box(new MeshBasicMaterial(), 'blob'), new Group());
    const gone = box(new MeshLambertMaterial(), 'gone');
    t.s.add(gone);
    t.s.remove(gone);
    t.warm.run();
    expect(t.compiled).toEqual([]);
    t.warm.dispose();
    t.s.add(box(new MeshLambertMaterial(), 'after'));
    t.warm.run();
    expect(t.compiled).toEqual([]);
  });

  it('compiles the Night Bazaar stalls for the dusk light state when they go up in the afternoon', () => {
    const t = warmScene(true);
    const none: FestivalState = { yiPengLanterns: false, yiPengEvening: false, sundayMarket: false, saturdayMarket: false, nightBazaar: false, songkran: 0, chineseNewYear: false };
    const camera = new PerspectiveCamera(40, 1.6, 1, 40_000);
    const glow = { time: 0, camera, viewportHeight: 900, fogNear: 500, fogFar: 2600 };
    const decor = new FestivalDecor(t.s, new MeshLambertMaterial(), { [FX.stallBazaar]: new Float32Array([0, 0, 0, 1, 12, 0, 0.5, 1, 24, 0, 1, 1]) });
    decor.update({ glow, state: none, night: 0, krathongs: 0 });
    t.warm.warmAll();
    t.warm.run();
    t.compiled.length = 0;
    // 17:00, sun still up: the stalls go up.
    decor.update({ glow, state: { ...none, nightBazaar: true }, night: 0.1, krathongs: 0 });
    t.warm.run();
    const stalls = t.compiled.filter((c) => c.startsWith('market-stall-glow'));
    expect(new Set(stalls)).toEqual(new Set(['market-stall-glow: shadows true, cutaway false', 'market-stall-glow: shadows false, cutaway false']));
    expect(t.sun.castShadow).toBe(true);
    decor.dispose();
  });
});
