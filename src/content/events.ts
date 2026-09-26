// Calendar events, holidays and road closures for Chiang Mai, Nov 2026 onwards.
// Dates, places, closures and flavour come from docs/research/calendar.md §4–§8
// (cited per event). Multipliers marked "design est." in calendar.md §8 are
// gameplay guesses anchored to the research; numbers invented here are [pacing].
// Events with approx: true have inferred or unconfirmed dates; the calendar
// panel labels them "expected".

import type { Archetype, PlaceCategory } from '../sim/types';

export type EventKind = 'festival' | 'holiday' | 'market' | 'dry' | 'season' | 'campus';

/** A daily time window on consecutive local dates. `end` may pass 24 for nights that run past midnight. */
export interface EventWindow {
  /** First date, 'YYYY-MM-DD'. */
  from: string;
  /** Last date (inclusive), 'YYYY-MM-DD'. */
  to: string;
  start: number;
  end: number;
  /** This year's dates are inferred or not yet confirmed. */
  approx?: boolean;
}

/** Every week on a weekday (0 = Sunday), between two hours. */
export interface WeeklyWindow {
  weekday: number;
  start: number;
  end: number;
}

/** Where an event happens: a landmark (by id) or a point, with a radius in metres. */
export interface EventSite {
  landmark?: string;
  lat?: number;
  lon?: number;
  radius: number;
}

/** A road set (see ROAD_SETS) that is closed to traffic, or slowed to a fraction of normal speed. */
export interface RoadEffect {
  set: string;
  closed?: boolean;
  slow?: number;
}

/** Extra street hails of people heading to the event. */
export interface InboundRides {
  /** Destination landmark ids (one is picked per ride). */
  to?: string[];
  /** Destination point for sites beyond the map edge: the nearest place to it is used. */
  toPoint?: { lat: number; lon: number };
  /** Rides per game hour at full strength. */
  perHour: number;
  /** Daily hours (inside the event window) when riders head there. */
  start: number;
  end: number;
  /** Archetype weight multipliers for these riders. */
  bias?: Partial<Record<Archetype, number>>;
  /** Multiplier on how far above the going rate these riders will pay. */
  fare?: number;
  lines: string[];
}

export interface CityEventDef {
  id: string;
  name: string;
  th?: string;
  icon: string;
  kind: EventKind;
  windows?: EventWindow[];
  weekly?: WeeklyWindow[];
  /** Human-readable location. */
  where: string;
  sites?: EventSite[];
  /** Origin demand multiplier for places inside any site. */
  siteDemand?: number;
  /** Fare-tolerance multiplier for rides starting inside any site. */
  siteFare?: number;
  /** Citywide origin demand multipliers by place category. */
  catDemand?: Partial<Record<PlaceCategory, number>>;
  /** Citywide fare-tolerance multiplier. */
  fare?: number;
  /** Citywide speed multiplier on arterials; side streets feel half of it. */
  speed?: number;
  roads?: RoadEffect[];
  inbound?: InboundRides;
  /** Rating change for trips touching the Old City unless the tuk-tuk has rain curtains (Songkran water). */
  splash?: number;
  /** Toast text when the event starts; defaults to the flavour line. */
  announce?: string;
  /** Send a "coming up tomorrow" notice the day before the first day. */
  headsUp?: boolean;
  flavour: string;
  /** What this means for drivers (calendar panel). */
  drivers: string;
  /** Dates are inferred or not yet confirmed. */
  approx?: boolean;
  /** Research citation. */
  source: string;
}

/** A named group of road edges, matched by OSM name and area. */
export interface RoadSetDef {
  name: string;
  /** Exact road names as they appear in public/data/graph.json; omitted = every road in the area. */
  roads?: string[];
  /** [south, west, north, east] in degrees; an edge matches when its midpoint is inside. */
  box?: [number, number, number, number];
  circle?: { lat: number; lon: number; radius: number };
}

