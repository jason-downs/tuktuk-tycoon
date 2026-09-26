// Cosmetic pedestrians on the pavements near the camera. They walk the
// pavement runs baked by build/walkways.ts, turn corners where runs link up,
// dawdle at shopfronts, and thin out or crowd in with the hour and the pull of
// nearby places (markets, the Night Bazaar, the walking streets on Saturday and
// Sunday evenings). Monks walk their alms round in single file at dawn; tourist
// parties walk together. Nothing here touches the simulation. Pure: no three.js.

import { ORIGIN_MIX } from '../content/archetypes';
import { calendar, type CalendarInfo } from '../sim/clock';
import type { Game } from '../sim/game';
import type { Archetype, Place } from '../sim/types';
import { currentWeather } from '../sim/weather';
import { hash01 } from './build/mesh';
import type { LookEnv, PersonType } from './personModels';

/** Kinds of walk run: pavement, the Sunday walking street (Ratchadamnoen), the Saturday one (Wua Lai). */
export const WALK_KIND = { pavement: 0, sunday: 1, saturday: 2 } as const;

/** Prop kinds the walkways builder records (x, y, heading to next vertex, distance to next vertex; 0 ends a run). */
export const WALK_PROPS = ['walk', 'walk_sun', 'walk_sat'] as const;
/** Links between run ends (x = vertex a, y = vertex b in the 'walk' list). */
export const WALK_LINK_PROP = 'walk_link';

const GRID = 48;
/** Cell size (m) of the place index. */
const PLACE_CELL = 250;

/** Pavement runs as a flat vertex list: vertex i joins i+1 when len[i] > 0. */
export class WalkNet {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly len: Float32Array;
  readonly kind: Uint8Array;
  /** Linked run end for a run end vertex, or −1. */
  readonly link: Int32Array;
  private readonly grid = new Map<number, number[]>();

  constructor(runs: { data: Float32Array; kind: number }[], links: Float32Array | undefined) {
    let n = 0;
    for (const r of runs) n += r.data.length / 4;
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.len = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.link = new Int32Array(n).fill(-1);
    let o = 0;
    for (const r of runs) {
      const m = r.data.length / 4;
      for (let i = 0; i < m; i++) {
        this.x[o + i] = r.data[i * 4];
        this.y[o + i] = r.data[i * 4 + 1];
        this.len[o + i] = r.data[i * 4 + 3];
        this.kind[o + i] = r.kind;
      }
      o += m;
    }
    // The last vertex always ends a run.
    if (n) this.len[n - 1] = 0;
    if (links) {
      for (let i = 0; i + 3 < links.length; i += 4) {
        const a = links[i];
        const b = links[i + 1];
        if (a >= 0 && b >= 0 && a < n && b < n) {
          this.link[a] = b;
          this.link[b] = a;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.len[i] <= 0) continue;
      const key = cellKey((this.x[i] + this.x[i + 1]) / 2, (this.y[i] + this.y[i + 1]) / 2);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
  }

  /** Build from the static city's props, or null when the build recorded no walks. */
  static fromProps(props: Record<string, Float32Array>): WalkNet | null {
    const runs = WALK_PROPS.map((k, kind) => ({ data: props[k] ?? new Float32Array(0), kind })).filter((r) => r.data.length);
    if (!runs.length) return null;
    return new WalkNet(runs, props[WALK_LINK_PROP]);
  }

  /** Is vertex i the first of its run? */
  isStart(i: number): boolean {
    return i === 0 || this.len[i - 1] <= 0;
  }

  /** Segment start vertices whose midpoint lies within r of (x, y). */
  segmentsNear(x: number, y: number, r: number, out: number[]): number[] {
    out.length = 0;
    const c0x = Math.floor((x - r) / GRID);
    const c1x = Math.floor((x + r) / GRID);
    const c0y = Math.floor((y - r) / GRID);
    const c1y = Math.floor((y + r) / GRID);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const list = this.grid.get((cx + 10_000) * 100_000 + (cy + 10_000));
        if (!list) continue;
        for (const i of list) {
          const mx = (this.x[i] + this.x[i + 1]) / 2 - x;
          const my = (this.y[i] + this.y[i + 1]) / 2 - y;
          if (mx * mx + my * my <= r2) out.push(i);
        }
      }
    }
    return out;
  }
}

