import { Matrix4, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { TREE_KINDS } from '../src/world3d/build/context';
import { MeshWriter } from '../src/world3d/build/mesh';
import { attachments, cableRidge, cableTube, catenary, local, POLE, poleStations, STREET_LAMP_HEAD } from '../src/world3d/build/props';
import { Clearance, OB, ribbonOutline } from '../src/world3d/build/clearance';
import { ccw, signedArea, walk } from '../src/world3d/build/streets';
import { Kit } from '../src/world3d/lowpoly';
import { PROP_MODELS } from '../src/world3d/propModels';
import { treeGeometry } from '../src/world3d/treeModels';

/** Per-triangle centroid and face normal (from the winding) of a non-indexed geometry. */
function faces(g: BufferGeometry): { c: Vector3; n: Vector3 }[] {
  const p = g.getAttribute('position');
  const out: { c: Vector3; n: Vector3 }[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(p, i);
    const b = new Vector3().fromBufferAttribute(p, i + 1);
    const c = new Vector3().fromBufferAttribute(p, i + 2);
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() > 1e-12) out.push({ c: a.add(b).add(c).divideScalar(3), n: n.normalize() });
  }
  return out;
}

function finite(g: BufferGeometry): boolean {
  for (const name of ['position', 'normal', 'color']) {
    const a = g.getAttribute(name).array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  }
  return true;
}

describe('low-poly kit', () => {
  it('winds lumps, prisms and boxes outwards', () => {
    const k = new Kit();
    k.lump(1, 5, -2, 3, 2, 2.5, 7, () => '#4a7a37', 3);
    const lump = faces(k.geometry());
    expect(lump.length).toBe(28);
    for (const f of lump) expect(f.n.dot(f.c.clone().sub(new Vector3(1, 5.2, -2)))).toBeGreaterThan(0);

    const p = new Kit();
    p.prism([0, 0, 0], [1, 4, 0.5], 0.4, 0.2, 5, '#5b4a3a', { capTop: true });
    const axis = new Vector3(1, 4, 0.5).normalize();
    for (const f of faces(p.geometry())) {
      // Side faces point away from the axis; the cap points along it.
      const radial = f.c.clone().sub(axis.clone().multiplyScalar(f.c.dot(axis)));
      expect(f.n.dot(radial) > 0 || f.n.dot(axis) > 0.9).toBe(true);
    }

    const b = new Kit();
    b.box(2, 1, 3, 1, 2, 1.5, '#999999', '#aaaaaa', { rotY: 0.7, bottom: '#888888' });
    const bf = faces(b.geometry());
    expect(bf.length).toBe(12);
    for (const f of bf) expect(f.n.dot(f.c.clone().sub(new Vector3(2, 1, 3)))).toBeGreaterThan(0);
  });

  it('writes flat normals that match the winding', () => {
    const k = new Kit();
    k.lump(0, 0, 0, 1, 1, 1, 6, () => '#ffffff', 1);
    const g = k.geometry();
    const nrm = g.getAttribute('normal');
    faces(g).forEach((f, i) => {
      const n = new Vector3().fromBufferAttribute(nrm, i * 3);
      expect(n.dot(f.n)).toBeGreaterThan(0.999);
    });
  });
});

describe('tree models', () => {
  for (const kind of TREE_KINDS) {
    it(`${kind}: stands on the origin within ~120 triangles`, () => {
      const g = treeGeometry(kind);
      expect(finite(g)).toBe(true);
      const tris = g.getAttribute('position').count / 3;
      expect(tris).toBeLessThanOrEqual(120);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      // Leaning trunks, roots and props sink a few centimetres into the ground.
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.1);
      expect(bb.min.y).toBeLessThan(0.3);
      expect(bb.max.y).toBeGreaterThan(2);
      expect(bb.max.y).toBeLessThan(32);
      // Foliage faces mostly look up or out, not into the trunk.
      const up = faces(g).filter((f) => f.n.y > 0).length;
      expect(up / (tris || 1)).toBeGreaterThan(0.35);
    });
  }

  it('gives the rain tree a wide umbrella crown and the yang na a tall trunk', () => {
    const size = (k: string) => {
      const g = treeGeometry(k);
      g.computeBoundingBox();
      return g.boundingBox!.getSize(new Vector3());
    };
    const rain = size('rain');
    expect(rain.x).toBeGreaterThan(rain.y);
    expect(rain.x).toBeGreaterThan(14);
    expect(size('yang').y).toBeGreaterThan(25);
    expect(size('bougainvillea').y).toBeLessThan(4);
  });
});

