// Passenger dialogue. requestLine() writes what a passenger says when they hail
// you, fitted to the real trip: the destination's name and kind, the origin, the
// hour, the season and who is speaking. The hand-written lines of
// docs/research/culture.md §11a that name a place are used only when the trip
// goes there. haggleLine() gives each archetype its own way of accepting,
// countering and walking off. Thai (Central) and Kham Mueang (Northern Thai)
// words follow culture.md §5; GLOSSARY holds the short translations the UI shows
// on hover.
//
// Narration (a monk does not haggle or chat) is written between asterisks:
// isNarration() marks it so the UI shows it as italic prose, without quotes.

import { BALANCE, streetFare } from '../sim/balance';
import { calendar, isWeekdayRush, type CalendarInfo } from '../sim/clock';
import type { Game } from '../sim/game';
import type { Archetype, Place, PlaceCategory, RideRequest } from '../sim/types';
import { ZONES } from './zones';

// ------------------------------------------------------------------ speakers
/** How a passenger talks: English, Mandarin or Korean greeting, Central Thai, Kham Mueang, or monk narration. */
export type Voice = 'en' | 'zh' | 'ko' | 'th' | 'north' | 'monk';

export const VOICE: Record<Archetype, Voice> = {
  backpacker: 'en',
  tourist_cn: 'zh',
  tourist_kr: 'ko',
  tourist_west: 'en',
  retiree: 'en',
  nomad: 'en',
  thai_tourist: 'th',
  student: 'th',
  // [research] culture.md §4: vendors and elders are the natural Kham Mueang speakers.
  vendor: 'north',
  elder: 'north',
  monk: 'monk',
  business: 'en',
};

/** [pacing] Share of women among each archetype's riders (monks are men). */
const FEMALE_SHARE: Record<Archetype, number> = {
  backpacker: 0.5,
  tourist_cn: 0.55,
  tourist_kr: 0.6,
  tourist_west: 0.5,
  retiree: 0.35,
  nomad: 0.45,
  thai_tourist: 0.55,
  student: 0.55,
  vendor: 0.75,
  elder: 0.6,
  monk: 0,
  business: 0.35,
};

const ANY: readonly Voice[] = ['en', 'zh', 'ko', 'th', 'north'];
const FOREIGN: readonly Voice[] = ['en', 'zh', 'ko'];
const THAI: readonly Voice[] = ['th', 'north'];
const MONK: readonly Voice[] = ['monk'];

/** Stable 0–1 hash, so a request's speaker keeps one gender from hail to haggle. */
function unitHash(a: number, b: number, c: number): number {
  let h = 0x811c9dc5;
  for (const v of [a, b, c]) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4_294_967_296;
}

/** Whether the rider of a request is a woman (decides khrap / kha / jao). */
export function speakerIsFemale(arch: Archetype, spawnedAt: number, from: number, to: number): boolean {
  return unitHash(Math.floor(spawnedAt), from, to) < FEMALE_SHARE[arch];
}

// ------------------------------------------------------------------ places
/** A destination's kind: its category, with transport and places of worship split further. */
export type DestKind = PlaceCategory | 'airport' | 'bus' | 'train' | 'worship';

/** Buddhist temples ("wat"); the temple category also holds churches, mosques and shrines. */
function isWat(p: Place): boolean {
  return p.landmark || /^wat\b/i.test(p.name) || !!p.th?.startsWith('วัด');
}

export function destKind(p: Place): DestKind {
  if (p.cat === 'transport') {
    if (p.id === 'cnx_airport' || /airport/i.test(p.name)) return 'airport';
    if (p.id === 'railway_station' || /railway|train/i.test(p.name)) return 'train';
    if (/bus|arcade|terminal|nakhonchai/i.test(p.name)) return 'bus';
    return 'train';
  }
  if (p.cat === 'temple') return isWat(p) ? 'temple' : 'worship';
  return p.cat;
}

/** How a passenger says a landmark whose map name reads badly aloud. */
const SPOKEN: Record<string, string> = {
  cnx_airport: 'the airport',
  railway_station: 'the railway station',
  arcade_2: 'Arcade bus station',
  arcade_3: 'Arcade bus station',
  chang_phueak_bus: 'Chang Phueak bus station',
  cmu_main_gate: 'the CMU front gate',
  cmu_rajabhat: 'Rajabhat University',
  moon_muang_soi_7: 'Moon Muang Soi 7',
  nimman_soi_7_9: 'Nimman Soi 9',
  loi_kroh_bars: 'Loi Kroh Road',
  zoe_in_yellow: 'Zoe in Yellow',
  lang_mor_market: 'Lang Mor market',
  ton_lamyai: 'Ton Lamyai market',
  night_bazaar: 'the Night Bazaar',
  central_airport: 'Central Airport mall',
  central_festival: 'Central Festival',
  maya: 'Maya mall',
  iron_bridge: 'the Iron Bridge',
  three_kings: 'the Three Kings Monument',
  the_riverside: 'The Riverside',
  wat_doi_suthep: 'Wat Phra That Doi Suthep',
  arts_cultural_centre: 'the Arts & Cultural Centre',
};

/** A place's name as a passenger would say it. */
export function spokenName(p: Place): string {
  const special = SPOKEN[p.id];
  if (special) return special;
  const first = p.name.split(';')[0];
  const plain = first.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return plain || p.name;
}

// [research] culture.md §2 anchors (OSM): Wat Chedi Liam for Nong Hoi, Wat Fa Ham for Fa Ham.
const NONG_HOI = { lat: 18.75375, lon: 98.99573 };
const FA_HAM = { lat: 18.80438, lon: 99.00491 };