// ------------------------------------------------------------------ roads
// Names and extents from calendar.md §5 and §7 ([osm-moat] geometry): the
// moat roads span 18.7810–18.7960 N, 98.9775–98.9939 E.
const MOAT_ROADS = [
  // Inner ring, anticlockwise.
  'Moon Muang Road',
  'Sri Poom Road',
  'Sripoom Road',
  'Arak Road',
  'Bumrung Buri Road',
  // Outer ring, clockwise.
  'Chayiaphoom Road',
  'Kotchasarn Road',
  'Mani Noppharat Road',
  'Bun Rueang Rit Road',
  'Chang Lo Road',
];

export const ROAD_SETS: Record<string, RoadSetDef> = {
  // Sunday Walking Street: Ratchadamnoen Rd from Tha Phae Gate west to Wat Phra Singh (OSM 1,118 m).
  ratchadamnoen: { name: 'Ratchadamnoen Rd', roads: ['Rachadamnoen Road'], box: [18.7865, 98.9805, 18.7895, 98.9936] },
  // Saturday Walking Street: Wualai Rd south of Chiang Mai Gate.
  wualai: { name: 'Wualai Rd', roads: ['Wualai Road'], box: [18.774, 98.98, 18.7815, 98.9885] },
  // Tha Phae Rd from the gate to Nawarat Bridge.
  tha_phae_rd: { name: 'Tha Phae Rd', roads: ['Thapae Road'], box: [18.786, 98.993, 18.7895, 99.0045] },
  // Songkran street party: Tha Phae Rd from Wat Saen Fang (98.9988 E) to the gate.
  tha_phae_rd_west: { name: 'Tha Phae Rd (Wat Saen Fang – gate)', roads: ['Thapae Road'], box: [18.786, 98.993, 18.7895, 98.999] },
  moat: { name: 'Moat roads', roads: MOAT_ROADS, box: [18.78, 98.9765, 18.797, 98.995] },
  // Streets inside the moat.
  old_city: { name: 'Old City streets', box: [18.7818, 98.9788, 18.7952, 98.9928] },
  // Warorot / Chang Moi / riverside during Chinese New Year.
  warorot: { name: 'Streets around Warorot', circle: { lat: 18.7902, lon: 99.0005, radius: 320 } },
  // Flower parade: Nawarat Bridge → Tha Phae Rd → Kotchasarn → Chang Lo → Arak → Nong Buak Haad [pmtours-flower].
  flower_parade: {
    name: 'Tha Phae, Kotchasarn, Chang Lo & Arak Rds',
    roads: ['Thapae Road', 'Kotchasarn Road', 'Chang Lo Road', 'Arak Road'],
    box: [18.78, 98.9765, 18.79, 99.0045],
  },
};

// ------------------------------------------------------------------ sites
const site = (landmark: string, radius: number): EventSite => ({ landmark, radius });
/** Ping River bank between Nawarat Bridge and the Iron Bridge (calendar.md §4, Loy Krathong crowd sites). */
const PING_KRATHONG: EventSite = { lat: 18.7858, lon: 99.0045, radius: 450 };
/** Ban Bo Sang, ~10 km east of Tha Phae Gate and beyond the map edge (calendar.md §4, OSM node 248907803). */
export const BO_SANG = { lat: 18.76748, lon: 99.08357 };

// ---------------------------------------------------------------- effects
/** Tourist-facing origin categories (calendar.md §8: hotels, sights and markets). */
export const TOURIST_CATEGORIES: PlaceCategory[] = ['hotel', 'hostel', 'attraction', 'temple', 'museum', 'viewpoint', 'market', 'gate'];

function tourists(m: number, extra: Partial<Record<PlaceCategory, number>> = {}): Partial<Record<PlaceCategory, number>> {
  const out: Partial<Record<PlaceCategory, number>> = {};
  for (const c of TOURIST_CATEGORIES) out[c] = m;
  return { ...out, ...extra };
}

