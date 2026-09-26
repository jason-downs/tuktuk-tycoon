import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BufferGeometry, InstancedMesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, type Mesh } from 'three';
import { FX } from '../src/world3d/build/effects';
import { buildCity } from '../src/world3d/build/world';
import type { CityData } from '../src/world3d/city';
import { festivalsAt } from '../src/world3d/env/festivals';
import { QUALITY } from '../src/world3d/env/quality';
import { krathongGeometry, lanternGeometry, stallBaseGeometry, stallCanopyGeometry, TriBuilder } from '../src/world3d/festivalModels';
import { Mist, Rain, Splashes } from '../src/world3d/layers/effects';
import { FestivalDecor } from '../src/world3d/layers/festivals';
import type { GlowFrame } from '../src/world3d/layers/glow';
import { lampLayout, LAMP_SPECS, NightLights } from '../src/world3d/layers/nightLights';
import { Sky } from '../src/world3d/layers/sky';
import { timeOf } from '../src/sim/clock';
import { Color } from 'three';

const city = JSON.parse(readFileSync(new URL('../public/data/city3d.json', import.meta.url), 'utf8')) as CityData;
const built = buildCity(city);

/** Every triangle of a non-indexed geometry: vertices and stored normal. */
function triangles(g: BufferGeometry): { a: Vector3; b: Vector3; c: Vector3; n: Vector3 }[] {
  const p = g.getAttribute('position');
  const nm = g.getAttribute('normal');
  const out = [];
  for (let i = 0; i < p.count; i += 3) {
    out.push({
      a: new Vector3().fromBufferAttribute(p, i),
      b: new Vector3().fromBufferAttribute(p, i + 1),
      c: new Vector3().fromBufferAttribute(p, i + 2),
      n: new Vector3().fromBufferAttribute(nm, i),
    });
  }
  return out;
}

/** The stored normal matches the counter-clockwise winding (front faces point where the normal says). */
function windingMatchesNormals(g: BufferGeometry): boolean {
  return triangles(g).every(({ a, b, c, n }) => {
    const w = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    return w.length() < 1e-9 || w.normalize().dot(n) > 0.999;
  });
}

describe('festival models', () => {
  it('builds prisms whose faces point outwards', () => {
    const b = new TriBuilder();
    b.ring(1, 1, 0, 1, 6, new Color('#fff'));
    b.cap(1, 1, 6, new Color('#fff'), true);
    b.cap(1, 0, 6, new Color('#fff'), false);
    b.box(2, 0, 2, 3, 1, 3, new Color('#fff'), true);
    b.cone(1, 1, 1.5, 6, new Color('#fff'));
    b.cone(1, 0, -0.5, 6, new Color('#fff'));
    const g = b.geometry();
    expect(windingMatchesNormals(g)).toBe(true);
    for (const t of triangles(g)) {
      const centre = new Vector3().add(t.a).add(t.b).add(t.c).divideScalar(3);
      // Outward: away from the prism axis (0, y, 0) or the box centre (2.5, 0.5, 2.5).
      const inBox = centre.x >= 2 - 1e-6;
      const axis = inBox ? new Vector3(2.5, 0.5, 2.5) : new Vector3(0, 0.5, 0);
      expect(t.n.dot(centre.sub(axis))).toBeGreaterThan(0);
    }
  });

  it('hangs the lantern below its string and keeps it small', () => {
    const g = lanternGeometry();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.y).toBeLessThanOrEqual(1e-6);
    expect(bb.min.y).toBeGreaterThan(-1.2);
    expect(bb.max.x - bb.min.x).toBeLessThan(0.6);
    expect(windingMatchesNormals(g)).toBe(true);
    expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(32);
  });

  it('roofs stalls above their tables, faces outwards and up', () => {
    const canopy = stallCanopyGeometry();
    const base = stallBaseGeometry();
    canopy.computeBoundingBox();
    base.computeBoundingBox();
    expect(canopy.boundingBox!.min.y).toBeGreaterThan(0.95);
    expect(base.boundingBox!.max.y).toBeLessThanOrEqual(canopy.boundingBox!.max.y);
    expect(windingMatchesNormals(canopy)).toBe(true);
    expect(windingMatchesNormals(base)).toBe(true);
    // Roof faces tilt up and outwards; valances face outwards.
    for (const t of triangles(canopy)) {
      const centre = new Vector3().add(t.a).add(t.b).add(t.c).divideScalar(3);
      expect(t.n.x * centre.x + t.n.z * centre.z).toBeGreaterThan(0);
      expect(t.n.y).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(canopy.getAttribute('position').count / 3 + base.getAttribute('position').count / 3).toBeLessThan(120);
    expect(windingMatchesNormals(krathongGeometry())).toBe(true);
  });
});