// ------------------------------------------------------------------ context
interface Ctx {
  game: Game;
  from: Place;
  to: Place;
  arch: Archetype;
  voice: Voice;
  female: boolean;
  cal: CalendarInfo;
  kind: DestKind;
  originKind: DestKind;
  /** Straight-line distance, metres. */
  metres: number;
  /** Fare for haggle lines, THB. */
  fare: number;
}

const inHours = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);

/** [research] calendar.md §2: cool Nov–Feb, hot Mar–May, rains May–Oct. */
const coolSeason = (c: Ctx) => c.cal.month >= 10 || c.cal.month <= 1;
const hotSeason = (c: Ctx) => c.cal.month >= 2 && c.cal.month <= 4;
const rainySeason = (c: Ctx) => c.cal.month >= 4 && c.cal.month <= 9;

/** [research] calendar.md §4: Yi Peng city programme 23–25 Nov 2026; 2027 brackets the 13 Nov full moon. */
const YI_PENG: Record<number, [number, number]> = { 2026: [23, 25], 2027: [12, 14] };
const yiPeng = (c: Ctx) => {
  const r = YI_PENG[c.cal.year];
  return !!r && c.cal.month === 10 && c.cal.date >= r[0] && c.cal.date <= r[1];
};
/** [research] calendar.md §4: Songkran, the traditional days 13–15 April. */
const songkran = (c: Ctx) => c.cal.month === 3 && c.cal.date >= 13 && c.cal.date <= 15;
/** The weekday rush hours that slow the traffic (isWeekdayRush, calendar.md §8). */
const rushHour = (c: Ctx) => isWeekdayRush(c.cal);

const toIs = (...ids: string[]) => (c: Ctx) => ids.includes(c.to.id);
const khaoSoi = (c: Ctx) => /khao ?soi/i.test(c.to.name);

function nearLatLon(c: Ctx, p: Place, at: { lat: number; lon: number }, radius: number): boolean {
  const [x, y] = c.game.world.graph.projection.toXY(at.lon, at.lat);
  return Math.hypot(p.x - x, p.y - y) <= radius;
}

function nearLandmark(c: Ctx, p: Place, id: string, radius: number): boolean {
  const l = c.game.world.landmarks.find((q) => q.id === id);
  return !!l && Math.hypot(p.x - l.x, p.y - l.y) <= radius;
}

function inZone(c: Ctx, p: Place, zoneId: string): boolean {
  const z = ZONES.find((q) => q.id === zoneId);
  return !!z && nearLatLon(c, p, z, z.radius);
}

// ------------------------------------------------------------------ lines
interface Line {
  text: string;
  /** Who may say it; defaults to every voice except monk narration. */
  voices?: readonly Voice[];
  arch?: readonly Archetype[];
  /** Hour window [from, to), wrapping past midnight. */
  hours?: readonly [number, number];
  when?: (c: Ctx) => boolean;
  weight?: number;
}

/**
 * Lines that name a particular place. Each is used only when the trip goes
 * there. Most are culture.md §11a lines (numbered); the rest name the place
 * through {Dest} or draw on the cited notes.
 */