/** Long weekend: domestic tourists ×1.3 (calendar.md §8, design est.), spread over tourist origins; offices shut. */
const LONG_WEEKEND = tourists(1.2, { transport: 1.3, school: 0.3, civic: 0.4 });
/** A single public holiday: schools and offices shut, a few more day-trippers [pacing]. */
const HOLIDAY = tourists(1.08, { school: 0.3, civic: 0.4, university: 0.7 });
/** Buddhist holy day: nightlife ×0.3, temple trips ×1.5 (calendar.md §8, design est.). */
const DRY_DAY: Partial<Record<PlaceCategory, number>> = { nightlife: 0.3, temple: 1.5 };

const day = (date: string, start = 0, end = 24): EventWindow => ({ from: date, to: date, start, end });
const span = (from: string, to: string, start = 0, end = 24): EventWindow => ({ from, to, start, end });

/** The same calendar date(s) every year from 2026 to 2030 (fixed-date holidays). */
function yearly(mmdd: string, days = 1, start = 0, end = 24): EventWindow[] {
  const out: EventWindow[] = [];
  for (let y = 2026; y <= 2030; y++) {
    const [m, d] = mmdd.split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1, d + days - 1));
    const iso = (t: Date) => t.toISOString().slice(0, 10);
    out.push({ from: `${y}-${mmdd}`, to: iso(last), start, end });
  }
  return out;
}

