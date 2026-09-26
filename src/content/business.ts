// Company services, hotel partners, depots, tours, the bank loan and company
// ranks, shown in the Business panel. Fares and trip types come from
// docs/research/economics.md (§1 fares, §2 apps, §3 songthaew charters, §8
// commissions, "Suggested game numbers" trip catalogue); seasonality from
// calendar.md §1. Prices of company services are not in the research, so they
// are [pacing]: one tuk-tuk on autopilot makes about 140 trips and ฿10–14k net
// a game day (the headless day in tests/sim.test.ts prints it), and a busy fleet
// earns ฿6–7k a day per tuk-tuk.

import type { Archetype } from '../sim/types';
import { OFFMAP_TRIPS } from './offmap';

/** Bookings per game hour at a 1.0 time-of-day and season factor. */
type Rate = number;

export interface ServiceDef {
  id: string;
  name: string;
  icon: string;
  group: 'dispatch' | 'marketing' | 'tours' | 'contracts';
  blurb: string;
  /** One line saying what the player gets. */
  effect: string;
  /** Paid once when the service starts; it covers the first billing period of a running cost. */
  cost: number;
  /** Recurring charge, billed at the 04:00 rollover every `every` days after the start day. */
  running?: { amount: number; every: number };
  /** Paid for each completed ride the service brings in. */
  perRide?: number;
  /** Ledger category for the charges. */
  ledger: 'business' | 'marketing' | 'fees';
  /** Index into RANKS. */
  minRank?: number;
  minFleet?: number;
  minRep?: number;
  /** Other services that must be active first. */
  requires?: string[];
  /** Needs at least one fleet tuk-tuk that can climb Doi Suthep. */
  climbing?: boolean;
}

/** Fictional ride-hailing brand used in all player-facing text. */
export const APP_BRAND = 'TukGo';

