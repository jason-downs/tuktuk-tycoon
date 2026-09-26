// Ambient pedestrians on the pavements around the camera (crowd.ts), drawn as
// one instanced batch once the static city (and its baked walk runs) is ready.
// They walk at real walking pace (never faster than twice real time, so they
// don't sprint at high game speeds), stand still while the game is paused,
// fade in and out at the edge of the area, and are hidden when zoomed out.
// Each has a soft blob shadow at its feet.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { BASE_TIME_SCALE, calendar, daylight } from '../../sim/clock';
import { originWeight } from '../../sim/demand';
import { BlobShadows, blobOpacity, PersonBatch, personLod, personMaterial, PERSON_BLOB_RADIUS } from '../batches';
import { hash01 } from '../build/mesh';
import { CrowdSim, lookEnvAt, WalkNet } from '../crowd';
import { PAVEMENT_Y, ROAD_SURFACE_Y } from '../kinematics';
import { ANIM, personLook, posePerson, POSE_SIZE } from '../personModels';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Most pedestrians drawn at once. */
const CROWD_CAP = 300;
/** Camera distance (m) beyond which the crowd is cleared. */
const CROWD_DIST = 800;
/** Stride length (m at scale 1) for the gait phase: walking, running. */
const STRIDE = 1.35;
const RUN_STRIDE = 2.2;

const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _p = new Vector3();
const _s = new Vector3();

export class CrowdLayer implements WorldLayer {
  readonly id = 'crowds';
  private readonly ctx: ViewContext;
  private readonly batch: PersonBatch;
  private readonly blobs: BlobShadows;
  private readonly pose = new Float32Array(POSE_SIZE);
  private sim: CrowdSim | null = null;
  private lastTime = -1;

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.batch = new PersonBatch(ctx.scene, personMaterial(), 320);
    this.blobs = new BlobShadows(ctx.scene, 320);
  }

  update(frame: FrameInfo): void {
    const { game, rig } = this.ctx;
    if (!this.sim) {
      const city = this.ctx.city();
      const net = city ? WalkNet.fromProps(city.props) : null;
      if (!net) return;
      this.sim = new CrowdSim(net, game.world.places, game.state.seed | 1);
    }
    const time = game.state.time;
    const dtGame = this.lastTime < 0 ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    const cal = calendar(time);
    const near = rig.dist < CROWD_DIST;
    this.sim.update({
      x: rig.tx,
      y: rig.ty,
      radius: Math.min(600, Math.max(160, rig.dist * 1.8)),
      cap: near ? CROWD_CAP : 0,
      cal,
      activity: (p) => originWeight(game, p, cal),
      walkDt: Math.min(dtGame / BASE_TIME_SCALE, 2 * frame.dt),
      realDt: frame.dt,
    });
    this.batch.begin();
    this.blobs.begin();
    if (near) {
      const env = lookEnvAt(game);
      const now = frame.now / 1000;
      const scale = Math.min(2, Math.max(1.15, rig.dist / 180));
      for (const w of this.sim.walkers) {
        const look = personLook(w.type, w.seed, env, w.share);
        const anim = w.moving ? (w.run ? ANIM.run : w.alms ? ANIM.alms : ANIM.walk) : w.id % 3 ? ANIM.stand : ANIM.phone;
        const phase = w.moving ? (w.dist / ((w.run ? RUN_STRIDE : STRIDE) * look.scale)) * Math.PI * 2 : hash01(w.id, 5) * Math.PI * 2;
        posePerson(anim, now, phase, look, this.pose);
        const bob = w.moving ? Math.abs(Math.sin(phase)) * 0.03 * scale : 0;
        const ground = w.street ? ROAD_SURFACE_Y : PAVEMENT_Y;
        const size = scale * look.scale * Math.max(0.01, w.fade);
        _p.set(w.x, ground + bob, -w.y);
        _q.setFromAxisAngle(_up, w.yaw);
        _s.setScalar(size);
        _m.compose(_p, _q, _s);
        this.batch.add(_m, look, this.pose, personLod(Math.hypot(rig.dist, w.x - rig.tx, w.y - rig.ty), size));
        this.blobs.add(w.x, ground, -w.y, PERSON_BLOB_RADIUS * size);
      }
    }
    this.batch.flush();
    this.blobs.flush(blobOpacity(daylight(frame.hour)));
  }

  dispose(): void {
    this.batch.dispose();
    this.blobs.dispose();
  }
}