const PLACE_LINES: Line[] = [
  // §11a #1 — a short hop to the gate, where eighty is already a tourist price.
  { text: '{sawatdee}! Tha Phae Gate — how much? Eighty? Paeng bpai… sixty?', arch: ['backpacker'], when: (c) => c.to.id === 'tha_phae_gate' && c.metres < 1_600 },
  // §11a #2
  {
    text: 'Our hostel’s on a Moon Muang soi. The map says it’s one-way the wrong way — is that why you’re going round the whole moat?',
    arch: ['backpacker'],
    when: (c) => c.to.id === 'moon_muang_soi_7' || (c.to.cat === 'hostel' && nearLandmark(c, c.to, 'moon_muang_soi_7', 350)),
  },
  // §11a #3, §9 (the gem scam starts with "the temple is closed").
  { text: 'A guy at the gate said Wat Phra Singh is closed today and a ride to a gem shop is free. That’s… a scam, right?', arch: ['backpacker', 'tourist_west'], when: toIs('wat_phra_singh') },
  // §11a #4; calendar.md §5: Ratchadamnoen Rd is closed to traffic ~16:00–23:00.
  { text: 'Sunday Walking Street, please — as close as you can get before the barriers.', voices: ANY, when: toIs('sunday_walking_street') },
  // culture.md §2: Wua Lai is the silversmiths' street.
  { text: 'Saturday Walking Street, please. I want to see the silversmiths on Wua Lai.', voices: ANY, when: toIs('saturday_walking_street') },
  // §11a #33
  { text: 'Loi Kroh Road, please — we’ve got one night left!', arch: ['backpacker', 'tourist_west'], when: toIs('loi_kroh_bars') },
  // §11a #5, #7 (Lost in Thailand was filmed at CMU and Warorot).
  { text: 'Nǐ hǎo! Chiang Mai University — the one from the film. Can we still go in and look around?', arch: ['tourist_cn'], when: toIs('cmu_main_gate') },
  { text: 'Warorot Market — where they filmed the market chase!', arch: ['tourist_cn'], when: toIs('warorot_market') },
  // §11a #8
  { text: 'Annyeong-haseyo! One Nimman, please. We’re staying the whole month this time.', arch: ['tourist_kr'], when: toIs('one_nimman') },
  // §11a #10 (Wat Ket, the old riverside expat quarter, §2).
  { text: 'Morning, phi. Same as every Tuesday: over the river to Wat Ket.', arch: ['retiree'], hours: [6, 11], when: (c) => c.cal.weekday === 2 && /\bwat ket\b/i.test(c.to.name) },
  // §11a #11
  { text: 'Take the river road to {dest}, would you? No rush. Jai yen yen.', arch: ['retiree'], when: (c) => inZone(c, c.to, 'riverside') },
  // §11a #13, for a café in the Nimman café district.
  {
    text: '{Dest}, the café with the good wifi. My call starts in twelve minutes — kha jai, please!',
    arch: ['nomad'],
    when: (c) => c.to.cat === 'cafe' && nearLandmark(c, c.to, 'nimman_soi_7_9', 700),
  },
  // §11a #16
  { text: 'Phi {p}, bpai Doi Suthep dai mai? Can this tuk-tuk actually make the climb?', arch: ['thai_tourist'], when: toIs('wat_doi_suthep') },
  // §11a #17, in the cool season.
  { text: 'We drove up from Bangkok for the cold. Is the khao soi at {dest} lam khanat?', arch: ['thai_tourist'], when: (c) => khaoSoi(c) && coolSeason(c) },
  // Western tourist line from culture.md §11a, kept to a khao soi shop.
  { text: 'Take us somewhere for khao soi — {dest}? We’re in your hands!', arch: ['tourist_west', 'backpacker'], when: khaoSoi },
  { text: '{Dest}, please. Everyone says the khao soi there is lam khanat.', voices: ANY, when: khaoSoi, weight: 3 },
  // §11a #19, #20, #21
  { text: 'Phi, CMU front gate — go by Huay Kaew, mai pen rai if it’s slow.', arch: ['student'], when: toIs('cmu_main_gate') },
  { text: 'Lang Mor night market, phi. Student price, na?', arch: ['student'], when: toIs('lang_mor_market') },
  { text: 'Exam at eight at {dest} and I overslept! Ja pai phang… no, wait — do rush!', arch: ['student'], hours: [6, 8], when: (c) => c.kind === 'university' },
  // §11a #22 (Kad Luang = Warorot; Ton Lamyai flower market is next door).
  { text: '{sawatdee}! Kad Luang, {p}. Mind the flower baskets, they’re for Ton Lamyai.', arch: ['vendor'], when: toIs('warorot_market') },
  // culture.md §7: blue songthaews to Lamphun leave from Warorot; yellow ones to Mae Rim from Chang Phueak terminal.
  { text: 'Warorot, {p}. The blue songthaew home to Lamphun leaves from there.', voices: ['north'], when: toIs('warorot_market') },
  { text: '{Dest}, {p}. My yellow songthaew home to Mae Rim leaves from there.', voices: THAI, when: toIs('chang_phueak_bus') },
  // §11a #24, the rain half only in the rainy season.
  { text: 'Pik ban, {p} — back to Nong Hoi before the rain.', arch: ['vendor', 'elder'], when: (c) => rainySeason(c) && nearLatLon(c, c.to, NONG_HOI, 1_200) },
  { text: 'Pik ban, {p} — back home to Nong Hoi.', arch: ['vendor', 'elder'], when: (c) => !rainySeason(c) && nearLatLon(c, c.to, NONG_HOI, 1_200) },
  // §11a #28; culture.md §2 (Fa Ham row): Khao Soi Lam Duan Fa Ham opens 08:00–16:00.
  {
    text: 'Ai, kin khao laew ka? No? Then take me to Fa Ham and I’ll show you real khao soi.',
    arch: ['elder'],
    hours: [8, 15],
    when: (c) => nearLatLon(c, c.to, FA_HAM, 700) || /fa ham/i.test(c.to.name),
  },
  // Business traveller line from culture.md §11a.
  { text: 'Central Festival, the convention hall. I’m late.', arch: ['business'], when: toIs('central_festival') },
  // landmarks.md: fights start at 21:00 — Thapae Boxing Mon–Sat, Loi Kroh Mon/Wed/Fri.
  {
    text: '{Dest}, please! Muay Thai tonight — ringside if we can get it.',
    voices: FOREIGN,
    hours: [19, 21.5],
    when: (c) =>
      (c.to.id === 'thapae_boxing' && c.cal.weekday >= 1 && c.cal.weekday <= 6) ||
      (c.to.id === 'loi_kroh_boxing' && [1, 3, 5].includes(c.cal.weekday)),
  },
  // calendar.md §4: Yi Peng crowd sites — krathong floating between Nawarat Bridge and the Iron Bridge,
  // lantern displays at Tha Phae Gate (18:30–22:30), temples hung with lanterns (culture.md §10 khom khwaen).
  { text: 'It’s Yi Peng! {Dest}, please — we want to float our krathong on the Ping.', voices: ANY, hours: [17, 23], when: (c) => yiPeng(c) && toIs('iron_bridge', 'nawarat_bridge')(c) },
  { text: 'Yi Peng tonight! {Dest}, please — they say the lantern displays are beautiful.', voices: ANY, hours: [17, 23], when: (c) => yiPeng(c) && toIs('tha_phae_gate')(c) },
  {
    text: 'Yi Peng tonight — {dest}, please. I want to see the temple hung with lanterns.',
    voices: ANY,
    hours: [17, 23],
    when: (c) => yiPeng(c) && toIs('wat_phan_tao', 'wat_chedi_luang', 'wat_phra_singh', 'wat_lok_molee')(c),
  },
  // §11a #31: Songkran water fights on the moat roads.
  { text: 'Songkran! {Dest}, please — and pull the rain curtains down, they’ve got buckets by the moat!', voices: ANY, hours: [9, 20], when: songkran, weight: 4 },
];