describe('prop models', () => {
  for (const [kind, make] of Object.entries(PROP_MODELS)) {
    it(`${kind}: finite, lean, standing on the ground`, () => {
      const g = make();
      expect(finite(g)).toBe(true);
      expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(kind === 'parked_bike' ? 120 : 100);
      g.computeBoundingBox();
      if (kind === 'fountain') expect(g.boundingBox!.min.y).toBeLessThan(-1.5);
      else expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01);
    });
  }

  it('hangs the street lamp head over +X at its published height', () => {
    const g = PROP_MODELS.street_lamp();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeGreaterThan(STREET_LAMP_HEAD.reach);
    expect(g.boundingBox!.max.y).toBeGreaterThan(STREET_LAMP_HEAD.height);
    expect(g.boundingBox!.max.y).toBeLessThan(STREET_LAMP_HEAD.height + 0.6);
  });

  it('reaches the signal arm over the road on the model’s left (−Z)', () => {
    const g = PROP_MODELS.traffic_light();
    g.computeBoundingBox();
    expect(g.boundingBox!.min.z).toBeLessThan(-4);
    expect(g.boundingBox!.max.z).toBeLessThan(0.5);
  });

  it('spans the power-pole crossarm across the road (model Z) at the published height', () => {
    const g = PROP_MODELS.power_pole();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeGreaterThan(POLE.armHalf);
    expect(g.boundingBox!.min.z).toBeLessThan(-POLE.armHalf);
    expect(g.boundingBox!.max.y).toBeCloseTo(POLE.height, 1);
  });
});