describe('street lamp lights', () => {
  it('puts the arm lamp head over the road and the heritage lantern on its post', () => {
    const props = {
      street_lamp: new Float32Array([10, 20, Math.PI / 2, 1]),
      heritage_lamp: new Float32Array([0, 0, 0, 1]),
    };
    const l = lampLayout(props);
    expect(l.heads.length / 8).toBe(2);
    // Arm lamp facing north (yaw π/2): head 1.8 m north of the pole, i.e. world z = −(20 + 1.8).
    expect(l.heads[0]).toBeCloseTo(10, 5);
    expect(l.heads[1]).toBeCloseTo(LAMP_SPECS.street_lamp.height, 5);
    expect(l.heads[2]).toBeCloseTo(-(20 + LAMP_SPECS.street_lamp.reach), 5);
    expect(l.pools[1]).toBeGreaterThan(0.13);
    expect(l.pools[3]).toBe(LAMP_SPECS.street_lamp.pool);
    expect(l.heads[8 + 1]).toBeCloseTo(LAMP_SPECS.heritage_lamp.height, 5);
    for (const v of [...l.heads, ...l.pools]) expect(Number.isFinite(v)).toBe(true);
  });

  it('copes with a city that has no lamps yet', () => {
    const scene = new Scene();
    const lights = new NightLights(scene, {});
    expect(lights.lampCount).toBe(0);
    lights.update(frame(), 1);
    lights.dispose();
    expect(scene.children.length).toBe(0);
  });
});

function frame(t = 10): GlowFrame {
  const camera = new PerspectiveCamera(40, 1.6, 1, 40_000);
  camera.position.set(1700, 150, 150);
  camera.lookAt(1662, 0, 247);
  camera.updateMatrixWorld();
  return { time: t, camera, viewportHeight: 900, fogNear: 500, fogFar: 2600 };
}