/** Lines for any destination of a kind. */
const KIND_LINES: Partial<Record<DestKind, Line[]>> = {
  temple: [
    // culture.md §4 etiquette: long trousers, covered arms, shoes off.
    { text: '{hello} {Dest}, please. Long trousers, shoulders covered — that’s the rule, right?', voices: FOREIGN },
    { text: '{hello} {Dest}, please. Do I take my shoes off at the door?', voices: FOREIGN },
    { text: '{hello} {Dest}, please — I want photos before the sun gets too high.', voices: FOREIGN, hours: [6, 10] },
    { text: '{hello} Bpai {dest} dai mai, {phi}? We’re going to tham bun.', voices: ['th'] },
    { text: '{hello} Pai song ti {dest} dai ko {p}?', voices: ['north'] },
    // culture.md §4 alms round ~05:30–07:00; §8 sticky rice is the usual offering.
    { text: '{hello} Pai song ti {dest} dai ko {p}? I’m taking sticky rice for the monks.', voices: ['north'], hours: [5, 9] },
    { text: '*A monk back from his alms round, his bowl full of sticky rice, is returning to {dest}.*', voices: MONK, hours: [6, 9] },
    { text: '*The monk inclines his head and names his temple, {dest}. He takes the back bench, robe gathered close.*', voices: MONK },
  ],
  worship: [
    { text: '{hello} {Dest}, please.', voices: ANY },
    { text: '{hello} {Dest}, please — the service starts soon.', voices: ['en'] },
  ],
  market: [
    { text: '{hello} {Dest}, please. I want to try everything.', voices: FOREIGN },
    { text: '{hello} {Dest}, please — I hear the night stalls are the best part.', voices: FOREIGN, hours: [17, 23] },
    { text: '{hello} Bpai {dest} dai mai, {phi}? We’re hungry.', voices: ['th'] },
    // calendar.md §5: markets are busiest with the early-morning deliveries.
    { text: '{hello} {Dest}, {p}. Early start — the stalls open before the sun.', arch: ['vendor'], hours: [3.5, 7] },
    // §11a #23
    { text: 'To {dest} — two sacks of sticky rice and a cooler of sai ua. Tao dai {p}?', arch: ['vendor'] },
    // culture.md §5 kat = market; §8 nam prik noom.
    { text: '{Dest}, {p}. Kat day — I need green chillies for nam prik noom.', arch: ['elder'] },
    { text: '{Dest}, {phi}. Student price, na?', arch: ['student'] },
  ],
  mall: [
    { text: '{hello} {Dest}, please — somewhere with air-con!', voices: FOREIGN, when: (c) => hotSeason(c) || inHours(c.cal.hour, 11, 16) },
    { text: 'Hon uam-uam! {Dest}, {p} — I need the air-con.', voices: THAI, when: (c) => hotSeason(c) || inHours(c.cal.hour, 12, 16) },
    { text: '{Dest}, {phi}. Meeting friends at the food court.', arch: ['student'] },
    { text: '{hello} {Dest}, please. Dinner, then a film.', voices: ANY, hours: [17, 21] },
    { text: '{hello} {Dest}, please. Just a bit of shopping.', voices: ANY },
  ],
  nightlife: [
    { text: '{Dest}! First round’s on me.', voices: FOREIGN, hours: [18, 2] },
    { text: '{Dest}, please — the night is young!', voices: FOREIGN, hours: [19, 1] },
    { text: '{Dest}, please. Just one more drink, promise.', voices: FOREIGN, hours: [22, 3] },
    { text: '{hello} Bpai {dest} dai mai, {phi}? Muan khanat tonight!', voices: ['th'], hours: [18, 2] },
    { text: '{hello} {Dest}, please. I hear there’s live music.', voices: ANY, hours: [18, 24] },
    { text: '{hello} {Dest}, please. Lunch and a cold drink.', voices: ANY, hours: [11, 17] },
  ],
  airport: [
    // Business traveller line from culture.md §11a.
    { text: '{Dest}, please — and quickly, my flight boards in an hour.', arch: ['business'], weight: 3 },
    { text: '{hello} {Dest}, please. Two suitcases — will they fit?', voices: FOREIGN },
    { text: '{hello} {Dest}, please. Flying home tonight.', voices: FOREIGN, hours: [14, 23] },
    { text: '{hello} Bpai {dest} dai mai, {phi}? Flying back to Bangkok.', voices: ['th'] },
    { text: '{Dest}, {p}. My grandson is flying in from Bangkok.', voices: ['north'] },
  ],
  bus: [
    { text: '{hello} {Dest}, please. I’ve got a bus to catch.', voices: ANY },
    { text: '{hello} Bpai {dest} dai mai, {phi}? Overnight bus home to Bangkok.', voices: ['th'], hours: [16, 23] },
    { text: '{Dest}, {p}. Pik ban — the bus home leaves soon.', voices: ['north'] },
  ],
  train: [
    { text: '{hello} {Dest}, please. I’ve got a train to catch.', voices: ANY },
    { text: '{hello} Bpai {dest} dai mai, {phi}? We’re taking the train home.', voices: ['th'] },
  ],
  hotel: [
    { text: 'Back to {dest}, please. A shower, then dinner.', voices: FOREIGN, hours: [15, 20] },
    { text: '{Dest}, please. Quietly — I’ve had a few.', voices: FOREIGN, hours: [22, 4] },
    { text: '{hello} {Dest}, please. We’re checking in.', voices: ANY, hours: [11, 20] },
    { text: '{Dest}, please. I have a video call in twenty minutes.', arch: ['business', 'nomad'] },
    { text: '{hello} Bpai {dest} dai mai, {phi}?', voices: ['th'] },
  ],
  hostel: [
    { text: '{Dest}, please. Cheapest bed in town — and a rooftop!', arch: ['backpacker'] },
    { text: '{hello} {Dest}, please. The others are waiting for us.', voices: FOREIGN },
    { text: '{Dest}, please. Quietly — I’ve had a few.', voices: FOREIGN, hours: [22, 4] },
  ],
  cafe: [
    { text: '{Dest}, please. I need coffee and a socket before my call.', arch: ['nomad'] },
    { text: '{hello} {Dest}, please. Everyone on Instagram goes there.', arch: ['tourist_kr', 'tourist_cn', 'thai_tourist'] },
    { text: '{Dest}, please. I don’t talk before coffee.', voices: FOREIGN, hours: [6, 10] },
    { text: '{hello} Bpai {dest} dai mai, {phi}? I hear the cake is famous.', voices: ['th'] },
  ],
  restaurant: [
    { text: '{hello} {Dest}, please. I’m starving.', voices: ANY },
    { text: '{Dest}, please. Lunch before it gets too hot.', voices: FOREIGN, hours: [11, 14] },
    { text: '{Dest}, please. We have a table for dinner.', voices: FOREIGN, hours: [17, 21] },
    { text: '{hello} Pai song ti {dest} dai ko {p}? The food there is lam khanat.', voices: ['north'] },
  ],
  university: [
    { text: '{Phi}, {dest} — class starts soon!', arch: ['student'], hours: [7, 10] },
    { text: '{Dest}, {phi}. Back to the dorm.', arch: ['student'], hours: [16, 23] },
    { text: '{hello} {Dest}, please. I’m visiting a friend who studies there.', voices: FOREIGN },
  ],
  school: [
    // calendar.md §5: school-out mini-peak around 15:30.
    { text: '{Dest}, {p}. My grandchildren finish at half past three.', arch: ['elder'], hours: [14, 16] },
    { text: '{hello} {Dest}, please. I’m picking up my kids.', voices: ANY, hours: [14, 17] },
    { text: '{hello} {Dest}, please.', voices: ANY },
  ],
  hospital: [
    { text: '{Dest}, please. Just a check-up — khap cha-cha dai mai?', arch: ['elder', 'retiree'] },
    { text: '{hello} {Dest}, please. Visiting a friend on the ward.', voices: ANY },
    { text: '{hello} Bpai {dest} dai mai, {phi}? My father has an appointment.', voices: ['th'] },
    { text: '*A monk waits at the kerb with a small shoulder bag. He is visiting the sick at {dest}.*', voices: MONK },
  ],
  attraction: [
    { text: '{hello} {Dest}, please. Our guidebook says we can’t miss it.', voices: FOREIGN },
    { text: '{hello} Bpai {dest} dai mai, {phi}? We want photos — ngam khanat!', voices: ['th'] },
    { text: '{hello} {Dest}, please. Is it far?', voices: ANY },
  ],
  museum: [
    { text: '{hello} {Dest}, please. I want to know how old this city really is.', voices: FOREIGN },
    { text: '{hello} {Dest}, please.', voices: ANY },
  ],
  viewpoint: [
    { text: '{Dest}, please. I want to watch the sun set over the Ping.', voices: ANY, hours: [16, 18.5], when: toIs('iron_bridge', 'nawarat_bridge') },
    { text: '{Dest}, please — the river looks lovely at night.', voices: ANY, hours: [19, 23], when: toIs('iron_bridge', 'nawarat_bridge') },
    { text: '{hello} {Dest}, please. I want a photo.', voices: ANY },
  ],
  park: [
    { text: '{Dest}, please. A walk before it gets hot.', voices: ANY, hours: [6, 10] },
    { text: '{hello} {Dest}, please. We packed a picnic.', voices: ANY, hours: [10, 17] },
    { text: '{hello} {Dest}, please.', voices: ANY },
  ],
  gate: [
    { text: '{hello} {Dest}, please. We’ll walk into the Old City from there.', voices: FOREIGN },
    { text: '{hello} Bpai {dest} dai mai, {phi}?', voices: ['th'] },
    { text: '{Dest}, please. We’re meeting friends by the gate.', voices: ANY, hours: [17, 22] },
  ],
  shop: [{ text: '{hello} {Dest}, please. Just a few things.', voices: ANY }],
  civic: [{ text: '{hello} {Dest}, please. Paperwork — again.', voices: ANY }],
};