function cellKey(x: number, y: number): number {
  return (Math.floor(x / GRID) + 10_000) * 100_000 + (Math.floor(y / GRID) + 10_000);
}

export interface Walker {
  id: number;
  type: PersonType;
  /** Look seed, and a shared colour seed for a party (or undefined). */
  seed: number;
  share: number | undefined;
  /** Segment start vertex, metres along it, direction (+1 towards v+1). */
  v: number;
  t: number;
  dir: 1 | -1;
  /** Sideways offset (m) from the run line, positive to the run's left. */
  lat: number;
  speed: number;
  /** Seconds left standing still. */
  pause: number;
  /** Metres walked (for the gait phase) and until the next dawdle. */
  dist: number;
  nextPause: number;
  run: boolean;
  alms: boolean;
  /** Group leader and place in the group (0 = leader or alone). */
  leader: Walker | null;
  slot: number;
  /** Spacing and sideways offset behind the leader. */
  gap: number;
  /** Recent positions (x, y pairs, newest last), kept by leaders for their followers. */
  trail: number[];
  /** 0 → 1 as the walker fades in; dying walkers fade out and are removed. */
  fade: number;
  dying: boolean;
  x: number;
  y: number;
  yaw: number;
  moving: boolean;
  /** On a walking-street aisle, i.e. on the closed street's carriageway. */
  street: boolean;
}

export interface CrowdFrame {
  /** Camera target (sim metres). */
  x: number;
  y: number;
  /** Radius (m) people are kept within. */
  radius: number;
  /** Most walkers to show. */
  cap: number;
  cal: CalendarInfo;
  /** Demand pull of a place right now (e.g. the ride-origin weight). */
  activity(place: Place): number;
  /** Walking seconds to advance (0 while paused). */
  walkDt: number;
  /** Real seconds since the last frame (fades). */
  realDt: number;
}

/** [est] Pedestrians per metre of pavement by hour, before the pull of places. */
const HOUR_BASE = [0.04, 0.03, 0.02, 0.02, 0.03, 0.08, 0.2, 0.3, 0.35, 0.35, 0.4, 0.45, 0.45, 0.42, 0.4, 0.42, 0.5, 0.6, 0.7, 0.7, 0.65, 0.5, 0.35, 0.15];
/** Pavement metres × density per walker at the target count. */
const PER_WALKER = 140;
/** Places whose crowds spread far along their streets (m). */
const WIDE_PLACES: Record<string, number> = {
  sunday_walking_street: 420,
  saturday_walking_street: 380,
  night_bazaar: 380,
  anusarn_market: 200,
  kalare_night_bazaar: 200,
  warorot_market: 260,
  tha_phae_gate: 220,
};

const inHours = (h: number, a: number, b: number) => h >= a && h < b;

/** Is a walking-street run open (stalls out, traffic off) at this time? */
export function walkingStreetOpen(kind: number, cal: CalendarInfo): boolean {
  if (kind === WALK_KIND.sunday) return cal.weekday === 0 && inHours(cal.hour, 16, 23);
  if (kind === WALK_KIND.saturday) return cal.weekday === 6 && inHours(cal.hour, 17, 23);
  return true;
}

/** Monks walk their alms round in the early morning (docs/3d/world.md §3.2). */
export function isAlmsTime(cal: CalendarInfo): boolean {
  return inHours(cal.hour, 5.5, 7.3);
}

/** What the season and weather make people wear or carry right now. */
export function lookEnvAt(game: Game): LookEnv {
  const cal = calendar(game.state.time);
  const w = currentWeather(game);
  return { cool: cal.month >= 10 || cal.month === 0, rain: w.sky === 'rain' || w.sky === 'storm', haze: w.haze > 0, dawn: isAlmsTime(cal) };
}

