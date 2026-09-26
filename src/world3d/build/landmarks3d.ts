// Hero landmark definitions (docs/3d/world.md §2.8, #1–#12, #14–#15), keyed to
// the landmark ids in src/content/landmarks.json and to OSM ids in
// city3d.json. Temple heroes override the generic temple inference (which
// footprint is the viharn / ubosot / chedi, and how each is styled); the
// other heroes are drawn by landmarks.ts and hide the footprints they replace.
// Dimensions marked [est] are art estimates; (unverified) marks shapes whose
// sources disagree.

import type { ChediFinish, ChediType } from './chedi';

export type HallStyleName = 'white' | 'gold' | 'teak' | 'silver' | 'open';
export type Facing = 'east' | 'west' | 'north' | 'south';

export interface TempleHero {
  /** Landmark id in src/content/landmarks.json. */
  id: string;
  /** OSM way id of the temple ground. */
  ground: number;
  /** Street side the viharn faces. */
  front?: Facing;
  viharn?: number;
  viharnStyle?: HallStyleName;
  ubosot?: number;
  ubosotStyle?: HallStyleName;
  chedi?: number;
  /** 'luang' draws the ruined Wat Chedi Luang model. */
  chediModel?: 'luang';
  chediType?: ChediType;
  chediFinish?: ChediFinish;
  /** Base side (m) and height to the tip (m). */
  chediSide?: number;
  chediHeight?: number;
  chediElephants?: number;
  /** Cluster of small white royal chedis (Wat Suan Dok). */
  royalChedis?: boolean;
}

export const TEMPLE_HEROES: TempleHero[] = [
  {
    // #4: ruined brick chedi originally ~82 m; the upper ~30 m fell in 1545 [research: Wikipedia]. Model 55 m on the
    // OSM 58.5 × 57.4 m footprint. Viharn Luang 70.6 × 21.3 m (OSM) with a three-tier roof, facing Phra Pokklao Rd.
    id: 'wat_chedi_luang',
    ground: 243018795,
    front: 'east',
    viharn: 93413944,
    viharnStyle: 'gold',
    chedi: 93413945,
    chediModel: 'luang',
    chediHeight: 55,
  },
  {
    // #5: Viharn Luang faces the west end of Ratchadamnoen; gilded bell chedi ~24 m [est] with elephant foreparts on
    // its base (square vs octagonal base: unverified).
    id: 'wat_phra_singh',
    ground: 93414647,
    front: 'east',
    viharn: 691943359,
    viharnStyle: 'white',
    chedi: 378271855,
    chediType: 'bell',
    chediFinish: 'gold',
    chediSide: 17,
    chediHeight: 26,
    chediElephants: 2,
  },
  {
    // #6: Chedi Chang Lom: square base with 15 elephant front halves, gilded upper part; base ~12 m, ~20 m tall [est].
    id: 'wat_chiang_man',
    ground: 98070869,
    front: 'east',
    viharn: 103845956,
    viharnStyle: 'white',
    chedi: 691933714,
    chediType: 'bell',
    chediFinish: 'white',
    chediSide: 12,
    chediHeight: 20,
    chediElephants: 4,
  },
  {
    // #7: 48 m bell chedi, gold on a white base (finish unverified); open viharn (1932) ≈ 72 × 28 m (OSM); 20–30 white
    // royal chedis in the NW of the ground.
    id: 'wat_suan_dok',
    ground: 322604729,
    front: 'east',
    viharn: 322604682,
    viharnStyle: 'open',
    chedi: 692140725,
    chediType: 'bell',
    chediFinish: 'gold',
    chediHeight: 48,
    royalChedis: true,
  },
  {
    // #8: bare-brick chedi (1527) ~30 m [est], teak viharn (1545); north–south axis facing the moat road.
    id: 'wat_lok_molee',
    ground: 692137164,
    front: 'south',
    viharn: 692137166,
    viharnStyle: 'teak',
    chedi: 692137165,
    chediType: 'redented',
    chediFinish: 'brick',
    chediHeight: 30,
  },
  {
    // #9: all-teak viharn on a stone base with a three-tier roof and gold naga chofa, on Phra Pokklao Rd.
    id: 'wat_phan_tao',
    ground: 243018378,
    front: 'east',
    viharn: 319358316,
    viharnStyle: 'teak',
  },
  {
    // #10: silver ubosot ~20 × 10 m [est] (OSM 19.7 × 10.0 m).
    id: 'wat_sri_suphan',
    ground: 309886989,
    ubosot: 692681076,
    ubosotStyle: 'silver',
  },
];

