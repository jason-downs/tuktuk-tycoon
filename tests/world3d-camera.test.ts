import { describe, expect, it } from 'vitest';
import { DriveCamera, LOOK_HOLD_S, type CameraRig, type ChaseInput } from '../src/world3d/camera';
import { PointerGestures } from '../src/world3d/gestures';

const at = (x: number, y: number, extra: Partial<ChaseInput> = {}): ChaseInput => ({
  x,
  y,
  heading: 0,
  speed: 0,
  timeScale: 4,
  autodrive: false,
  kerb: null,
  ...extra,
});

/** Run the chase camera for `seconds` of real time at 60 frames a second, from `now` ms. Returns the new time. */
function run(cam: DriveCamera, rig: CameraRig, input: ChaseInput, seconds: number, now: number): number {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    now += 1000 / 60;
    cam.update(rig, input, 1 / 60, now);
  }
  return now;
}

/** A chase camera settled behind a tuk-tuk at the origin whose pedals have been pressed `presses` times. */
function chase(presses = 0): { cam: DriveCamera; rig: CameraRig; now: number } {
  const cam = new DriveCamera();
  const rig: CameraRig = { tx: 0, ty: 0, dist: 300, yaw: 0, elev: 0.7 };
  cam.setMode('chase', rig, 0);
  const now = run(cam, rig, at(0, 0, { pedalPresses: presses }), 2, 0);
  return { cam, rig, now };
}

describe('Drive-mode "show on the map"', () => {
  it('glides the chase camera over to the point, holds, then swings back behind the tuk-tuk', () => {
    const { cam, rig, now: t0 } = chase();
    expect(Math.hypot(rig.tx, rig.ty)).toBeLessThan(1);
    cam.lookAt(1500, -800, 180, rig, t0);
    expect(cam.looking).toBe(true);
    let now = run(cam, rig, at(0, 0), 2, t0);
    expect(rig.tx).toBeCloseTo(1500, 0);
    expect(rig.ty).toBeCloseTo(-800, 0);
    expect(rig.dist).toBeCloseTo(180, -1);
    now = run(cam, rig, at(0, 0), LOOK_HOLD_S, now);
    expect(cam.looking).toBe(false);
    run(cam, rig, at(0, 0), 2, now);
    expect(Math.hypot(rig.tx, rig.ty)).toBeLessThan(1);
  });

  it('the throttle or brake brings it straight back, even a press between two frames', () => {
    const { cam, rig, now: t0 } = chase(3);
    cam.lookAt(1500, -800, 180, rig, t0);
    let now = run(cam, rig, at(0, 0, { pedalPresses: 3 }), 1.5, t0);
    expect(cam.looking).toBe(true);
    now = run(cam, rig, at(0, 0, { pedalPresses: 4 }), 1 / 60, now);
    expect(cam.looking).toBe(false);
    run(cam, rig, at(0, 0, { pedalPresses: 4 }), 1.5, now);
    expect(Math.hypot(rig.tx, rig.ty)).toBeLessThan(1);
  });

  it('a point beside the tuk-tuk (🎯) ends a look-at, and leaving Drive drops it', () => {
    const { cam, rig, now: t0 } = chase();
    cam.lookAt(1500, -800, 180, rig, t0);
    let now = run(cam, rig, at(0, 0), 1, t0);
    cam.lookAt(5, 5, 180, rig, now);
    expect(cam.looking).toBe(false);
    now = run(cam, rig, at(0, 0), 1.5, now);
    expect(Math.hypot(rig.tx, rig.ty)).toBeLessThan(1);

    cam.lookAt(1500, -800, 180, rig, now);
    cam.setMode('manage', rig, now);
    expect(cam.looking).toBe(false);
  });

  it('zooming during a look-at zooms that view', () => {
    const { cam, rig, now: t0 } = chase();
    cam.lookAt(1500, -800, 200, rig, t0);
    const now = run(cam, rig, at(0, 0), 1.5, t0);
    cam.wheel(2, now);
    run(cam, rig, at(0, 0), 2, now);
    expect(rig.dist).toBeCloseTo(400, -1);
    expect(cam.zoom).toBe(1);
  });
});

describe('touch gestures on the 3D view', () => {
  it('a second finger turns the drag into a pinch that zooms by the change in spread', () => {
    const g = new PointerGestures();
    expect(g.down(1, 100, 100)).toBe('single');
    expect(g.move(1, 104, 100)).toBeNull();
    expect(g.down(2, 200, 100)).toBe('pinch');
    expect(g.pinching).toBe(true);
    // Spreading from 96 px to 192 px apart halves the camera distance.
    const step = g.move(2, 296, 100)!;
    expect(step.factor).toBeCloseTo(0.5);
    expect(step.mid).toEqual({ x: 200, y: 100 });
    // Pinching back in doubles it.
    expect(g.move(2, 200, 100)!.factor).toBeCloseTo(2);
  });

  it('the finger left after a pinch neither drags nor taps until all have lifted', () => {
    const g = new PointerGestures();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    expect(g.up(2)).toBe(true);
    expect(g.pinching).toBe(true);
    expect(g.move(1, 150, 150)).toBeNull();
    expect(g.up(1)).toBe(true);
    expect(g.pinching).toBe(false);
    expect(g.down(3, 10, 10)).toBe('single');
    expect(g.up(3)).toBe(false);
  });

  it('a pinch reports how far its midpoint has travelled, for panning', () => {
    const g = new PointerGestures();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    const first = g.move(1, 110, 120)!;
    const step = g.move(2, 210, 120)!;
    // Both fingers moved the same way: no zoom overall, and the midpoint moved (10, 20).
    expect(first.factor * step.factor).toBeCloseTo(1);
    expect(step.travel).toBeCloseTo(Math.hypot(5, 10) + Math.hypot(5, 10));
    expect(step.mid).toEqual({ x: 160, y: 120 });
  });
});
