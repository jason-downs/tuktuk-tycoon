// Waiting and alighting passengers, dressed by archetype (docs/3d/world.md
// §4.3–4.4) and drawn as one instanced batch.
// - Waiting: a party stands side by side at the kerb facing the road. The
//   first of them hails (arm out, palm-down flap) when your tuk-tuk comes within
//   about 60 m, while it drives up to collect them, or when the request is
//   selected or hovered; the others idle, then fidget, check a watch and fold
//   their arms as their patience runs out.
// - Alighting: at the end of a trip the party stands for a moment on the
//   tuk-tuk's left (the side passengers use): Thai passengers wai, monks only
//   nod, everyone else simply stands, then they fade away.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { TripResult } from '../../sim/dispatch';
import type { Archetype } from '../../sim/types';
import { PersonBatch, personMaterials } from '../batches';
import { hash01 } from '../build/mesh';
import { lookEnvAt } from '../crowd';
import { PAVEMENT_Y } from '../kinematics';
import { ANIM, personGeometry, personLook, posePerson, POSE_SIZE, type PersonType } from '../personModels';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Metres within which the first of a party hails your tuk-tuk. */
const HAIL_RADIUS = 60;
/** Metres within which a passenger you have claimed waves you in. */
const APPROACH_RADIUS = 150;
/** Spacing (m, before scaling) of a party along the kerb. */
const PARTY_SPACING = 0.7;
/** Real seconds alighting passengers stay in view. */
const ALIGHT_SECONDS = 3.5;
/** Passengers who thank the driver with a wai as they step out (culture.md §4; monks do not wai laypeople). */
const WAI: ReadonlySet<Archetype> = new Set(['thai_tourist', 'student', 'vendor', 'elder']);

/** Party members who dress alike share a colour seed (groups of Chinese tourists, Thai families). */
export function partyShare(archetype: PersonType, requestId: number): number | undefined {
  return archetype === 'tourist_cn' || archetype === 'thai_tourist' ? requestId * 13 + 1 : undefined;
}

/** Look seed of member k of a request's party (the same figure later sits in the tuk-tuk). */
export const partySeed = (requestId: number, k: number): number => requestId * 7 + k;

interface Alighting {
  x: number;
  y: number;
  /** Heading of the tuk-tuk they left. */
  yaw: number;
  archetype: Archetype;
  requestId: number;
  party: number;
  /** Real time (s) they stepped out. */
  at: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _p = new Vector3();
const _s = new Vector3();

export class PeopleLayer implements WorldLayer {
  readonly id = 'people';
  private readonly ctx: ViewContext;
  private readonly batch: PersonBatch;
  private readonly pose = new Float32Array(POSE_SIZE);
  private readonly alighting: Alighting[] = [];
  private readonly unsubscribe: () => void;
  private now = 0;

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.batch = new PersonBatch(ctx.scene, personGeometry(), personMaterials(), 32);
    this.unsubscribe = ctx.game.on('trip', (r) => this.onTrip(r as TripResult));
  }

  private onTrip(r: TripResult): void {
    const m = this.ctx.vehicleMesh(r.vehicleId);
    if (!m) return;
    this.alighting.push({ x: m.position.x, y: -m.position.z, yaw: m.rotation.y, archetype: r.request.archetype, requestId: r.request.id, party: r.request.party, at: this.now });
  }

  update(frame: FrameInfo): void {
    const { game } = this.ctx;
    const player = game.playerVehicle();
    const pp = player ? game.vehiclePose(player) : null;
    const scale = this.ctx.vehicleScale();
    const time = game.state.time;
    const env = lookEnvAt(game);
    const now = (this.now = frame.now / 1000);
    this.batch.begin();
    for (const r of game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      const k = this.ctx.kerbOf(r);
      const face = k.face;
      const dist = pp ? Math.hypot(pp.x - k.x, pp.y - k.y) : Infinity;
      const claimed = player !== undefined && r.claimedBy === player.id;
      const hailing = dist < HAIL_RADIUS || (claimed && dist < APPROACH_RADIUS) || frame.ui.selectedRequest === r.id || this.ctx.hoverRequest === r.id;
      const patience = Math.max(0, (r.expiresAt - time) / Math.max(1, r.expiresAt - r.spawnedAt));
      const share = partyShare(r.archetype, r.id);
      for (let m = 0; m < r.party; m++) {
        const seed = partySeed(r.id, m);
        const anim =
          m === 0 && hailing
            ? ANIM.hail
            : patience > 0.5
              ? hash01(seed, 4) < 0.35
                ? ANIM.phone
                : ANIM.stand
              : patience > 0.25
                ? ANIM.fidget
                : (seed & 1) === 0
                  ? ANIM.watch
                  : ANIM.cross;
        // Side by side along the kerb (perpendicular to the way they face), each turned a little.
        const off = (m - (r.party - 1) / 2) * PARTY_SPACING * scale;
        this.add(r.archetype, seed, share, anim, k.x + Math.sin(face) * off, k.y - Math.cos(face) * off, face + (hash01(seed, 5) - 0.5) * 0.3, scale, env, now);
      }
    }
    for (let i = this.alighting.length - 1; i >= 0; i--) {
      const a = this.alighting[i];
      const age = now - a.at;
      if (age > ALIGHT_SECONDS || age < 0) {
        this.alighting.splice(i, 1);
        continue;
      }
      // On the tuk-tuk's left, strung out along it, turned to face the driver.
      const fade = Math.min(1, (ALIGHT_SECONDS - age) / 0.5);
      const lx = -Math.sin(a.yaw);
      const ly = Math.cos(a.yaw);
      const fx = Math.cos(a.yaw);
      const fy = Math.sin(a.yaw);
      const share = partyShare(a.archetype, a.requestId);
      for (let m = 0; m < a.party; m++) {
        const along = (0.2 - m * PARTY_SPACING) * scale;
        const side = 1.6 * scale;
        const anim = WAI.has(a.archetype) && age > 0.4 ? ANIM.wai : ANIM.stand;
        this.add(a.archetype, partySeed(a.requestId, m), share, anim, a.x + lx * side + fx * along, a.y + ly * side + fy * along, a.yaw - Math.PI / 2 + 0.5, scale * fade, env, now);
      }
    }
    this.batch.flush();
  }

  private add(type: Archetype, seed: number, share: number | undefined, anim: number, x: number, y: number, yaw: number, scale: number, env: ReturnType<typeof lookEnvAt>, now: number): void {
    const look = personLook(type, seed, env, share);
    posePerson(anim, now, hash01(seed, 3) * Math.PI * 2, look, this.pose);
    _p.set(x, PAVEMENT_Y, -y);
    _q.setFromAxisAngle(_up, yaw);
    _s.setScalar(Math.max(0.01, scale * look.scale));
    _m.compose(_p, _q, _s);
    this.batch.add(_m, look, this.pose);
  }

  dispose(): void {
    this.unsubscribe();
    this.batch.dispose();
  }
}