/** Lines shaped by the origin, the hour or the distance, for any destination. */
const TRIP_LINES: Line[] = [
  // culture.md §9: touts work Tha Phae Gate and the Night Bazaar.
  { text: 'Get me away from these touts — {dest}, please.', voices: FOREIGN, when: (c) => c.from.id === 'tha_phae_gate' || c.from.id === 'night_bazaar' },
  { text: 'Just landed! {Dest}, please.', voices: [...FOREIGN, 'th'], when: (c) => c.originKind === 'airport' },
  { text: '{hello} Long ride. {Dest}, please.', voices: ANY, when: (c) => c.originKind === 'bus' || c.originKind === 'train' },
  { text: 'We made merit at {origin}. Now {dest}, {p}!', voices: ['th'], when: (c) => c.originKind === 'temple' },
  { text: 'It’s a long way to {dest} — can this tuk-tuk make it?', voices: FOREIGN, when: (c) => c.metres > 6_000 },
  { text: '{Dest}, {p} — far, I know. Can she make it?', voices: THAI, when: (c) => c.metres > 6_000 },
  { text: 'Just to {dest}. I know it’s close, but it’s too hot to walk.', voices: FOREIGN, when: (c) => c.metres < 1_500 && (hotSeason(c) || inHours(c.cal.hour, 11, 16)) },
  { text: '{Dest}, please — is the traffic always this bad?', voices: FOREIGN, when: rushHour },
  { text: '{Dest}, please. Everyone else has gone home.', voices: ANY, hours: [23, 4] },
  { text: '{Dest}, please. Quietly — I’ve had a few.', voices: FOREIGN, hours: [22, 4], when: (c) => c.originKind === 'nightlife' },
  // §11a #36, without the head count.
  { text: 'Sorry, {p} — I’ve brought a durian. You’ll smell it all the way to {dest}.', arch: ['elder', 'vendor'] },
  // §11a #9, as an evening booking.
  { text: '{Dest} tonight, please — and tee time is at seven, so can you come back at five-thirty? It’ll still be dark!', arch: ['tourist_kr'], hours: [17, 22] },
];