// ----------------------------------------------------------------- events
export const CITY_EVENTS: CityEventDef[] = [
  // ------------------------------------------------------------ weekly
  {
    id: 'sunday_walking_street',
    name: 'Sunday Walking Street',
    th: 'ถนนคนเดินวันอาทิตย์',
    icon: '🏮',
    kind: 'market',
    weekly: [{ weekday: 0, start: 16, end: 23 }],
    where: 'Ratchadamnoen Rd, Tha Phae Gate → Wat Phra Singh',
    roads: [{ set: 'ratchadamnoen', closed: true }],
    announce: 'Sunday Walking Street: Ratchadamnoen Rd is closed to traffic until 23:00.',
    flavour: 'Ratchadamnoen is a river of people and grilled sausage.',
    drivers: 'Ratchadamnoen Rd is shut 16:00–23:00, so cross the Old City on Ratchamanka or Sri Phum. Pickups peak at both ends 18:00–21:00.',
    source: 'calendar.md §5 [thg-sunday], §8',
  },
  {
    id: 'saturday_walking_street',
    name: 'Saturday Walking Street',
    th: 'ถนนคนเดินวัวลาย',
    icon: '🏮',
    kind: 'market',
    weekly: [{ weekday: 6, start: 17, end: 23 }],
    where: 'Wualai Rd, south of Chiang Mai Gate',
    roads: [{ set: 'wualai', closed: true }],
    announce: 'Saturday Walking Street: Wualai Rd is closed to traffic until 23:00.',
    flavour: 'Silver street wakes up for the night.',
    drivers: 'Wualai Rd is shut 17:00–23:00. Wait for shoppers at Chiang Mai Gate instead.',
    source: 'calendar.md §5 [hecktic], §8',
  },

  // ---------------------------------------------------------- Nov 2026
  {
    id: 'cmu_semester_2',
    name: 'CMU semester 2 begins',
    icon: '🎓',
    kind: 'campus',
    windows: [span('2026-11-16', '2026-11-20', 7, 21)],
    where: 'Chiang Mai University, Suthep & Huay Kaew Rds',
    catDemand: { university: 1.5 },
    flavour: 'Students are back on campus after the break.',
    drivers: 'Student rides from CMU and Nimman run about 50% above normal this week.',
    source: 'calendar.md §5 [cmu-2026], §8 CMU term start',
  },
  {
    id: 'yi_peng',
    name: 'Yi Peng / Loy Krathong',
    th: 'ยี่เป็ง / ลอยกระทง',
    icon: '🏮',
    kind: 'festival',
    headsUp: true,
    // 2026: municipality programme 23–25 Nov around the full moon (Tue 24). 2027: full moon 13 Nov.
    windows: [span('2026-11-23', '2026-11-25', 17, 25), { ...span('2027-11-12', '2027-11-14', 17, 25), approx: true }],
    where: 'Tha Phae Gate, Ping River (Nawarat–Iron Bridge), Three Kings, Wat Phan Tao',
    sites: [site('tha_phae_gate', 450), PING_KRATHONG, site('three_kings', 300), site('wat_phan_tao', 250), site('wat_chedi_luang', 250)],
    // Evening demand ×2 and Old City speed ×0.5: calendar.md §8 (design est.).
    siteDemand: 2,
    siteFare: 1.2,
    speed: 0.75,
    roads: [{ set: 'old_city', slow: 0.5 }],
    inbound: {
      to: ['tha_phae_gate', 'nawarat_bridge'],
      perHour: 30,
      start: 17,
      end: 21,
      bias: { thai_tourist: 2, tourist_west: 1.3, tourist_kr: 1.3 },
      lines: [
        'Tha Phae Gate for the lanterns, please — before the crowds get too thick!',
        'Down to the river, jao. We made our krathong from banana leaves this morning.',
        'Loy Krathong! Nawarat Bridge, please — we want to float ours by the water.',
      ],
    },
    announce: 'Yi Peng begins: krathongs drift down the Ping; the whole city is candlelit.',
    flavour: 'Krathongs drift down the Ping; the whole city is candlelit.',
    drivers:
      'Evening rides to Tha Phae Gate and the riverside double and riders pay a bit more; the Old City crawls at half speed. Sky lanterns may only go up at licensed sites outside the city; in town it is lantern displays, candles and krathongs.',
    source: 'calendar.md §4 [cmnews-yp26] [wiki-loykrathong], §8 Yi Peng',
  },
  {
    id: 'lantern_flight_curfew',
    name: 'Lantern nights: no flights after 19:00',
    icon: '✈️',
    kind: 'festival',
    windows: [span('2026-11-24', '2026-11-25', 19, 25)],
    where: 'Chiang Mai International Airport',
    sites: [site('cnx_airport', 700)],
    siteDemand: 0.1,
    flavour: 'No planes after seven: the sky belongs to the lanterns.',
    drivers: 'Almost no airport pickups after 19:00. Flights stopped on the 2025 lantern nights; the 2026 schedule is not confirmed.',
    approx: true,
    source: 'calendar.md §4 [nation-cnx-yp25], §8 lantern-release night',
  },
  {
    id: 'krathong_parade',
    name: 'Grand Krathong Parade',
    th: 'ขบวนแห่กระทงใหญ่',
    icon: '🪷',
    kind: 'festival',
    headsUp: true,
    windows: [day('2026-11-25', 19, 23), { ...day('2027-11-14', 19, 23), approx: true }],
    where: 'Tha Phae Gate → Tha Phae Rd → Ping River',
    sites: [site('tha_phae_gate', 400)],
    siteDemand: 1.5,
    roads: [{ set: 'tha_phae_rd', closed: true }],
    inbound: {
      to: ['tha_phae_gate'],
      perHour: 45,
      start: 17.5,
      end: 20,
      bias: { thai_tourist: 1.6, tourist_cn: 1.3 },
      lines: ['The big lantern parade! Drop us as close to Tha Phae Gate as you can.', 'Thirty giant lanterns tonight — let’s go, let’s go!'],
    },
    announce: 'Grand Krathong Parade: Tha Phae Rd is closed 19:00–23:00.',
    flavour: 'Thirty giant lanterns roll down Tha Phae Road.',
    drivers: 'Tha Phae Rd is closed 19:00–23:00. Drop-offs at Tha Phae Gate spike from 17:30.',
    source: 'calendar.md §4 [nation-yp25] [wiki-yipeng], §8 Krathong parade',
  },

  // ---------------------------------------------------------- Dec 2026
  {
    id: 'fathers_day_weekend',
    name: 'Father’s Day long weekend',
    th: 'วันพ่อแห่งชาติ',
    icon: '💛',
    kind: 'holiday',
    // Sat 5 Dec 2026, observed Mon 7 Dec. 2027: Sun 5 Dec, substitute Mon 6 Dec (inferred).
    windows: [span('2026-12-05', '2026-12-07'), { ...span('2027-12-04', '2027-12-06'), approx: true }],
    where: 'Citywide; bus terminals and airport',
    catDemand: LONG_WEEKEND,
    flavour: 'Bangkok has come north for the long weekend.',
    drivers: 'King Bhumibol Memorial Day / National Day. Thai visitors pour in: more rides from hotels, bus terminals and the airport.',
    source: 'calendar.md §4 other holidays, §6 [bot-2026], §8 long weekend',
  },
  {
    id: 'constitution_day',
    name: 'Constitution Day',
    th: 'วันรัฐธรรมนูญ',
    icon: '📜',
    kind: 'holiday',
    windows: yearly('12-10'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'new_year_weekend',
    name: 'New Year long weekend',
    th: 'ปีใหม่',
    icon: '🎆',
    kind: 'holiday',
    windows: [span('2026-12-31', '2027-01-03')],
    where: 'Citywide; bus terminals and airport',
    catDemand: tourists(1.25, { transport: 1.3, school: 0.3, civic: 0.3 }),
    flavour: 'Bangkok has come north for the long weekend.',
    drivers: 'New Year’s Eve (Thu) and New Year’s Day (Fri) make a four-day break: busy hotels, bus terminals and airport.',
    source: 'calendar.md §4 New Year, §6 [bot-2026], §8 long weekend',
  },
  {
    id: 'new_years_eve',
    name: 'New Year’s Eve',
    icon: '🥂',
    kind: 'festival',
    headsUp: true,
    windows: yearly('12-31', 1, 20, 27),
    where: 'Nimman, Old City bars, Loi Kroh',
    catDemand: { nightlife: 1.8, restaurant: 1.3 },
    fare: 1.25,
    flavour: 'Last call. Everyone suddenly needs a tuk-tuk.',
    drivers: 'Late-night rides from bars run 80% above normal until 03:00, and riders pay late-night prices.',
    source: 'calendar.md §6, §8 late-night bar close (design est.)',
  },

  // ---------------------------------------------------------- Jan 2027
  {
    id: 'bo_sang',
    name: 'Bo Sang Umbrella Festival',
    th: 'เทศกาลร่มบ่อสร้าง',
    icon: '☂️',
    kind: 'festival',
    headsUp: true,
    // 3rd weekend of January (2026: Fri–Sun 16–18 Jan); 2027 inferred.
    windows: [span('2027-01-15', '2027-01-17', 9, 18)],
    where: 'Bo Sang village, ~10 km east (San Kamphaeng road)',
    inbound: {
      toPoint: BO_SANG,
      perHour: 8,
      start: 9,
      end: 16,
      bias: { tourist_west: 1.5, tourist_cn: 1.5, thai_tourist: 1.5 },
      fare: 1.4,
      lines: [
        'Bo Sang, for the umbrella festival! Take us as far out the San Kamphaeng road as you go.',
        'We want to see the parasol parade in Bo Sang — can you do the long run east?',
      ],
    },
    flavour: 'Painted parasols and a bicycle parade out in San Kamphaeng.',
    drivers: 'Long fares east towards Bo Sang, and riders pay charter prices.',
    approx: true,
    source: 'calendar.md §4 [tat-bosang], §8 Bo Sang',
  },

  // ---------------------------------------------------------- Feb 2027
  {
    id: 'flower_festival',
    name: 'Chiang Mai Flower Festival',
    th: 'งานมหกรรมไม้ดอกไม้ประดับ',
    icon: '🌸',
    kind: 'festival',
    headsUp: true,
    // Usually the 1st weekend of February (2026: 13–15 Feb, after the general-election weekend); 2027 not yet confirmed.
    windows: [span('2027-02-05', '2027-02-07', 9, 21)],
    where: 'Nong Buak Haad Park (Old City SW corner) and Tha Phae Gate',
    sites: [site('nong_buak_haad', 350)],
    siteDemand: 2,
    inbound: {
      to: ['nong_buak_haad'],
      perHour: 18,
      start: 9,
      end: 18,
      bias: { thai_tourist: 1.8, elder: 1.3, retiree: 1.5 },
      lines: ['Suan Buak Haad, please — the flower show!', 'We came up from Bangkok just for the flowers. Nong Buak Haad, jao.'],
    },
    flavour: 'Floats made of 170,000 flowers inch toward Buak Haad.',
    drivers: 'Rides to and from Nong Buak Haad Park double, 09:00–21:00.',
    approx: true,
    source: 'calendar.md §4 [thansett-flower] [wiki-flower], §8 Flower Festival',
  },
  {
    id: 'flower_parade',
    name: 'Flower Festival parade',
    icon: '🌼',
    kind: 'festival',
    windows: [day('2027-02-06', 7.5, 12)],
    where: 'Nawarat Bridge → Tha Phae Rd → Kotchasarn → Chang Lo → Arak → Nong Buak Haad',
    roads: [{ set: 'flower_parade', closed: true }],
    announce: 'Flower parade: Tha Phae, Kotchasarn, Chang Lo and Arak Rds are closed until about noon.',
    flavour: 'Floats made of 170,000 flowers inch toward Buak Haad.',
    drivers: 'The parade route is closed from 07:30 to about noon; the floats are slow and stop often.',
    approx: true,
    source: 'calendar.md §4 [prd-flower] [pmtours-flower], §8 Flower Festival',
  },
  {
    id: 'chinese_new_year',
    name: 'Chinese New Year',
    th: 'ตรุษจีน',
    icon: '🧧',
    kind: 'festival',
    headsUp: true,
    // Lunar New Year: Sat 6 Feb 2027 (Year of the Goat), celebrated over two days.
    windows: [span('2027-02-06', '2027-02-07', 7, 23)],
    where: 'Warorot Market (Kad Luang), Chang Moi Rd, the riverside',
    sites: [site('warorot_market', 400)],
    siteDemand: 2,
    roads: [{ set: 'warorot', slow: 0.4 }],
    inbound: {
      to: ['warorot_market'],
      perHour: 16,
      start: 7,
      end: 21,
      bias: { tourist_cn: 3, thai_tourist: 1.5, elder: 1.3 },
      lines: ['Kad Luang, please! We want to see the lion dancers.', 'Warorot for the New Year market — xin nian kuai le!'],
    },
    flavour: 'Lion dancers and red lanterns: Kad Luang is gridlocked.',
    drivers: 'Warorot demand doubles but its streets crawl. The parade leaves Tha Phae Gate at 08:30 for the Guan Yu shrine.',
    source: 'calendar.md §4 [pmtours-cny], §8 Chinese New Year',
  },
  {
    id: 'smoke_season',
    name: 'Smoke season',
    th: 'หมอกควัน',
    icon: '🌫️',
    kind: 'season',
    windows: [span('2027-02-15', '2027-04-30'), span('2028-02-15', '2028-04-30')],
    where: 'Citywide; Doi Suthep views',
    catDemand: { viewpoint: 0.7 },
    flavour: 'The mountain has vanished behind the haze.',
    drivers: 'Hazy days keep tourists in (see the weather), and with Doi Suthep hidden there are fewer viewpoint trips.',
    source: 'calendar.md §3 [cams] [mots26], §8 smoke season',
  },
  {
    id: 'makha_bucha',
    name: 'Makha Bucha (dry day)',
    th: 'วันมาฆบูชา',
    icon: '🕯️',
    kind: 'dry',
    // Sun 21 Feb 2027 per published holiday calendars; not confirmed by a Bank of Thailand holiday notice.
    windows: [day('2027-02-21')],
    where: 'Temples; bars closed',
    catDemand: DRY_DAY,
    flavour: 'No beer today. Candle processions at the temples instead.',
    drivers: 'Alcohol sales are banned all day: bar rides collapse, temple trips pick up in the evening.',
    approx: true,
    source: 'calendar.md §4 Makha Bucha, §6 dry days [thairanked-dry], §8',
  },
  {
    id: 'makha_bucha_weekend',
    name: 'Makha Bucha long weekend',
    icon: '🧳',
    kind: 'holiday',
    // Substitute holiday Mon 22 Feb 2027.
    windows: [span('2027-02-20', '2027-02-22')],
    where: 'Citywide; bus terminals and airport',
    catDemand: LONG_WEEKEND,
    flavour: 'Bangkok has come north for the long weekend.',
    drivers: 'A three-day weekend: more Thai visitors at hotels, bus terminals and the airport.',
    approx: true,
    source: 'calendar.md §6, §8 long weekend',
  },

  // ---------------------------------------------------------- Apr 2027
  {
    id: 'chakri_day',
    name: 'Chakri Memorial Day',
    th: 'วันจักรี',
    icon: '👑',
    kind: 'holiday',
    windows: yearly('04-06'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §4 Songkran, §6 [bot-2026]',
  },
  {
    id: 'songkran_buildup',
    name: 'Songkran water fights',
    icon: '💦',
    kind: 'festival',
    windows: [span('2027-04-10', '2027-04-12', 10, 22), span('2027-04-16', '2027-04-17', 10, 22)],
    where: 'Old City moat roads',
    roads: [{ set: 'moat', slow: 0.7 }],
    inbound: { to: ['tha_phae_gate'], perHour: 10, start: 10, end: 20, lines: ['Tha Phae Gate! We have water guns and we are not afraid to use them.'] },
    splash: -0.1,
    flavour: 'Water fights intensify around 10–11 April.',
    drivers: 'The moat roads slow down as the water fights start. Rain curtains keep your seats dry.',
    approx: true,
    source: 'calendar.md §4 [timeout-sk26], §8 Songkran',
  },
  {
    id: 'songkran',
    name: 'Songkran',
    th: 'สงกรานต์',
    icon: '💦',
    kind: 'festival',
    headsUp: true,
    windows: yearly('04-13', 3, 10, 22).filter((w) => w.from >= '2027'),
    where: 'Moat roads (splash zone), Tha Phae Gate, Ratchadamnoen, Nimman malls',
    sites: [site('tha_phae_gate', 500), site('maya', 400), site('think_park', 300)],
    siteDemand: 1.3,
    speed: 0.85,
    // Moat splash zone ×0.4; Tha Phae Gate and Ratchadamnoen are a car-free family zone.
    roads: [
      { set: 'moat', slow: 0.4 },
      { set: 'ratchadamnoen', closed: true },
    ],
    inbound: {
      to: ['tha_phae_gate'],
      perHour: 30,
      start: 10,
      end: 20,
      bias: { backpacker: 1.8, thai_tourist: 1.5, tourist_west: 1.3 },
      lines: ['Sawasdee pi mai! Tha Phae Gate — we want to get soaked!', 'To the moat, please. Yes, I know we’ll get wet. That’s the point!'],
    },
    splash: -0.2,
    announce: 'Songkran! Everyone’s armed with a water gun. Your seats will not stay dry.',
    flavour: 'Everyone’s armed with a water gun. Your seats will not stay dry.',
    drivers: 'Moat roads crawl at 40% speed and Ratchadamnoen is car-free. Rides into the Old City jump, and riders get soaked unless you fit rain curtains.',
    approx: true,
    source: 'calendar.md §4 [timeout-sk26] [citylife-sk13], §8 Songkran',
  },
  {
    id: 'songkran_procession',
    name: 'Phra Buddha Sihing procession',
    icon: '🙏',
    kind: 'festival',
    windows: [day('2027-04-13', 14, 17)],
    where: 'Nawarat Bridge → Tha Phae Rd → Ratchadamnoen → Wat Phra Singh',
    sites: [site('wat_phra_singh', 350)],
    siteDemand: 2,
    roads: [
      { set: 'tha_phae_rd', closed: true },
      { set: 'ratchadamnoen', closed: true },
    ],
    flavour: 'Phra Buddha Sihing rides out to be bathed.',
    drivers: 'Tha Phae Rd and Ratchadamnoen are closed 14:00–17:00; crowds gather at Wat Phra Singh.',
    approx: true,
    source: 'calendar.md §4 [citylife-sk13] [cmalacarte-sk], §8 Songkran procession',
  },
  {
    id: 'songkran_tha_phae_night',
    name: 'World Songkran Tha Pae',
    icon: '🎉',
    kind: 'festival',
    windows: [day('2027-04-13', 17, 24)],
    where: 'Tha Phae Rd, Wat Saen Fang → Tha Phae Gate',
    roads: [{ set: 'tha_phae_rd_west', closed: true }],
    flavour: 'The street party on Tha Phae Road runs until midnight.',
    drivers: 'Tha Phae Rd is closed from Wat Saen Fang to the gate, 17:00–24:00.',
    approx: true,
    source: 'calendar.md §4 [citylife-sk13]',
  },

  // ------------------------------------------------- rest of the year
  {
    id: 'labour_day',
    name: 'Labour Day',
    icon: '🛠️',
    kind: 'holiday',
    windows: yearly('05-01').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: many offices are shut.',
    drivers: 'Fewer office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'coronation_day',
    name: 'Coronation Day',
    icon: '👑',
    kind: 'holiday',
    windows: yearly('05-04').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'visakha_bucha',
    name: 'Visakha Bucha (dry day)',
    th: 'วันวิสาขบูชา',
    icon: '🕯️',
    kind: 'dry',
    // Thu 20 May 2027 per published holiday calendars; not confirmed by a Bank of Thailand holiday notice.
    windows: [day('2027-05-20')],
    where: 'Temples; bars closed',
    catDemand: DRY_DAY,
    flavour: 'No beer today. Candle processions at the temples instead.',
    drivers: 'Alcohol sales are banned all day: bar rides collapse, temple trips pick up in the evening.',
    approx: true,
    source: 'calendar.md §4 Buddhist Lent days, §6 dry days, §8',
  },
  {
    id: 'queens_birthday',
    name: 'Queen Suthida’s Birthday',
    icon: '👑',
    kind: 'holiday',
    windows: yearly('06-03').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'kings_birthday',
    name: 'King’s Birthday',
    icon: '👑',
    kind: 'holiday',
    windows: yearly('07-28').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'mothers_day',
    name: 'Mother’s Day',
    th: 'วันแม่แห่งชาติ',
    icon: '💙',
    kind: 'holiday',
    windows: yearly('08-12').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'bhumibol_memorial',
    name: 'King Bhumibol Memorial Day',
    icon: '🕯️',
    kind: 'holiday',
    windows: yearly('10-13').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
  {
    id: 'chulalongkorn_day',
    name: 'Chulalongkorn Day',
    icon: '👑',
    kind: 'holiday',
    windows: yearly('10-23').filter((w) => w.from >= '2027'),
    where: 'Citywide',
    catDemand: HOLIDAY,
    flavour: 'A public holiday: schools and offices are shut.',
    drivers: 'Fewer school and office runs, a few more day-trippers.',
    source: 'calendar.md §6 [bot-2026]',
  },
];