export const SERVICES: ServiceDef[] = [
  {
    id: 'app',
    name: `${APP_BRAND} app partnership`,
    icon: '📱',
    group: 'dispatch',
    // [research] economics.md §2: app tuk-tuk fares are 80 THB + 12–15 THB/km fixed; Grab keeps 25 % of 4-wheel and
    // 15 % of 2-wheel fares. The 20 % cut is from economics.md "Suggested game numbers" (the platform keeps 20–25 %).
    blurb: `Sign your fleet up as ${APP_BRAND} drivers. Riders book in the app, the fare is fixed and nobody haggles.`,
    effect: `App riders near your working tuk-tuks book at a fixed ฿80 + ฿13/km; ${APP_BRAND} keeps 20 %. More tuk-tuks on shift and better stars bring more bookings.`,
    // [pacing] app fares net about what a haggled street fare does, so the gain is filling idle time: roughly ฿1k a
    // day with 5 tuk-tuks and ฿6k with 20. The fee pays back within days once a small fleet shares the bookings.
    cost: 12_000,
    ledger: 'business',
    minRank: 1,
    minFleet: 3,
    minRep: 4,
  },
  {
    id: 'radio',
    name: 'Dispatch radio & LINE group',
    icon: '📻',
    group: 'dispatch',
    blurb: 'Handsets for every tuk-tuk and a company LINE group. Whoever spots a waving passenger calls it in.',
    effect: 'Every driver on shift can take a street hail that any of your tuk-tuks can see.',
    // [pacing]
    cost: 8_000,
    ledger: 'business',
    minFleet: 2,
  },
  {
    id: 'flyers',
    name: 'Hostel flyers',
    icon: '📄',
    group: 'marketing',
    // [research] culture.md §4: backpackers stay around Moon Muang and the Old City hostels and haggle hard.
    blurb: 'Stacks of flyers on hostel desks around Moon Muang: “Fair price, no gem shops — call us!”',
    effect: 'Backpackers phone in rides from hostels at the going street rate, fixed. No haggling, happier riders.',
    // [pacing]
    cost: 1_400,
    running: { amount: 1_400, every: 7 },
    ledger: 'marketing',
    minFleet: 2,
  },
  {
    id: 'social_ads',
    name: 'Social media ads',
    icon: '📣',
    group: 'marketing',
    blurb: `Sponsored reels of lanterns and temples, with a “book us on ${APP_BRAND}” sticker.`,
    effect: `+50 % ${APP_BRAND} bookings.`,
    // [pacing]
    cost: 3_500,
    running: { amount: 3_500, every: 7 },
    ledger: 'marketing',
    requires: ['app'],
  },
  {
    id: 'concierge',
    name: 'Hotel concierge tips',
    icon: '🛎️',
    group: 'marketing',
    // [research] economics.md §8: drivers earn ~100 THB kickbacks per shop visit. Here the company pays the concierge
    // a smaller cut per guest sent [pacing].
    blurb: 'A weekly envelope for the concierges of the mid-range hotels, and a thank-you for every guest they send.',
    effect: 'Hotel desks all over town phone your drivers, and their guests trust your price more. Fares are still agreed at the kerb.',
    cost: 1_400,
    running: { amount: 1_400, every: 7 },
    perRide: 20,
    ledger: 'marketing',
    minRep: 4,
  },
  {
    id: 'tour_temples',
    name: 'Half-day temple loop',
    icon: '🛕',
    group: 'tours',
    // [research] economics.md trip catalogue: half-day temple loop 600 THB.
    blurb: 'Morning charters from hotels and hostels: Wat Phra Singh, Wat Chedi Luang, then out to Wat Suan Dok or Wat Umong.',
    effect: 'Tour bookings 07:00–11:00 at a fixed ฿600. The driver waits 25 min while the group explores.',
    // [pacing]
    cost: 6_000,
    ledger: 'business',
    minRank: 1,
  },
  {
    id: 'tour_food',
    name: 'Night food tour',
    icon: '🍢',
    group: 'tours',
    // [research] economics.md trip catalogue: hourly charter 250 THB/h; a three-hour evening is 750.
    // Dishes and stalls: culture.md §8 (khao soi, sai ua, the cowboy-hat lady's khao kha moo at Chang Phueak Gate).
    blurb: 'Khao soi, sai ua and khao kha moo across the night markets: Chang Phueak Gate, Chiang Mai Gate, the Night Bazaar.',
    effect: 'Tour bookings 17:30–20:00 at a fixed ฿750. The driver waits 25 min while the group eats.',
    // [pacing]
    cost: 7_000,
    ledger: 'business',
    minRank: 1,
  },
  {
    id: 'tour_suthep',
    name: 'Doi Suthep sunset run',
    icon: '🌄',
    group: 'tours',
    // [research] economics.md trip catalogue: Doi Suthep 400 return, locked for LPG tuk-tuks ("can't climb");
    // §3: a private round trip with waiting costs 300–500. 400 + 400 = 800 for the sunset charter.
    blurb: 'Up the mountain road to Wat Phra That Doi Suthep for sunset. LPG tuk-tuks can’t make the climb.',
    effect: `Tour bookings 15:00–17:00 at a fixed ฿800, offered to a tuk-tuk that can climb. The driver waits ${OFFMAP_TRIPS.wat_doi_suthep.waitMin} min at the top.`,
    // [pacing]
    cost: 15_000,
    ledger: 'business',
    minRank: 2,
    climbing: true,
  },
  {
    id: 'airport',
    name: 'Airport taxi-counter permit',
    icon: '✈️',
    group: 'contracts',
    // [research] economics.md §1: the CNX airport taxi counter charges a set fare of 160 THB into town.
    blurb: 'A desk in the CNX arrivals hall. Passengers pay the set fare at the counter and are walked out to your tuk-tuk.',
    effect: 'Most arrivals heading into town pay ฿160 at your counter instead of haggling at the kerb. Your drivers collect the set fare, and songthaews can’t poach them.',
    // [pacing] sized for ~25 counter fares a day with 10 tuk-tuks, each ~฿35 over a haggled airport fare.
    cost: 30_000,
    running: { amount: 9_000, every: 30 },
    ledger: 'fees',
    minRank: 2,
    minFleet: 5,
  },
];

export const SERVICE_BY_ID: Record<string, ServiceDef> = Object.fromEntries(SERVICES.map((s) => [s.id, s]));

export const SERVICE_GROUPS: { id: ServiceDef['group']; title: string }[] = [
  { id: 'dispatch', title: 'Dispatch' },
  { id: 'marketing', title: 'Marketing' },
  { id: 'tours', title: 'Tours' },
  { id: 'contracts', title: 'Contracts' },
];

/**
 * Booking rates of each company channel, rides per game hour at time-of-day and season factor 1. All [pacing]:
 * sized so a service brings a fleet of its minimum size a few extra rides an hour.
 */
export const RATES = {
  /** Per fleet tuk-tuk that can take a booking now: one with a driver, not off duty, broken down or at a depot. */
  appPerVehicle: 1.5,
  flyers: 3,
  concierge: 3,
  hotelLuxury: 1.5,
  hotelOther: 1,
} satisfies Record<string, Rate>;

