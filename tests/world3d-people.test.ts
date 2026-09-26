import { Matrix4, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../src/content/archetypes';
import type { Archetype } from '../src/sim/types';
import { PersonBatch, personMaterial } from '../src/world3d/batches';
import { triangles } from '../src/world3d/models';
import {
  ANIM,
  hasPart,
  JOINT,
  LIMB,
  packHex,
  PART,
  personGeometry,
  personLook,
  posePerson,
  POSE_SIZE,
  RIG_GLSL,
  rigPoint,
  seatedLook,
  SHORTS,
  type PersonLook,
  type PersonType,
} from '../src/world3d/personModels';

const ARCHS = Object.keys(ARCHETYPES) as Archetype[];
const AMBIENT: PersonType[] = ['local', 'office', 'schoolkid', 'jogger', 'nun', 'driver', 'rider'];
const geo = personGeometry();
const rig = geo.getAttribute('aRig');
const index = geo.index!;

/** Triangles a look actually shows (the rest collapse in the shader). */
function shownTriangles(look: PersonLook): number {
  let n = 0;
  for (let t = 0; t < index.count; t += 3) {
    const part = rig.getY(index.getX(t));
    if (part === 0 || look.parts & (1 << part)) n++;
  }
  return n;
}

const handR: [number, number, number] = [0.01, 0.8, JOINT.shoulderZ];
const handL: [number, number, number] = [0.01, 0.8, -JOINT.shoulderZ];
const pose = (anim: number, look: PersonLook, t = 1, phase = 0) => {
  const p = new Float32Array(POSE_SIZE);
  posePerson(anim, t, phase, look, p);
  return p;
};

describe('people models', () => {
  it('keeps the rigged figure within budget, with sane tags', () => {
    const total = triangles(geo);
    console.log(`person geometry: ${total} triangles, ${geo.getAttribute('position').count} vertices`);
    expect(total).toBeLessThanOrEqual(1100);
    for (let i = 0; i < rig.count; i++) {
      expect(rig.getX(i)).toBeLessThanOrEqual(LIMB.shinR);
      expect(rig.getY(i)).toBeLessThanOrEqual(23);
      expect(rig.getZ(i)).toBeLessThanOrEqual(8);
    }
    const pos = geo.getAttribute('position');
    let top = 0;
    for (let i = 0; i < pos.count; i++) top = Math.max(top, rig.getY(i) === 0 ? pos.getY(i) : 0);
    expect(top).toBeGreaterThan(1.6);
    expect(top).toBeLessThan(1.72);
  });

  it('has a distant model with the same tags and the parts that shape a figure, at about half the triangles', () => {
    const far = personGeometry(1);
    console.log(`distant person geometry: ${triangles(far)} triangles, ${far.getAttribute('position').count} vertices`);
    expect(triangles(far)).toBeLessThan(triangles(geo) * 0.55);
    expect(far.getAttribute('position').count).toBeLessThan(geo.getAttribute('position').count * 0.6);
    expect(Object.keys(far.attributes).sort()).toEqual(Object.keys(geo.attributes).sort());
    const farRig = far.getAttribute('aRig');
    const kept = new Set<number>();
    let top = 0;
    for (let i = 0; i < farRig.count; i++) {
      kept.add(farRig.getY(i));
      if (farRig.getY(i) === 0) top = Math.max(top, far.getAttribute('position').getY(i));
    }
    const shapes: (keyof typeof PART)[] = ['body', 'hairShort', 'hairBun', 'hairLong', 'bucketHat', 'sunHat', 'cap', 'conicalHat', 'helmet', 'backpack', 'bag', 'parasol', 'pole', 'suitcase', 'skirt', 'robe', 'scarf', 'apron'];
    for (const part of shapes) expect(kept.has(PART[part])).toBe(true);
    expect(top).toBeGreaterThan(1.6);
    expect(top).toBeLessThan(1.72);
  });

  it('dresses every archetype recognisably within 150–420 shown triangles', () => {
    for (const type of [...ARCHS, ...AMBIENT]) {
      for (let seed = 0; seed < 24; seed++) {
        const look = personLook(type, seed);
        const shown = shownTriangles(look);
        expect(shown).toBeGreaterThanOrEqual(150);
        expect(shown).toBeLessThanOrEqual(420);
        expect(look.colB[3]).toBe(look.parts);
      }
    }
    const share = (type: PersonType, part: keyof typeof PART) => {
      let n = 0;
      for (let seed = 0; seed < 60; seed++) if (hasPart(personLook(type, seed), part)) n++;
      return n / 60;
    };
    expect(share('backpacker', 'backpack')).toBe(1);
    expect(share('monk', 'robe')).toBe(1);
    expect(share('monk', 'hairShort') + share('monk', 'hairLong') + share('monk', 'hairBun')).toBe(0);
    expect(share('vendor', 'conicalHat')).toBe(1);
    expect(share('business', 'suitcase')).toBeGreaterThan(0.5);
    expect(share('tourist_kr', 'bucketHat')).toBeGreaterThan(0.5);
    expect(share('elder', 'skirt')).toBeGreaterThan(0.5);
    expect(share('tourist_cn', 'parasol') + share('tourist_cn', 'sunHat')).toBeGreaterThan(0.95);
    expect(share('nomad', 'headphones')).toBeGreaterThan(0.5);
    expect(share('rider', 'helmet')).toBeGreaterThan(0.6);
    const saffron = [packHex('#e8871e'), packHex('#9c5a24')];
    for (let seed = 0; seed < 20; seed++) {
      expect(saffron).toContain(personLook('monk', seed).colA[1]);
      expect(personLook('student', seed).colA[1]).toBe(packHex('#f7f7f5'));
    }
    // Dawn alms bowls, rain umbrellas, cool-season scarves on Thai visitors.
    expect(hasPart(personLook('monk', 3, { dawn: true }), 'bowl')).toBe(true);
    let umbrellas = 0;
    let scarves = 0;
    for (let seed = 0; seed < 60; seed++) {
      if (hasPart(personLook('local', seed, { rain: true }), 'parasol')) umbrellas++;
      if (hasPart(personLook('thai_tourist', seed, { cool: true }), 'scarf')) scarves++;
    }
    expect(umbrellas).toBeGreaterThan(20);
    expect(scarves).toBeGreaterThan(30);
  });

  it('is deterministic, and parties can dress alike', () => {
    expect(personLook('tourist_west', 42)).toEqual(personLook('tourist_west', 42));
    const a = personLook('tourist_cn', 1, {}, 99);
    const b = personLook('tourist_cn', 2, {}, 99);
    expect(a.colA[1]).toBe(b.colA[1]);
  });

  it('stows carried things for seated riders', () => {
    for (let seed = 0; seed < 40; seed++) {
      const seated = seatedLook(personLook('elder', seed, { rain: true }));
      expect(hasPart(seated, 'parasol')).toBe(false);
      expect(seated.colB[3]).toBe(seated.parts);
    }
  });

  it('packs colours as 24-bit integers', () => {
    expect(packHex('#e8871e')).toBe(0xe8871e);
    expect(packHex('#000000')).toBe(0);
  });
});

describe('people poses', () => {
  const look = personLook('tourist_west', 5);

  it('hails with the right arm out towards the road, flapping', () => {
    const lows: number[] = [];
    for (let t = 0; t < 0.5; t += 0.05) {
      const hand = rigPoint(handR, LIMB.forearmR, pose(ANIM.hail, look, t));
      expect(hand[1]).toBeGreaterThan(1.25);
      expect(hand[0]).toBeGreaterThan(0.35);
      expect(hand[2]).toBeGreaterThan(JOINT.shoulderZ);
      lows.push(hand[1]);
    }
    expect(Math.max(...lows) - Math.min(...lows)).toBeGreaterThan(0.05);
    const idle = rigPoint(handR, LIMB.forearmR, pose(ANIM.stand, look));
    expect(idle[1]).toBeLessThan(0.95);
  });

  it('swings the legs in turn when walking', () => {
    const foot: [number, number, number] = [0.05, 0.05, -JOINT.hipZ];
    const a = rigPoint(foot, LIMB.shinL, pose(ANIM.walk, look, 0, Math.PI / 2));
    const b = rigPoint(foot, LIMB.shinL, pose(ANIM.walk, look, 0, -Math.PI / 2));
    expect(a[0]).toBeGreaterThan(0.2);
    expect(b[0]).toBeLessThan(-0.1);
    for (let ph = 0; ph < Math.PI * 2; ph += 0.3) expect(rigPoint(foot, LIMB.shinL, pose(ANIM.walk, look, 0, ph))[1]).toBeGreaterThan(-0.02);
  });

  it('sits with thighs level and shins hanging', () => {
    const p = pose(ANIM.sit, look);
    const knee = rigPoint([0, JOINT.kneeY, -JOINT.hipZ], LIMB.thighL, p);
    expect(knee[0]).toBeGreaterThan(0.35);
    expect(Math.abs(knee[1] - JOINT.hipY)).toBeLessThan(0.05);
    const foot = rigPoint([0.05, 0.05, -JOINT.hipZ], LIMB.shinL, p);
    expect(foot[1]).toBeLessThan(knee[1] - 0.3);
  });

  it('holds a parasol up and presses palms together for a wai', () => {
    const parasolLook = personLook('tourist_cn', [...Array(40).keys()].find((s) => hasPart(personLook('tourist_cn', s), 'parasol'))!);
    const left = rigPoint(handL, LIMB.forearmL, pose(ANIM.walk, parasolLook, 0, 1));
    expect(left[1]).toBeGreaterThan(1.15);
    const p = pose(ANIM.wai, look);
    const l = rigPoint(handL, LIMB.forearmL, p);
    const r = rigPoint(handR, LIMB.forearmR, p);
    expect(Math.abs(l[2] - r[2])).toBeLessThan(0.2);
    expect(l[1]).toBeGreaterThan(1.1);
  });

  it('shares its joints with the shader', () => {
    for (const v of [JOINT.hipY, JOINT.kneeY, JOINT.shoulderY, JOINT.elbowY, JOINT.leanY]) expect(RIG_GLSL).toContain(v.toFixed(4));
    expect(SHORTS).toBe(1);
  });
});

describe('person batches', () => {
  it('grow in place, keeping the mesh and the instances already added', () => {
    const scene = new Scene();
    const batch = new PersonBatch(scene, personMaterial(), 2);
    const mesh = scene.children[0];
    const look = personLook('local', 1);
    const p = new Float32Array(POSE_SIZE);
    batch.begin();
    for (let i = 0; i < 5; i++) {
      p[0] = i;
      batch.add(new Matrix4().makeTranslation(i, 0, 0), look, p);
    }
    batch.flush();
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(mesh);
    const im = mesh as unknown as { count: number; instanceMatrix: { array: Float32Array }; geometry: { getAttribute(n: string): { array: Float32Array } } };
    expect(im.count).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(im.instanceMatrix.array[i * 16 + 12]).toBe(i);
      expect(im.geometry.getAttribute('iPoseA').array[i * 4]).toBe(i);
      expect(im.geometry.getAttribute('iColB').array[i * 4 + 3]).toBe(look.parts);
    }
    batch.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
