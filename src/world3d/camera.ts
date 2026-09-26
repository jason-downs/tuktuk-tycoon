// Camera modes for the 3D view. 'chase' sits behind and above the player's
// tuk-tuk in Drive mode and turns with it; 'kerbside' drops to kerb level
// beside the tuk-tuk and the passenger during the player's haggle; 'manage' is
// the free follow/pan camera, driven by World3DView itself. Switching mode
// glides from where the camera is to the new goal. In Drive mode "show on the
// map" (lookAt) glides the chase camera over to a point for a few seconds and
// then back behind the tuk-tuk.

/** Camera state in sim metres: target point, distance from it, compass yaw of the view (0 = looking north), elevation above the horizon (radians). */
export interface CameraRig {
  tx: number;
  ty: number;
  dist: number;
  yaw: number;
  elev: number;
}

export type CameraMode = 'chase' | 'kerbside' | 'manage';

const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Shortest signed turn from angle a to angle b, radians. */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** The compass yaw that looks along a sim heading (radians counter-clockwise from east). */
export const yawAlong = (heading: number): number => Math.PI / 2 - heading;

/** Chase distance (m) for an on-screen speed (m per real second). */
export const chaseDistance = (screenSpeed: number): number => clamp(45 + 1.2 * screenSpeed, 35, 120);

/** How far ahead of the tuk-tuk (m) the chase camera looks at an on-screen speed. */
export const chaseLookAhead = (screenSpeed: number): number => Math.min(30, 0.8 * screenSpeed);

/** Elevation of the free camera: ~40° at follow distance, flatter close in, steeper far out. */
export function manageElevation(dist: number, tilt = 0): number {
  const e = 28 + 12 * clamp(dist / 160, 0, 1) + 26 * smoothstep(250, 3500, dist);
  return clamp(e * DEG + tilt, 10 * DEG, 85 * DEG);
}

/** [pacing] Chase elevation while steering by hand, and while the GPS drives (the camera lifts to see ahead). */
const CHASE_ELEV = 27 * DEG;
const AUTODRIVE_ELEV = 50 * DEG;
/** While the GPS drives, the camera sits this far back (m), further at speed. */
const AUTODRIVE_DIST = [220, 400] as const;
/** Kerbside: distance range (m), elevation, angle off the heading, orbit speed. */
const KERB_DIST = [14, 25] as const;
const KERB_ELEV = 16 * DEG;
const KERB_ANGLE = 70 * DEG;
const KERB_ORBIT = 3 * DEG;
/** Real seconds the yaw takes to follow the heading (time constant). */
const YAW_TAU = 0.35;
/** Real seconds after the last orbit drag before the chase camera swings back behind. */
const RECENTRE_AFTER = 2.5;
/** Real seconds for a mode change to glide to the new camera. */
const GLIDE_S = 0.9;
/** [pacing] Real seconds a look-at holds on its point, after the glide, before swinging back behind the tuk-tuk. */
export const LOOK_HOLD_S = 5;
/** A look-at closer than this (m) to the tuk-tuk swings straight back behind it instead. */
const LOOK_NEAR_M = 40;

export interface ChaseInput {
  /** Pose of the player's tuk-tuk in its lane. */
  x: number;
  y: number;
  heading: number;
  /** Game metres per second, and game seconds per real second now. */
  speed: number;
  timeScale: number;
  /** The GPS (or autopilot) is driving. */
  autodrive: boolean;
  /** Throttle and brake presses so far (ManualControl.presses): a new press ends a look-at. */
  pedalPresses?: number;
  /** Where the passenger stands, during the kerbside haggle. */
  kerb: { x: number; y: number } | null;
}

/** Chase and kerbside camera state: smoothing, the player's orbit and zoom, and glides between modes. */
export class DriveCamera {
  mode: CameraMode = 'manage';
  /** Orbit offsets from the player's drag, radians. */
  yawOffset = 0;
  tiltOffset = 0;
  /** Wheel zoom multiplier on the chase distance. */
  zoom = 1;
  private lastOrbit = -Infinity;
  private screenSpeed = 0;
  private heading: number | null = null;
  private from: CameraRig | null = null;
  private glide = 1;
  private kerbSince = 0;
  /** The point a look-at shows, from how far, at what yaw, and until when (ms). */
  private look: { x: number; y: number; dist: number; yaw: number; until: number } | null = null;
  /** The tuk-tuk's position at the last update. */
  private at: { x: number; y: number } | null = null;
  private pressesSeen: number | null = null;

  /** Change mode; the camera glides from `rig` to the new mode's goal. Leaving Drive, or the haggle starting, ends a look-at. */
  setMode(mode: CameraMode, rig: CameraRig, now: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.from = { ...rig };
    this.glide = 0;
    if (mode !== 'chase') this.look = null;
    if (mode === 'kerbside') this.kerbSince = now;
    if (mode === 'chase') {
      this.yawOffset = 0;
      this.tiltOffset = 0;
      this.heading = null;
    }
  }

  /** A look-at is showing a point away from the tuk-tuk. */
  get looking(): boolean {
    return this.look !== null;
  }

  /**
   * Show a point (x, y) from `dist` metres: the camera glides over, holds for
   * LOOK_HOLD_S and swings back behind the tuk-tuk; the throttle or brake
   * brings it back sooner. A point beside the tuk-tuk (🎯) brings it straight back.
   */
  lookAt(x: number, y: number, dist: number, rig: CameraRig, now: number): void {
    if (this.at && Math.hypot(x - this.at.x, y - this.at.y) < LOOK_NEAR_M) {
      this.endLook(rig);
      return;
    }
    this.look = { x, y, dist: clamp(dist, 22, 6000), yaw: rig.yaw, until: now + (GLIDE_S + LOOK_HOLD_S) * 1000 };
    this.yawOffset = 0;
    this.tiltOffset = 0;
    this.from = { ...rig };
    this.glide = 0;
  }