/** App bookings scale with the tuk-tuks that can take them up to this many [pacing]. */
export const APP_FLEET_CAP = 40;
/** Social media ads multiply app bookings [pacing]. */
export const SOCIAL_ADS_BOOST = 1.5;
/** A concierge's guests accept quotes this much higher than a street hail would [pacing]. */
export const CONCIERGE_TRUST = 1.15;
/**
 * Hotel desks quote a premium over the street rate: [research] economics.md §1, the airport counter's set 160 THB
 * against 100–120 THB settled on the street for the same run is ≈1.4×.
 */
export const HOTEL_FARE_PREMIUM = 1.4;
/** [research] economics.md §1: airport taxi counter set fare. */
export const AIRPORT_FARE = 160;
/** Share of the passengers hailing at the terminal who buy a counter ticket once you hold the permit [pacing]. */
export const AIRPORT_COUNTER_SHARE = 0.8;
/** The counter sells rides into town; longer runs (estimated metres) are left to the taxi desk. */
export const AIRPORT_MAX_TRIP = 8_000;
export const AIRPORT_LANDMARK = 'cnx_airport';
/** Minutes a booked company passenger waits for pickup [pacing]; street hails wait 10–28. */
export const BOOKING_PATIENCE_MIN = 40;

// ------------------------------------------------------------------ hotels
export interface HotelTier {
  id: 'luxury' | 'five' | 'four';
  label: string;
  /** Monthly partnership fee [pacing]; the first month is paid on signing. */
  monthly: number;
  minRep: number;
  rate: Rate;
}

export const HOTEL_TIERS: Record<HotelTier['id'], HotelTier> = {
  luxury: { id: 'luxury', label: 'Luxury', monthly: 18_000, minRep: 4.4, rate: RATES.hotelLuxury },
  five: { id: 'five', label: '5★ hotel', monthly: 12_000, minRep: 4.3, rate: RATES.hotelLuxury },
  four: { id: 'four', label: '4★ hotel', monthly: 9_000, minRep: 4.2, rate: RATES.hotelOther },
};

/** Curated landmark hotels (docs/research/landmarks.md, the "hotel_area" entries that are single hotels). */
export const LUXURY_HOTELS = ['pillars_137', 'anantara', 'shangri_la', 'tamarind_village'];
/** Rank (index into RANKS) needed before hotels will sign. */
export const HOTEL_MIN_RANK = 2;
/** Days between hotel partnership bills. */
export const HOTEL_BILLING_DAYS = 30;

// ------------------------------------------------------------------ depots
export const DEPOT = {
  /** Shophouse deposit, paid once [pacing]. */
  deposit: 20_000,
  /** Daily shophouse rent [pacing]; the research notes have no shophouse rents. */
  rentPerDay: 800,
  /** Index into RANKS. */
  minRank: 2,
  /** Repairs cost this share with one depot [pacing]. */
  repairDiscount: 0.8,
  /** Repairs cost this share with `manyDepots` or more depots [pacing]. */
  repairDiscountMany: 0.7,
  /** Depots needed for the `repairDiscountMany` rate [pacing]. */
  manyDepots: 3,
  /** Off-duty tuk-tuks drive back to a depot this close (metres). */
  parkingRange: 9_000,
  /** A tuk-tuk this close to a depot (metres) is parked in it. */
  parkedRadius: 60,
} as const;

// ------------------------------------------------------------------- tours
export interface TourDef {
  id: string;
  /** Service id that sells this tour. */
  service: string;
  name: string;
  fare: number;
  /**
   * Game hours the driver waits at the final stop while the group looks around [pacing]: a game day holds far more
   * rides than a real one, so the wait is short enough that a tour beats an hour of street fares (~฿550). A tour whose
   * stop is an out-of-town round trip sets 0: that trip's own wait (OFFMAP_TRIPS waitMin) is the group's time there.
   */
  dwellHours: number;
  /** Landmark ids where the tour ends. */
  stops: string[];
  /** Hours of the day bookings come in. */
  from: number;
  to: number;
  rate: Rate;
  archetypes: Archetype[];
  climbs?: boolean;
  lines: string[];
}