export class CrowdSim {
  readonly walkers: Walker[] = [];
  private readonly net: WalkNet;
  private readonly places: Place[];
  private readonly placeGrid = new Map<number, number[]>();
  private nextId = 1;
  private n = 0;
  // Spawn candidates near the camera: segment ids, cumulative weights, nearest temple flags.
  private cand: number[] = [];
  private candW: number[] = [];
  private candTemple: boolean[] = [];
  private candTotal = 0;
  private candCat: (string | null)[] = [];
  private candAt = { x: NaN, y: NaN, r: 0, hour: -1, day: -1 };

  constructor(net: WalkNet, places: Place[], seed = 1) {
    this.net = net;
    this.places = places;
    this.n = seed * 104_729;
    for (const p of places) {
      const key = (Math.floor(p.x / PLACE_CELL) + 10_000) * 100_000 + (Math.floor(p.y / PLACE_CELL) + 10_000);
      let list = this.placeGrid.get(key);
      if (!list) this.placeGrid.set(key, (list = []));
      list.push(p.idx);
    }
  }

  private rand(salt: number): number {
    return hash01(this.n++, salt);
  }

  /** Walker count the current candidates call for (before the cap). */
  demand(): number {
    return this.candTotal / PER_WALKER;
  }

  update(f: CrowdFrame): void {
    this.refreshCandidates(f);
    const target = Math.min(f.cap, Math.round(this.demand()));
    const keep = f.radius * 1.2;
    let alive = 0;
    for (const w of this.walkers) {
      if (w.dying) continue;
      const lead = w.leader;
      const gone = lead ? lead.dying : Math.hypot(w.x - f.x, w.y - f.y) > keep || !walkingStreetOpen(this.net.kind[w.v], f.cal);
      if (gone) w.dying = true;
      else alive++;
    }
    // Too many: fade out the farthest leaders (their groups go with them).
    if (alive > target + 6) {
      const leaders = this.walkers.filter((w) => !w.dying && !w.leader).sort((a, b) => Math.hypot(b.x - f.x, b.y - f.y) - Math.hypot(a.x - f.x, a.y - f.y));
      for (let k = 0; k < leaders.length && alive > target; k++) {
        const w = leaders[k];
        w.dying = true;
        alive -= 1 + this.walkers.filter((o) => o.leader === w).length;
      }
    }
    for (let k = 0; k < 6 && alive < target && this.candTotal > 0; k++) alive += this.spawn(f, target - alive);
    for (const w of this.walkers) if (!w.leader) this.moveLeader(w, f);
    for (const w of this.walkers) if (w.leader) this.placeFollower(w);
    for (const w of this.walkers) w.fade = w.dying ? w.fade - f.realDt / 0.6 : Math.min(1, w.fade + f.realDt / 0.6);
    for (let i = this.walkers.length - 1; i >= 0; i--) if (this.walkers[i].dying && this.walkers[i].fade <= 0) this.walkers.splice(i, 1);
  }

  // ----------------------------------------------------------- density