describe('placement geometry', () => {
  it('maps model offsets to sim metres the way the instanced layer rotates props', () => {
    // CityLayer: world = R_y(yaw)·model + (x, 0, −y); sim = (world.x, −world.z).
    for (const yaw of [0, 0.6, 2.2, -1.3]) {
      const m = new Matrix4().makeRotationY(yaw);
      for (const [mx, mz] of [
        [1, 0],
        [0, 1],
        [2.3, -4.1],
      ]) {
        const w = new Vector3(mx, 0, mz).applyMatrix4(m);
        const [sx, sy] = local(10, 20, yaw, mx, mz);
        expect(sx).toBeCloseTo(10 + w.x, 6);
        expect(sy).toBeCloseTo(20 - w.z, 6);
      }
    }
    // Model +X is the yaw heading; model +Z is its right-hand side.
    const [fx, fy] = local(0, 0, Math.PI / 2, 1, 0);
    expect(fx).toBeCloseTo(0, 6);
    expect(fy).toBeCloseTo(1, 6);
    const [rx, ry] = local(0, 0, 0, 0, 1);
    expect(rx).toBeCloseTo(0, 6);
    expect(ry).toBeCloseTo(-1, 6);
  });

  it('reproduces the road ribbon outline with the left edge on the left of travel', () => {
    const { left, right } = ribbonOutline(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      2,
      1,
    );
    expect(left[0]).toEqual([-1, 2]);
    expect(right[0]).toEqual([-1, -2]);
    // Mitred corner: outside of the left turn is on the right.
    expect(right[1][0]).toBeCloseTo(12, 6);
    expect(right[1][1]).toBeCloseTo(-2, 6);
    expect(left[2][1]).toBeCloseTo(11, 6);
  });

  it('spaces pole stations evenly, clear of the ends, with a station at sharp bends', () => {
    const st = poleStations(
      [
        [0, 0],
        [100, 0],
        [100, 60],
      ],
      35,
    );
    expect(st[0].x).toBeCloseTo(4, 6);
    const last = st[st.length - 1];
    expect(last.y).toBeCloseTo(56, 6);
    expect(st.some((s) => Math.abs(s.x - 100) < 1e-6 && Math.abs(s.y) < 1e-6)).toBe(true);
    for (let i = 1; i < st.length; i++) {
      const d = Math.hypot(st[i].x - st[i - 1].x, st[i].y - st[i - 1].y);
      expect(d).toBeGreaterThan(20);
      expect(d).toBeLessThan(45);
    }
    // The bend station's normal is the bisector, stretched by the mitre factor.
    const bend = st.find((s) => Math.abs(s.x - 100) < 1e-6)!;
    expect(bend.nx).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(bend.ny).toBeCloseTo(Math.SQRT1_2, 6);
    expect(bend.miter).toBeCloseTo(Math.SQRT2, 6);
    expect(poleStations([[0, 0], [20, 0]], 35)).toHaveLength(1);
  });

  it('attaches the cable bundle on the road side of the pole and the lines at the crossarm ends', () => {
    // Pole on the left (+1) of an eastbound road: the road is to its south.
    const a = attachments({ x: 0, y: 5, dx: 1, dy: 0, side: 1 });
    expect(a.bundle[1]).toBeLessThan(5);
    expect(a.bundle[2]).toBe(POLE.bundle);
    expect(Math.abs(a.lineL[1] - 5)).toBeCloseTo(POLE.armHalf, 6);
    expect(a.lineL[1]).toBeGreaterThan(5);
    expect(a.lineR[1]).toBeLessThan(5);
  });

  it('sags cables between their ends with outward faces', () => {
    const a: [number, number, number] = [0, 0, 5.7];
    const b: [number, number, number] = [30, 10, 5.9];
    expect(catenary(a, b, 1, 0)).toEqual(a);
    expect(catenary(a, b, 1, 1)).toEqual(b);
    expect(catenary(a, b, 1, 0.5)[2]).toBeCloseTo(4.8, 6);
    const w = new MeshWriter();
    cableTube(w, a, b, 1, 0.1, 4, [20, 20, 20]);
    expect(w.triangleCount).toBe(24);
    const m = w.pack();
    // Each vertex's normal points away from the cable's centreline at that point (world X, Y up, Z = −y).
    for (let v = 0; v < m.position.length / 3; v++) {
      const X = m.position[v * 3];
      const t = X / 30;
      const [cx, cy, ch] = catenary(a, b, 1, t);
      const off = [X - cx, m.position[v * 3 + 1] - ch, m.position[v * 3 + 2] + cy];
      const n = [m.normal[v * 3], m.normal[v * 3 + 1], m.normal[v * 3 + 2]];
      expect(off[0] * n[0] + off[1] * n[1] + off[2] * n[2]).toBeGreaterThan(-0.02);
    }
    const r = new MeshWriter();
    cableRidge(r, a, b, 0.5, 0.05, 2, [20, 20, 20]);
    expect(r.triangleCount).toBe(8);
    const rm = r.pack();
    for (let v = 0; v < rm.normal.length / 3; v++) expect(rm.normal[v * 3 + 1]).toBeGreaterThan(0);
  });

  it('normalises ring winding whatever the stored order', () => {
    const square: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(signedArea(square)).toBe(16);
    expect(signedArea([...square].reverse())).toBe(-16);
    expect(ccw([...square].reverse())).toEqual(square);
    expect(ccw(square)).toBe(square);
  });

  it('answers obstacle queries for ribbons, small and large polygons and capsules', () => {
    const cl = new Clearance(-100, -100, 100, 100);
    cl.addRibbon(
      [
        [-50, 0],
        [50, 0],
      ],
      3,
      2,
      OB.ROAD,
    );
    cl.addPoly(
      [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
      ],
      OB.BUILDING,
    );
    // A 40-gon (banded inside test, edges indexed separately) around (-40, 40), radius 15.
    const circle: [number, number][] = [];
    for (let i = 0; i < 40; i++) circle.push([-40 + Math.cos((i / 40) * Math.PI * 2) * 15, 40 + Math.sin((i / 40) * Math.PI * 2) * 15]);
    cl.addPoly(circle, OB.WATER);
    cl.addLine(
      [
        [60, -60],
        [60, 60],
      ],
      1,
      OB.WALL,
    );
    expect(cl.hit(0, 2.9, 0, OB.ROAD)).toBe(true);
    expect(cl.hit(0, 3.2, 0, OB.ROAD)).toBe(false);
    expect(cl.hit(0, 3.2, 0.3, OB.ROAD)).toBe(true);
    expect(cl.hit(51.5, 0, 0, OB.ROAD)).toBe(true);
    expect(cl.hit(52.5, 0, 0, OB.ROAD)).toBe(false);
    expect(cl.hit(15, 15, 0, OB.BUILDING)).toBe(true);
    expect(cl.hit(15, 15, 0, OB.ROAD)).toBe(false);
    expect(cl.hit(21, 15, 0.5, OB.BUILDING)).toBe(false);
    expect(cl.hit(21, 15, 1.5, OB.BUILDING)).toBe(true);
    expect(cl.hit(-40, 40, 0, OB.WATER)).toBe(true);
    expect(cl.hit(-40, 56, 0, OB.WATER)).toBe(false);
    expect(cl.hit(-40, 56, 1.5, OB.WATER)).toBe(true);
    expect(cl.hit(60.9, 0, 0, OB.WALL)).toBe(true);
    expect(cl.hit(61.5, 0, 0, OB.WALL)).toBe(false);
    expect(cl.hit(61.5, 0, 0.6, OB.WALL)).toBe(true);
  });

  it('walks a closed ring at the requested spacing', () => {
    const pts: [number, number][] = [];
    walk(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      5,
      () => 10,
      (s) => pts.push([s.x, s.y]),
      true,
    );
    expect(pts).toEqual([
      [5, 0],
      [10, 5],
      [5, 10],
      [0, 5],
    ]);
  });
});