describe('festival decor from the real anchors', () => {
  const isLantern = (o: unknown): o is InstancedMesh =>
    o instanceof InstancedMesh && (o.material as MeshLambertMaterial).customProgramCacheKey() === 'khom-khwaen-lantern';
  const lanternMeshes = (scene: Scene) => scene.children.filter(isLantern);

  it('hangs Yi Peng lanterns 5–6.3 m over the streets on the festival night, and nothing on an ordinary day', () => {
    const scene = new Scene();
    const decor = new FestivalDecor(scene, new MeshLambertMaterial({ vertexColors: true }), built.props);
    // An ordinary Tuesday noon: no festival, no market.
    decor.update({ glow: frame(), state: festivalsAt(timeOf(2026, 10, 10, 12)), night: 0, krathongs: 100 });
    expect(scene.children.filter((o) => o.visible && (o as Mesh).isMesh).length).toBe(0);
    decor.update({ glow: frame(), state: festivalsAt(timeOf(2026, 10, 24, 20)), night: 1, krathongs: 100 });
    const [lanterns] = lanternMeshes(scene);
    expect(lanterns.visible).toBe(true);
    expect(lanterns.count).toBeGreaterThan(2000);
    const m = new Vector3();
    const mat = new (lanterns.instanceMatrix.array.constructor as Float32ArrayConstructor)(16);
    for (let i = 0; i < lanterns.count; i += 37) {
      mat.set(lanterns.instanceMatrix.array.subarray(i * 16, i * 16 + 16));
      m.set(mat[12], mat[13], mat[14]);
      expect(m.y).toBeGreaterThan(5.5);
      expect(m.y).toBeLessThan(6.35);
    }
    const tris = (lanterns.geometry.getAttribute('position').count / 3) * lanterns.count;
    console.log(`Yi Peng: ${lanterns.count} lanterns, ${tris} triangles`);
    expect(tris).toBeLessThan(110_000);
    // Krathongs drift and stay on the Ping between the bridges.
    decor.update({ glow: frame(20), state: festivalsAt(timeOf(2026, 10, 24, 20)), night: 1, krathongs: 100 });
    decor.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('puts up walking-street stalls on Sunday evening and takes them down on Monday', () => {
    const scene = new Scene();
    const decor = new FestivalDecor(scene, new MeshLambertMaterial({ vertexColors: true }), built.props);
    decor.update({ glow: frame(), state: festivalsAt(timeOf(2026, 10, 1, 19)), night: 1, krathongs: 100 });
    const stalls = scene.children.filter((o): o is InstancedMesh => o instanceof InstancedMesh && o.visible);
    const count = Math.max(...stalls.map((s) => s.count));
    expect(count).toBe(built.props[FX.stallSunday].length / 4);
    decor.update({ glow: frame(), state: festivalsAt(timeOf(2026, 10, 2, 12)), night: 0, krathongs: 100 });
    expect(scene.children.filter((o) => o instanceof InstancedMesh && o.visible).length).toBe(0);
    decor.dispose();
  });
});

describe('weather effects and sky', () => {
  it('builds rain, mist, splashes and the sky without a renderer', () => {
    const scene = new Scene();
    const f = frame();
    const rain = new Rain(scene, QUALITY.high.rainStreaks);
    rain.update(10, f.camera, 900, new Vector3(1662, 0, 247), 220, 1, 0.5, new Color('#aab'), 0.5);
    expect(rain.mesh.visible).toBe(true);
    expect(rain.mesh.geometry.instanceCount).toBe(Math.round(QUALITY.high.rainStreaks * 0.5));
    rain.update(10, f.camera, 900, new Vector3(), 220, 0, 0.5, new Color('#aab'), 0.5);
    expect(rain.mesh.visible).toBe(false);

    const mist = new Mist(scene, built.props[FX.mist], QUALITY.medium.mistPuffs);
    expect(mist.mesh.geometry.instanceCount).toBeLessThanOrEqual(QUALITY.medium.mistPuffs + 2);
    expect(mist.mesh.geometry.instanceCount).toBeGreaterThan(QUALITY.medium.mistPuffs * 0.5);

    const splashes = new Splashes(scene, built.props[FX.moat], QUALITY.medium.splashDrops);
    splashes.update(0, f.camera, 900, 1662, -247, 220, 1, 1);
    splashes.update(3, f.camera, 900, 1662, -247, 220, 1, 1);
    expect(splashes.mesh.visible).toBe(true);

    const sky = new Sky(scene);
    const c = new Color('#8ab');
    sky.update(
      f.camera.position,
      {
        time: 1,
        zenith: c,
        horizon: c,
        fog: c,
        sunDir: new Vector3(0, 1, 0),
        sunColor: c,
        sunGlow: 1,
        moonDir: new Vector3(0, -1, 0),
        moonGlow: 0,
        cloud: 1,
        cloudLit: c,
        cloudShade: c,
        stars: 0,
        flash: 1,
        haze: 0,
        lift: 0,
        pixelRatio: 1,
      },
      { x: 0, z: 0 },
    );
    for (const x of [rain, mist, splashes, sky]) x.dispose();
    expect(scene.children.filter((o) => (o as Mesh).isMesh).length).toBe(0);
  });
});