export type HeroKind = 'gate' | 'bastion' | 'monument' | 'hall' | 'market' | 'bazaar' | 'maya' | 'one_nimman' | 'terminal' | 'boxing';

export interface Hero {
  id: string;
  kind: HeroKind;
  /** Anchor (lat, lon) when the hero sits on a point. */
  at?: [number, number];
  /** City-wall polygons (gates, bastions). */
  walls?: number[];
  /** OSM building ids the hero replaces (hidden from the generic pass). */
  buildings?: number[];
  /** OSM area id the hero is fitted to (markets). */
  area?: number;
  /** Nearest building to the anchor within this radius is replaced. */
  nearest?: number;
  doors?: boolean;
  ruined?: boolean;
  facing?: Facing;
}

export const HEROES: Hero[] = [
  // #1: Tha Phae Gate: wall 5–5.5 m with 0.9 m merlons, a 4.5 × 4.5 m opening with a timber lintel and two weathered
  // grey leaf doors (the only gate with doors); the OSM gate node sits in the gap between the two wall polygons.
  { id: 'tha_phae_gate', kind: 'gate', at: [18.7877625, 98.9932697], walls: [263464174, 263464175], doors: true },
  // #2: the other gates are traffic islands with roads through gaps in the wall; Saen Pung is partly ruined.
  { id: 'chang_phueak_gate', kind: 'gate', walls: [24871597, 97191493] },
  { id: 'suan_dok_gate', kind: 'gate', walls: [323670037, 473546718] },
  { id: 'chiang_mai_gate', kind: 'gate', walls: [330870295, 330870296] },
  { id: 'saen_pung_gate', kind: 'gate', walls: [1211639140, 1211639141], ruined: true },
  // #3: corner bastions, 4.5–6 m, ruined crenellations; their flat tops are left for trees.
  { id: 'si_phum_corner', kind: 'bastion', walls: [263459882], ruined: true },
  { id: 'hua_lin_corner', kind: 'bastion', walls: [317516852], ruined: true },
  { id: 'ku_hueang_corner', kind: 'bastion', walls: [317516851], ruined: true },
  { id: 'katam_corner', kind: 'bastion', walls: [791602197], ruined: true },
  // #11: three life-size bronze kings on a ~2 m plinth in front of the former provincial hall, facing Phra Pokklao Rd.
  { id: 'three_kings', kind: 'monument', at: [18.7902299, 98.9873524], facing: 'east' },
  { id: 'arts_cultural_centre', kind: 'hall', buildings: [17998804] },
  // #12: Warorot (Kad Luang): 3-storey concrete market with a central atrium, fitted to the market area; Ton Lamyai
  // flower market beside the river.
  { id: 'warorot_market', kind: 'market', area: 89039067 },
  { id: 'ton_lamyai', kind: 'market', area: 385577703 },
  // #14: Night Bazaar building on Chang Klan Rd and the Loi Kroh boxing ring under an open roof.
  { id: 'night_bazaar', kind: 'bazaar', at: [18.78478, 99.00046], nearest: 45 },
  { id: 'loi_kroh_boxing', kind: 'boxing', at: [18.78337, 98.99771] },
  // #15: MAYA: ~6-floor cube with a diagonal Lanna-textile lattice façade; One Nimman: red-brick arcades round a
  // courtyard with a ~25 m clock tower [est], fitted to the building nearest its landmark point.
  { id: 'maya', kind: 'maya', buildings: [249154472] },
  { id: 'one_nimman', kind: 'one_nimman', at: [18.80007, 98.96800], nearest: 60 },
  // #16: CNX terminal: long 2-storey hall with a dark Lanna-inspired roof, glazed front, jet bridges on the airside.
  { id: 'cnx_airport', kind: 'terminal', buildings: [58309446] },
];

/** Retail areas whose buildings are covered market lanes (Kalare, Anusarn). */
export const BAZAAR_AREAS = [58560283, 494956275];