const said = (voice: Voice, ...texts: string[]): Line[] => texts.map((text) => ({ text, voices: [voice] }));

/** Plain requests in each speaker's voice. */
const VOICE_LINES: Record<Voice, Line[]> = {
  en: said('en', '{hello} {Dest}, please.', '{Dest}? How much?', '{hello} Can you take me to {dest}?'),
  // §11a #6
  zh: said('zh', '{hello} {Dest}, please.', '{Dest}, please. Can I scan your QR with Alipay? It says they work now.'),
  ko: said('ko', '{hello} {Dest}, please.', '{hello} Can you take us to {dest}?'),
  th: said('th', '{hello} Bpai {dest} dai mai?', '{Phi} {p}, bpai {dest} dai mai?', 'Kaa rot tao rai, bpai {dest}?'),
  north: said('north', '{hello} Pai song ti {dest} dai ko {p}?', '{Dest}, {p}. Tao dai {p}?'),
  // §11a #26 and #25.
  monk: said('monk', '{Dest}, please.', '*The monk nods, gathers his robe and takes the far end of the bench. He is going to {dest}.*'),
};

/** culture.md §11a lines that name no place: small talk for any trip. */
const CHATTER: Line[] = [
  { text: 'My knees and that step don’t get on. Hold her steady while I climb in?', arch: ['retiree'] },
  // §11a #14, when a Grab really would be about seventy (culture.md §7: Old City → Nimman 60–90).
  { text: 'Grab says seventy baht. Match it and I’ll book you every morning.', arch: ['nomad'], when: (c) => c.fare >= 60 && c.fare <= 100 },
  // §11a #15, before the smoke season (calendar.md §3: Feb–Apr).
  { text: 'Is it true the smoke gets bad in March? Everyone’s telling me to go south.', arch: ['nomad'], when: (c) => c.cal.month >= 9 || c.cal.month <= 1 },
  { text: 'Aew hue muan noe — have fun, young one. And drive slowly, khap cha-cha.', arch: ['elder'] },
  { text: 'Ror moen bai moen ngao! I waited so long I nearly walked.', arch: ['elder'] },
];

const WEIGHTS = { place: 6, kind: 2, trip: 1.5, voice: 1, chatter: 0.5 };

function applies(line: Line, c: Ctx): boolean {
  const voices = line.voices ?? (line.arch ? undefined : ANY);
  if (voices && !voices.includes(c.voice)) return false;
  if (line.arch && !line.arch.includes(c.arch)) return false;
  if (line.hours && !inHours(c.cal.hour, line.hours[0], line.hours[1])) return false;
  return !line.when || line.when(c);
}

// ------------------------------------------------------------------ filling
function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function sawatdee(c: Ctx): string {
  if (!c.female) return 'Sawatdee khrap';
  return c.voice === 'north' ? 'Sawatdee jao' : 'Sawatdee kha';
}

/** Polite particle: khrap (men), kha (women), jao (Kham Mueang women). */
function particle(c: Ctx): string {
  if (!c.female) return 'khrap';
  return c.voice === 'north' ? 'jao' : 'kha';
}

function thanksThai(c: Ctx): string {
  if (c.voice === 'north' && c.female) return 'Yin dee jao';
  return c.female ? 'Khop khun kha' : 'Khop khun khrap';
}

function englishHello(c: Ctx): string {
  const h = c.cal.hour;
  const pick = (xs: string[]) => c.game.rng.pick(xs);
  if (inHours(h, 4, 11.5)) return pick(['Morning!', 'Good morning!']);
  if (inHours(h, 11.5, 17.5)) return pick(['Hi!', 'Hello!', 'Afternoon!']);
  if (inHours(h, 17.5, 22)) return pick(['Evening!', 'Good evening!']);
  return pick(['Hi — still working?', 'Hey!']);
}

/** A greeting that fits the speaker and the hour. */
function hello(c: Ctx): string {
  const rng = c.game.rng;
  switch (c.voice) {
    case 'th':
      return `${sawatdee(c)}!`;
    case 'north':
      if (c.arch === 'elder' && inHours(c.cal.hour, 6, 14) && rng.chance(0.3)) return 'Ai, kin khao laew ka?';
      return `${sawatdee(c)}!`;
    case 'zh':
      return rng.chance(0.6) ? 'Nǐ hǎo!' : englishHello(c);
    case 'ko':
      return rng.chance(0.6) ? 'Annyeong-haseyo!' : englishHello(c);
    case 'en':
      return rng.chance(0.3) ? `${sawatdee(c)}!` : englishHello(c);
    case 'monk':
      return '';
  }
}

function fill(text: string, c: Ctx): string {
  const out = text.replace(/\{(\w+)\}/g, (_, key: string) => {
    switch (key) {
      case 'dest':
        return spokenName(c.to);
      case 'Dest':
        return capitalise(spokenName(c.to));
      case 'origin':
        return spokenName(c.from);
      case 'Origin':
        return capitalise(spokenName(c.from));
      case 'hello':
        return hello(c);
      case 'sawatdee':
        return sawatdee(c);
      case 'p':
        return particle(c);
      case 'phi':
        return 'phi';
      case 'Phi':
        return 'Phi';
      case 'thanks':
        return thanksThai(c);
      case 'fare':
        return `฿${c.fare}`;
      default:
        return '';
    }
  });
  const tidy = out.replace(/\s{2,}/g, ' ').trim();
  return tidy.startsWith('*') ? tidy : capitalise(tidy);
}

function context(game: Game, from: Place, to: Place, arch: Archetype, cal: CalendarInfo, spawnedAt: number, fare: number): Ctx {
  return {
    game,
    from,
    to,
    arch,
    voice: VOICE[arch],
    female: speakerIsFemale(arch, spawnedAt, from.idx, to.idx),
    cal,
    kind: destKind(to),
    originKind: destKind(from),
    metres: Math.hypot(to.x - from.x, to.y - from.y),
    fare,
  };
}