  private refreshCandidates(f: CrowdFrame): void {
    const at = this.candAt;
    const hour = Math.floor(f.cal.hour * 4) / 4;
    if (Math.hypot(f.x - at.x, f.y - at.y) < 30 && Math.abs(f.radius - at.r) < at.r * 0.15 && hour === at.hour && f.cal.day === at.day) return;
    this.candAt = { x: f.x, y: f.y, r: f.radius, hour, day: f.cal.day };
    const net = this.net;
    const segs = net.segmentsNear(f.x, f.y, f.radius, []).filter((i) => walkingStreetOpen(net.kind[i], f.cal));
    const slot = new Map<number, number>();
    segs.forEach((seg, j) => slot.set(seg, j));
    const pull = new Float32Array(segs.length);
    const bestPull = new Float32Array(segs.length).fill(0.05);
    const cats: (string | null)[] = new Array(segs.length).fill(null);
    const temple: boolean[] = new Array(segs.length).fill(false);
    // Spread each nearby place's pull over the pavement around it.
    const reach = f.radius + 2.2 * 420;
    const c0x = Math.floor((f.x - reach) / PLACE_CELL);
    const c1x = Math.floor((f.x + reach) / PLACE_CELL);
    const c0y = Math.floor((f.y - reach) / PLACE_CELL);
    const c1y = Math.floor((f.y + reach) / PLACE_CELL);
    const near: number[] = [];
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (const idx of this.placeGrid.get((cx + 10_000) * 100_000 + (cy + 10_000)) ?? []) {
          const p = this.places[idx];
          const R = WIDE_PLACES[p.id] ?? (p.landmark ? 160 : 70);
          if (Math.hypot(p.x - f.x, p.y - f.y) > f.radius + 2.2 * R) continue;
          if (p.cat === 'temple') {
            for (const seg of net.segmentsNear(p.x, p.y, 300, near)) {
              const j = slot.get(seg);
              if (j !== undefined) temple[j] = true;
            }
          }
          const a = Math.min(40, Math.max(0, f.activity(p)));
          if (a <= 0) continue;
          for (const seg of net.segmentsNear(p.x, p.y, 2.2 * R, near)) {
            const j = slot.get(seg);
            if (j === undefined) continue;
            const d = Math.hypot((net.x[seg] + net.x[seg + 1]) / 2 - p.x, (net.y[seg] + net.y[seg + 1]) / 2 - p.y);
            const k = (a / 8) * Math.exp(-((d / R) ** 2)) * 0.5;
            pull[j] += k;
            if (k > bestPull[j]) {
              bestPull[j] = k;
              cats[j] = p.cat;
            }
          }
        }
      }
    }
    const base = HOUR_BASE[Math.floor(f.cal.hour) % 24];
    this.cand = segs;
    this.candW = new Array(segs.length);
    this.candTemple = temple;
    this.candCat = cats;
    let total = 0;
    for (let j = 0; j < segs.length; j++) {
      const i = segs[j];
      total += net.len[i] * ((net.kind[i] === WALK_KIND.pavement ? 0 : 2.5) + base + pull[j]);
      this.candW[j] = total;
    }
    this.candTotal = total;
  }

  private pickCandidate(filter?: (k: number) => boolean): number {
    if (!this.cand.length) return -1;
    for (let tries = 0; tries < 12; tries++) {
      const r = this.rand(11) * this.candTotal;
      let lo = 0;
      let hi = this.candW.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.candW[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      if (!filter || filter(lo)) return lo;
    }
    return -1;
  }

  // ------------------------------------------------------------ spawning

  private chooseType(k: number, f: CrowdFrame): PersonType {
    const cal = f.cal;
    const h = cal.hour;
    const weekday = cal.weekday >= 1 && cal.weekday <= 5;
    const kind = this.net.kind[this.cand[k]];
    const cat = this.candCat[k];
    if (kind !== WALK_KIND.pavement || (cat && this.rand(12) < 0.5)) {
      const mix = ORIGIN_MIX[(kind !== WALK_KIND.pavement ? 'attraction' : cat) as keyof typeof ORIGIN_MIX] ?? {};
      const keys = Object.keys(mix) as Archetype[];
      if (keys.length) {
        let total = 0;
        for (const a of keys) total += mix[a] ?? 0;
        let r = this.rand(13) * total;
        for (const a of keys) {
          r -= mix[a] ?? 0;
          if (r < 0) return a;
        }
      }
    }
    const opts: [PersonType, number][] = [
      ['local', 6],
      ['office', weekday && (inHours(h, 7, 9.5) || inHours(h, 16.5, 19)) ? 3 : 0.6],
      ['schoolkid', weekday && (inHours(h, 6.5, 8) || inHours(h, 15, 17)) ? 2.5 : 0.15],
      ['jogger', inHours(h, 5.5, 8.5) || inHours(h, 17, 19.5) ? 1.2 : 0.08],
      ['monk', inHours(h, 5, 11) ? 0.5 : 0.15],
      ['nun', 0.08],
      ['elder', 0.8],
      ['vendor', inHours(h, 4, 10) ? 1 : 0.3],
      ['backpacker', 0.6],
      ['tourist_west', 0.6],
    ];
    let total = 0;
    for (const [, w] of opts) total += w;
    let r = this.rand(14) * total;
    for (const [t, w] of opts) {
      r -= w;
      if (r < 0) return t;
    }
    return 'local';
  }

  private newWalker(type: PersonType, v: number, t: number, dir: 1 | -1, speed: number): Walker {
    return {
      id: this.nextId++,
      type,
      seed: Math.floor(this.rand(15) * 1e9),
      share: undefined,
      v,
      t,
      dir,
      lat: (this.rand(16) - 0.5) * 0.7,
      speed,
      pause: 0,
      dist: this.rand(17) * 10,
      nextPause: 15 + this.rand(18) * 60,
      run: type === 'jogger',
      alms: false,
      leader: null,
      slot: 0,
      gap: 0,
      trail: [],
      fade: 0,
      dying: false,
      x: 0,
      y: 0,
      yaw: 0,
      moving: true,
      street: this.net.kind[v] !== WALK_KIND.pavement,
    };
  }

  /** Spawn a walker (or a group) at a weighted pavement spot. Returns how many people were added. */
  private spawn(f: CrowdFrame, room: number): number {
    const net = this.net;
    const monks = isAlmsTime(f.cal) && this.walkers.filter((w) => w.alms && !w.leader && !w.dying).length < 2 && this.rand(19) < 0.35;
    const k = this.pickCandidate(monks ? (c) => this.candTemple[c] : undefined);
    if (k < 0) return 0;
    const v = this.cand[k];
    const t = this.rand(20) * net.len[v];
    const dir: 1 | -1 = this.rand(21) < 0.5 ? 1 : -1;
    const type = monks ? 'monk' : this.chooseType(k, f);
    const tourist = type === 'tourist_cn' || type === 'tourist_kr' || type === 'tourist_west' || type === 'thai_tourist' || type === 'backpacker';
    const size = monks ? 3 + Math.floor(this.rand(22) * 4) : tourist && this.rand(23) < 0.4 ? 2 + Math.floor(this.rand(24) * 3) : 1;
    const n = Math.min(size, Math.max(1, room));
    const base = type === 'jogger' ? 2.6 : type === 'monk' || type === 'nun' ? 0.85 : type === 'elder' ? 0.8 : 1.15 + this.rand(25) * 0.35;
    const lead = this.newWalker(type, v, t, dir, monks ? 0.75 : base);
    lead.alms = monks;
    if (n > 1) lead.share = Math.floor(this.rand(26) * 1e9);
    if (monks) lead.lat = 0;
    this.place(lead);
    this.walkers.push(lead);
    for (let s = 1; s < n; s++) {
      const w = this.newWalker(type, v, t, dir, lead.speed);
      w.leader = lead;
      w.slot = s;
      w.share = lead.share;
      w.alms = monks;
      w.gap = monks ? 1.5 : 0.9;
      w.lat = monks ? 0 : s % 2 ? 0.45 : -0.45;
      w.x = lead.x;
      w.y = lead.y;
      w.yaw = lead.yaw;
      this.walkers.push(w);
    }
    return n;
  }

  // ------------------------------------------------------------- walking

  /** Enter a linked run end: walk away from it along its run. */
  private enter(w: Walker, end: number): void {
    const net = this.net;
    if (net.len[end] > 0) {
      w.v = end;
      w.t = 0;
      w.dir = 1;
    } else {
      w.v = end - 1;
      w.t = net.len[end - 1];
      w.dir = -1;
    }
  }

  private advance(w: Walker, d: number): void {
    const net = this.net;
    for (let guard = 0; d > 1e-6 && guard < 32; guard++) {
      const L = net.len[w.v];
      if (w.dir > 0) {
        const rem = L - w.t;
        if (d < rem) {
          w.t += d;
          return;
        }
        d -= rem;
        const nv = w.v + 1;
        if (net.len[nv] > 0) {
          w.v = nv;
          w.t = 0;
          continue;
        }
        const lk = net.link[nv];
        if (lk >= 0 && this.rand(27) < 0.85) this.enter(w, lk);
        else {
          w.t = L;
          w.dir = -1;
        }
      } else {
        if (d < w.t) {
          w.t -= d;
          return;
        }
        d -= w.t;
        if (!net.isStart(w.v)) {
          w.v -= 1;
          w.t = net.len[w.v];
          continue;
        }
        const lk = net.link[w.v];
        if (lk >= 0 && this.rand(28) < 0.85) this.enter(w, lk);
        else {
          w.t = 0;
          w.dir = 1;
        }
      }
    }
  }

  /** Position and heading from the walker's place on its segment. */
  private place(w: Walker): void {
    const net = this.net;
    const i = w.v;
    const L = net.len[i] || 1;
    const dx = net.x[i + 1] - net.x[i];
    const dy = net.y[i + 1] - net.y[i];
    const u = w.t / L;
    const nx = -dy / L;
    const ny = dx / L;
    w.x = net.x[i] + dx * u + nx * w.lat;
    w.y = net.y[i] + dy * u + ny * w.lat;
    w.yaw = Math.atan2(dy, dx) + (w.dir < 0 ? Math.PI : 0);
  }

  private moveLeader(w: Walker, f: CrowdFrame): void {
    w.moving = false;
    if (w.pause > 0) {
      w.pause -= f.walkDt;
    } else if (f.walkDt > 0) {
      const step = w.speed * f.walkDt;
      this.advance(w, step);
      w.dist += step;
      w.moving = true;
      if (!w.run && !w.alms && w.dist > w.nextPause) {
        w.pause = 2 + this.rand(29) * 6;
        w.nextPause = w.dist + 20 + this.rand(30) * 70;
      }
    }
    this.place(w);
    if (w.share !== undefined || w.alms) {
      const tr = w.trail;
      const lx = tr.length ? tr[tr.length - 2] : NaN;
      const ly = tr.length ? tr[tr.length - 1] : NaN;
      if (!tr.length || Math.hypot(w.x - lx, w.y - ly) > 0.3) {
        tr.push(w.x, w.y);
        if (tr.length > 80) tr.splice(0, tr.length - 80);
      }
    }
  }

  /** Followers walk the leader's trail, `slot × gap` metres behind, a little to one side. */
  private placeFollower(w: Walker): void {
    const lead = w.leader!;
    const tr = lead.trail;
    let back = w.slot * w.gap;
    let px = lead.x;
    let py = lead.y;
    let hx = Math.cos(lead.yaw);
    let hy = Math.sin(lead.yaw);
    for (let i = tr.length - 2; i >= 0 && back > 0; i -= 2) {
      const qx = tr[i];
      const qy = tr[i + 1];
      const seg = Math.hypot(px - qx, py - qy);
      if (seg < 1e-6) continue;
      hx = (px - qx) / seg;
      hy = (py - qy) / seg;
      if (seg >= back) {
        px -= hx * back;
        py -= hy * back;
        back = 0;
        break;
      }
      back -= seg;
      px = qx;
      py = qy;
    }
    if (back > 0) {
      px -= hx * back;
      py -= hy * back;
    }
    const nx = -hy;
    const ny = hx;
    const moved = Math.hypot(px + nx * w.lat - w.x, py + ny * w.lat - w.y);
    w.x = px + nx * w.lat;
    w.y = py + ny * w.lat;
    w.yaw = Math.atan2(hy, hx);
    w.moving = lead.moving;
    if (w.moving) w.dist += Math.min(moved, lead.speed * 0.5);
  }
}