export const TOURS: TourDef[] = [
  {
    id: 'temples',
    service: 'tour_temples',
    name: 'Temple loop',
    fare: 600,
    dwellHours: 0.4,
    stops: ['wat_umong', 'wat_suan_dok', 'wat_chedi_luang', 'wat_phra_singh', 'wat_chet_yot'],
    from: 7,
    to: 11,
    rate: 1.5,
    archetypes: ['tourist_west', 'tourist_cn', 'tourist_kr', 'retiree', 'thai_tourist'],
    lines: [
      'We booked the half-day temple loop. Shoes off, shoulders covered — we’re ready!',
      'Temple morning, please. Wat Umong has the tunnels, right?',
      'Our guidebook says three temples before lunch. Can we do four?',
    ],
  },
  {
    id: 'food',
    service: 'tour_food',
    name: 'Food tour',
    fare: 750,
    dwellHours: 0.4,
    stops: ['chang_phueak_market', 'chiang_mai_gate_market', 'night_bazaar', 'anusarn_market', 'kad_na_mor'],
    from: 17.5,
    to: 20,
    rate: 1.5,
    archetypes: ['backpacker', 'tourist_west', 'tourist_kr', 'nomad', 'thai_tourist'],
    lines: [
      'Food tour! We skipped lunch on purpose. Where is the khao soi?',
      'Our host says the cowboy-hat lady at Chang Phueak Gate does the best khao kha moo.',
      'Sai ua, then mango sticky rice, then more sai ua. That’s the plan.',
    ],
  },
  {
    id: 'suthep',
    service: 'tour_suthep',
    name: 'Sunset run',
    fare: 800,
    dwellHours: 0,
    stops: ['wat_doi_suthep'],
    from: 15,
    to: 17,
    rate: 1,
    archetypes: ['tourist_west', 'tourist_cn', 'tourist_kr', 'thai_tourist'],
    climbs: true,
    lines: [
      'Doi Suthep for sunset, please. Can your tuk-tuk really make it up the mountain?',
      'We want the golden chedi at golden hour. Three hundred steps — we’ll manage.',
    ],
  },
];

export const TOUR_BY_ID: Record<string, TourDef> = Object.fromEntries(TOURS.map((t) => [t.id, t]));

// ------------------------------------------------------------------- loans
export const LOAN = {
  /** Daily interest on the outstanding balance [pacing]: game days are compressed, so rates are per day. */
  dailyRate: 0.004,
  termDays: 30,
  /** Unsecured credit per reputation star above 3★ [pacing]. */
  unsecuredPerStar: 20_000,
  /** Share of the owned fleet's resale value the bank lends against [pacing]. */
  collateralShare: 0.5,
  /** Smallest loan the bank writes. */
  minAmount: 5_000,
  /** Added to the balance when an instalment is missed (share of the instalment). */
  lateFee: 0.1,
  /** 1★ reviews pushed into the reputation window for each missed instalment [pacing]. */
  missedReviews: 2,
} as const;

// ------------------------------------------------------------------- ranks
export interface RankDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  minFleet: number;
  /** Tuk-tuks the company owns or is buying on hire-purchase. */
  minOwned: number;
  minNetWorth: number;
}

/** Company ranks [pacing]: design.md targets a first owned tuk-tuk at 25–45 min, 5 tuk-tuks at ~1 h, 20+ at 2–3 h. */
export const RANKS: RankDef[] = [
  { id: 'driver', name: 'Driver', icon: '🛺', blurb: 'You rent Lung Daeng’s tuk-tuk and live fare to fare.', minFleet: 0, minOwned: 0, minNetWorth: -Infinity },
  { id: 'owner', name: 'Owner-driver', icon: '🔑', blurb: 'Your own yellow plate. Nobody takes a cut of your day.', minFleet: 1, minOwned: 1, minNetWorth: -Infinity },
  { id: 'boss', name: 'Fleet boss', icon: '🧢', blurb: 'A few tuk-tuks, a few drivers, and a phone that never stops.', minFleet: 3, minOwned: 1, minNetWorth: 150_000 },
  { id: 'company', name: 'Company', icon: '🏢', blurb: 'Depots, contracts and a name the hotels know.', minFleet: 8, minOwned: 3, minNetWorth: 600_000 },
  { id: 'tycoon', name: 'Lanna Tuk-Tuk Tycoon', icon: '👑', blurb: 'From Tha Phae Gate to Doi Suthep, the city rides with you.', minFleet: 20, minOwned: 10, minNetWorth: 2_000_000 },
];

/** [research] economics.md "Suggested game numbers": resale is 60 % of the purchase price, falling 5 % a year. */
export const RESALE = { share: 0.6, perYear: 0.05, floor: 0.2 } as const;