function pickLine(pools: [Line[], number][], c: Ctx): Line | null {
  const lines: Line[] = [];
  const weights: number[] = [];
  for (const [pool, weight] of pools) {
    for (const line of pool) {
      if (!applies(line, c)) continue;
      lines.push(line);
      weights.push(line.weight ?? weight);
    }
  }
  if (!lines.length) return null;
  return lines[c.game.rng.weighted(weights)];
}

/** A request line and whether it names the destination through the {dest} template. */
export interface ComposedLine {
  text: string;
  templated: boolean;
}

/** Compose the hail line for a trip (exposed for tests; demand uses requestLine). */
export function composeRequestLine(game: Game, from: Place, to: Place, arch: Archetype, cal: CalendarInfo): ComposedLine {
  const fare = streetFare(Math.hypot(to.x - from.x, to.y - from.y) * BALANCE.trip.detourFactor);
  const c = context(game, from, to, arch, cal, game.state.time, fare);
  const line =
    pickLine(
      [
        [PLACE_LINES, WEIGHTS.place],
        [KIND_LINES[c.kind] ?? [], WEIGHTS.kind],
        [TRIP_LINES, WEIGHTS.trip],
        [VOICE_LINES[c.voice], WEIGHTS.voice],
        [CHATTER, WEIGHTS.chatter],
      ],
      c,
    ) ?? VOICE_LINES[c.voice][0];
  return { text: fill(line.text, c), templated: /\{dest\}/i.test(line.text) };
}

/** What a passenger says when they hail a tuk-tuk for this trip. */
export function requestLine(game: Game, from: Place, to: Place, arch: Archetype, cal: CalendarInfo): string {
  return composeRequestLine(game, from, to, arch, cal).text;
}

// ------------------------------------------------------------------ haggling
export type HaggleMood = 'thanks' | 'counter' | 'leave' | 'merit';

const HAGGLE: Record<HaggleMood, Line[]> = {
  thanks: [
    { text: 'Deal!', voices: FOREIGN },
    { text: 'OK, OK. Let’s go.', voices: FOREIGN },
    { text: 'Sounds fair. {thanks}!', voices: ['en'] },
    { text: 'Deal — {dest}, here we come!', voices: ['en'] },
    { text: 'Deal! Xièxie!', voices: ['zh'] },
    { text: 'Deal! Kamsahamnida!', voices: ['ko'] },
    { text: 'Dai {p}. Bpai!', voices: ['th'] },
    { text: '{thanks}, {phi}. Let’s go.', voices: THAI },
    { text: 'Bo pen yang, {p}. Let’s go.', voices: ['north'] },
    { text: 'Deal! I’ll tell the hostel you’re the honest one.', arch: ['backpacker'], weight: 2 },
    { text: 'Deal — cheaper than Grab. Let’s go!', arch: ['nomad'], weight: 2 },
    { text: 'Fair enough, phi. Jai yen yen — no rush.', arch: ['retiree'], weight: 2 },
    { text: 'Dai {p}. Khap cha-cha, na — drive slowly.', arch: ['elder'], weight: 2 },
    { text: 'Yes! Student price! Bpai!', arch: ['student'], weight: 2 },
    { text: 'Fine. Just get me there.', arch: ['business'], weight: 2 },
    { text: '*The monk nods his thanks and settles on the back bench.*', voices: MONK },
  ],
  merit: [
    { text: '*The monk smiles and murmurs a blessing for your tuk-tuk. Merit made — tham bun.*', voices: MONK },
    { text: '*The monk blesses you and your tuk-tuk, then takes the back bench. Merit made.*', voices: MONK },
  ],
  counter: [
    { text: 'Too much! How about {fare}?', voices: ['en'] },
    { text: 'Grab is cheaper… I can do {fare}.', voices: ['en'] },
    { text: 'Hmm. {fare} and we have a deal.', voices: ['en'] },
    { text: 'Too expensive! {fare}, OK?', voices: ['zh', 'ko'] },
    { text: 'Paeng bpai! {fare}?', arch: ['backpacker'], weight: 2 },
    { text: 'We’re on a budget — {fare}?', arch: ['backpacker'] },
    { text: 'Paeng bpai, {phi}! {fare} dai mai?', voices: ['th'] },
    { text: 'Lot noi dai mai? {fare}?', voices: ['th'] },
    { text: 'Paeng bpai, {p}! {fare}?', voices: ['north'] },
    { text: 'Bo, bo — {fare}, {p}.', voices: ['north'] },
    { text: 'Student price, {phi}! {fare}?', arch: ['student'], weight: 2 },
    { text: 'Grab says {fare}. Match it?', arch: ['nomad'], weight: 2 },
    { text: 'I usually pay {fare}, phi.', arch: ['retiree'], weight: 2 },
    { text: '{fare}. Final offer — I’m in a hurry.', arch: ['business'], weight: 2 },
    { text: '*The monk quietly holds out {fare} — all he carries.*', voices: MONK },
  ],
  leave: [
    { text: 'Forget it, I’ll take a songthaew.', voices: ['en'] },
    { text: 'No thanks — I’ll walk.', voices: ['en'] },
    { text: 'I’ll book a Grab.', voices: FOREIGN },
    { text: 'Too expensive. Bye!', voices: ['zh', 'ko'] },
    { text: 'Mai ao, {p}. I’ll take a rot daeng.', voices: ['th'] },
    { text: 'Paeng bpai! Never mind.', voices: THAI },
    { text: 'Bo pen yang — I’ll wait for the songthaew, {p}.', voices: ['north'] },
    { text: 'Ror moen bai moen ngao… and now this price? No.', arch: ['elder'], weight: 2 },
    { text: 'Mai ao, phi — we’ll share a songthaew.', arch: ['student'], weight: 2 },
    { text: 'No time for this. I’ll get a taxi.', arch: ['business'], weight: 2 },
    { text: '*The monk smiles, bows his head slightly and walks on.*', voices: MONK },
  ],
};