  /** Swing back from a look-at to behind the tuk-tuk. */
  endLook(rig: CameraRig): void {
    if (!this.look) return;
    this.look = null;
    this.yawOffset = 0;
    this.tiltOffset = 0;
    this.from = { ...rig };
    this.glide = 0;
  }

  /** Right- or left-drag in Drive mode: look around; the camera swings back after RECENTRE_AFTER seconds. */
  orbit(dx: number, dy: number, now: number): void {
    this.yawOffset += dx * 0.006;
    this.tiltOffset = clamp(this.tiltOffset - dy * 0.004, -0.3, 0.9);
    this.lastOrbit = now;
    if (this.look) this.look.until = Math.max(this.look.until, now + LOOK_HOLD_S * 1000);
  }

  /** Wheel or pinch zoom; the chase camera may pull right out to an overview. During a look-at it zooms that view. */
  wheel(factor: number, now = 0): void {
    if (this.look) {
      this.look.dist = clamp(this.look.dist * factor, 22, 6000);
      this.look.until = Math.max(this.look.until, now + LOOK_HOLD_S * 1000);
      return;
    }
    this.zoom = clamp(this.zoom * factor, 0.5, 60);
  }

  /** Move `rig` towards this frame's goal. `now` is in ms; dt in real seconds. */
  update(rig: CameraRig, input: ChaseInput, dt: number, now: number): void {
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    const raw = input.speed * input.timeScale;
    this.screenSpeed += (raw - this.screenSpeed) * k(0.5);
    if (this.heading === null) this.heading = input.heading;
    else this.heading += angleTo(this.heading, input.heading) * k(YAW_TAU);
    this.at = { x: input.x, y: input.y };
    const presses = input.pedalPresses ?? 0;
    const pressed = this.pressesSeen !== null && presses !== this.pressesSeen;
    this.pressesSeen = presses;
    if (this.look && (pressed || now >= this.look.until)) this.endLook(rig);
    if ((now - this.lastOrbit) / 1000 > RECENTRE_AFTER) {
      this.yawOffset *= 1 - k(0.6);
      this.tiltOffset *= 1 - k(0.6);
    }

    const goal: CameraRig = { tx: input.x, ty: input.y, dist: 0, yaw: 0, elev: 0 };
    if (this.look) {
      // Looking at a point: seen from the yaw the camera had, at the free camera's elevation for that distance.
      goal.tx = this.look.x;
      goal.ty = this.look.y;
      goal.dist = this.look.dist;
      goal.yaw = this.look.yaw + this.yawOffset;
      goal.elev = clamp(manageElevation(goal.dist) + this.tiltOffset, 8 * DEG, 85 * DEG);
    } else if (this.mode === 'kerbside' && input.kerb) {
      const gap = Math.hypot(input.kerb.x - input.x, input.kerb.y - input.y);
      goal.tx = (input.x + input.kerb.x) / 2;
      goal.ty = (input.y + input.kerb.y) / 2;
      goal.dist = clamp(gap * 1.2 + 12, KERB_DIST[0], KERB_DIST[1]) * clamp(this.zoom, 0.7, 3);
      // From the road side, looking across the tuk-tuk towards the passenger at the kerb, turning slowly.
      const side = Math.sign(angleTo(input.heading, Math.atan2(input.kerb.y - input.y, input.kerb.x - input.x))) || 1;
      const orbit = ((now - this.kerbSince) / 1000) * KERB_ORBIT;
      goal.yaw = yawAlong(input.heading) - side * KERB_ANGLE + orbit + this.yawOffset;
      goal.elev = clamp(KERB_ELEV + this.tiltOffset, 6 * DEG, 80 * DEG);
    } else {
      const heading = this.heading;
      const ahead = input.autodrive ? 0 : chaseLookAhead(this.screenSpeed);
      goal.tx = input.x + Math.cos(heading) * ahead;
      goal.ty = input.y + Math.sin(heading) * ahead;
      const base = input.autodrive
        ? clamp(AUTODRIVE_DIST[0] + 0.5 * this.screenSpeed, AUTODRIVE_DIST[0], AUTODRIVE_DIST[1])
        : chaseDistance(this.screenSpeed);
      goal.dist = clamp(base * this.zoom, 22, 6000);
      goal.yaw = yawAlong(heading) + this.yawOffset;
      // Zoomed well out, the chase camera tilts up towards the overview's elevation.
      const low = input.autodrive ? AUTODRIVE_ELEV : CHASE_ELEV;
      const far = smoothstep(150, 900, goal.dist);
      goal.elev = clamp(low + (manageElevation(goal.dist) - low) * far + this.tiltOffset, 8 * DEG, 85 * DEG);
    }

    if (this.glide < 1 && this.from) {
      this.glide = Math.min(1, this.glide + dt / GLIDE_S);
      const t = smoothstep(0, 1, this.glide);
      const f = this.from;
      rig.tx = f.tx + (goal.tx - f.tx) * t;
      rig.ty = f.ty + (goal.ty - f.ty) * t;
      rig.dist = f.dist + (goal.dist - f.dist) * t;
      rig.yaw = f.yaw + angleTo(f.yaw, goal.yaw) * t;
      rig.elev = f.elev + (goal.elev - f.elev) * t;
      return;
    }
    rig.tx = goal.tx;
    rig.ty = goal.ty;
    rig.dist += (goal.dist - rig.dist) * k(0.4);
    rig.yaw = goal.yaw;
    rig.elev += (goal.elev - rig.elev) * k(0.3);
  }
}