/** A passenger's answer at the kerb: accepting, countering with a fare, or walking off. */
export function haggleLine(game: Game, req: RideRequest, mood: HaggleMood, fare = 0): string {
  const places = game.world.places;
  const c = context(game, places[req.from], places[req.to], req.archetype, calendar(game.state.time), req.spawnedAt, fare);
  const line = pickLine([[HAGGLE[mood], 1]], c) ?? HAGGLE[mood][0];
  return fill(line.text, c);
}

// ------------------------------------------------------------------ glossary
/** True for narration lines (written between asterisks). */
export function isNarration(line: string): boolean {
  return line.length > 1 && line.startsWith('*') && line.endsWith('*');
}

/** Narration without its asterisks; speech unchanged. */
export function lineText(line: string): string {
  return isNarration(line) ? line.slice(1, -1) : line;
}

/**
 * Short translations of the Thai, Kham Mueang and other words used in dialogue.
 * [research] culture.md §5 (language tables), §7–8 (songthaews, food), calendar.md §4 (festivals).
 */
export const GLOSSARY: Record<string, string> = {
  'sawatdee khrap': 'hello (said by a man)',
  'sawatdee kha': 'hello (said by a woman)',
  'sawatdee jao': 'hello, politely — Kham Mueang',
  sawatdee: 'hello',
  'khop khun khrap': 'thank you (said by a man)',
  'khop khun kha': 'thank you (said by a woman)',
  'yin dee jao': 'thank you — Kham Mueang',
  khrap: 'polite ending used by men',
  kha: 'polite ending used by women',
  jao: 'polite ending — Kham Mueang',
  phi: 'older brother or sister — the polite way to address a driver',
  lung: 'uncle — for an older man',
  bpai: 'go',
  'dai mai': 'can you? / OK?',
  'paeng bpai': 'too expensive!',
  'kaa rot tao rai': 'how much is the fare?',
  'tao dai': 'how much? — Kham Mueang',
  'pai song ti': 'take me to… — Kham Mueang',
  'dai ko': 'can you? — Kham Mueang',
  'mai pen rai': 'never mind, no problem',
  'bo pen yang': 'no problem — Kham Mueang',
  bo: 'no — Kham Mueang',
  'mai ao': 'no thanks',
  'lot noi dai mai': 'can you knock a bit off?',
  'jai yen yen': 'keep a cool heart — calm down',
  'khap cha-cha dai mai': 'can you drive slowly?',
  'khap cha-cha': 'drive slowly',
  'kin khao laew ka': 'eaten yet? — the Kham Mueang "how are you?"',
  'aew hue muan noe': 'have fun out there! — Kham Mueang',
  'muan khanat': 'so much fun — Kham Mueang',
  'ngam khanat': 'so beautiful — Kham Mueang',
  'lam khanat': 'really delicious — Kham Mueang',
  'ror moen bai moen ngao': 'I waited for ages — Kham Mueang',
  'pik ban': 'go home — Kham Mueang',
  'kha jai': 'hurry up! — Kham Mueang',
  'ja pai phang': 'don’t rush — Kham Mueang',
  'hon uam-uam': 'stiflingly hot — Kham Mueang',
  pho: 'look! — Kham Mueang',
  kat: 'market — Kham Mueang',
  'kad luang': 'the great market: Warorot',
  'tham bun': 'make merit',
  na: 'softener — "OK?"',
  songthaew: 'shared pickup-truck taxi',
  'rot daeng': 'red truck — the city’s shared songthaew',
  'khao soi': 'curry noodle soup, the northern classic',
  'sai ua': 'northern herb sausage',
  'nam prik noom': 'roasted green-chilli dip',
  krathong: 'floating offering of banana leaf and flowers',
  'yi peng': 'Lanna festival of lights, full moon of the second month',
  songkran: 'Thai New Year water festival',
  'muay thai': 'Thai boxing',
  'nǐ hǎo': 'hello — Mandarin',
  xièxie: 'thank you — Mandarin',
  'annyeong-haseyo': 'hello — Korean',
  kamsahamnida: 'thank you — Korean',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GLOSS_RE = new RegExp(
  `(?<![\\p{L}\\p{M}’'-])(${Object.keys(GLOSSARY)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})(?![\\p{L}\\p{M}’'-])`,
  'giu',
);

export interface GlossSegment {
  text: string;
  gloss?: string;
}

/**
 * Split text into plain runs and glossed words. Occurrences of the protected
 * strings (place names) are left unglossed, so "Kad Na Mor" is not read as the
 * particle "na".
 */
export function glossLine(text: string, protect: readonly string[] = []): GlossSegment[] {
  const out: GlossSegment[] = [];
  const guards = protect.filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
  const guardRe = guards.length ? new RegExp(`(${guards.map(escapeRe).join('|')})`, 'g') : null;
  const parts = guardRe ? text.split(guardRe) : [text];
  for (const part of parts) {
    if (!part) continue;
    if (guards.includes(part)) {
      out.push({ text: part });
      continue;
    }
    let last = 0;
    for (const m of part.matchAll(GLOSS_RE)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ text: part.slice(last, at) });
      out.push({ text: m[0], gloss: GLOSSARY[m[0].toLowerCase()] });
      last = at + m[0].length;
    }
    if (last < part.length) out.push({ text: part.slice(last) });
  }
  // Merge adjacent plain runs.
  const merged: GlossSegment[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.gloss && !s.gloss) prev.text += s.text;
    else merged.push({ ...s });
  }
  return merged;
}
