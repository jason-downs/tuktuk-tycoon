// Tuk-tuk models. Prices from docs/research/economics.md §4 and "Suggested game
// numbers" (THB, 2025–2026): rusty used LPG with plate 150k, good used LPG 200k,
// used EV 210k, new EV 290k (Thai King list price incl. battery + registration),
// 7-seat EV ~320k (unverified). Breakdown rates: LPG ≈4 %/day, EV ≈1 %/day.

export type Powertrain = 'lpg' | 'ev';

export interface VehicleModel {
  id: string;
  name: string;
  powertrain: Powertrain;
  price: number;
  /** Multiplier on road cruising speed. */
  speed: number;
  seats: number;
  /** Range on a full tank/battery, km. */
  rangeKm: number;
  /** Breakdown chance per in-service day at full condition. */
  breakdownPerDay: number;
  /** Can it make the Doi Suthep climb? (economics.md: LPG tuk-tuks "can't climb"). */
  climbs: boolean;
  /** Set on EV conversions made in the garage: the LPG model this one was converted from. Not sold new. */
  convertedFrom?: string;
  blurb: string;
}

export const VEHICLE_MODELS: Record<string, VehicleModel> = {
  rusty: {
    id: 'rusty',
    name: 'Tired LPG tuk-tuk',
    powertrain: 'lpg',
    price: 150_000,
    speed: 0.9,
    seats: 3,
    rangeKm: 140,
    breakdownPerDay: 0.05,
    climbs: false,
    blurb: 'Fifteen years on the Tha Phae Gate rank. Coughs on cold mornings.',
  },
  lpg_used: {
    id: 'lpg_used',
    name: 'Good used LPG tuk-tuk',
    powertrain: 'lpg',
    price: 200_000,
    speed: 1,
    seats: 3,
    rangeKm: 160,
    breakdownPerDay: 0.035,
    climbs: false,
    blurb: 'Rebuilt engine, fresh vinyl, yellow plate included.',
  },
  ev_used: {
    id: 'ev_used',
    name: 'Used electric tuk-tuk',
    powertrain: 'ev',
    price: 210_000,
    speed: 1,
    seats: 3,
    rangeKm: 90,
    breakdownPerDay: 0.012,
    climbs: true,
    blurb: 'Ex-Bangkok fleet EV. Quiet, cheap to run, needs a charge each day.',
  },
  ev_new: {
    id: 'ev_new',
    name: 'New electric tuk-tuk',
    powertrain: 'ev',
    price: 290_000,
    speed: 1.08,
    seats: 3,
    rangeKm: 120,
    breakdownPerDay: 0.008,
    climbs: true,
    blurb: 'Thai-built, 6 kW motor, 120 km range. Tourists love the silence.',
  },
  ev_7seat: {
    id: 'ev_7seat',
    name: '7-seat electric tuk-tuk',
    powertrain: 'ev',
    price: 320_000,
    speed: 1.02,
    seats: 7,
    rangeKm: 110,
    breakdownPerDay: 0.01,
    climbs: true,
    blurb: 'Stretch body for families and tour groups.',
  },
  // EV conversions of the LPG models, made by the garage's 200,000 THB conversion kit (economics.md
  // "Suggested game numbers"). price = model price + kit. Range and breakdowns follow the used EV;
  // the tired body keeps a higher breakdown rate [pacing].
  rusty_ev: {
    id: 'rusty_ev',
    name: 'Converted EV tuk-tuk (tired body)',
    powertrain: 'ev',
    price: 350_000,
    speed: 0.95,
    seats: 3,
    rangeKm: 90,
    breakdownPerDay: 0.02,
    climbs: true,
    convertedFrom: 'rusty',
    blurb: 'Same dented tub, new silent motor. It even makes it up Doi Suthep.',
  },
  lpg_used_ev: {
    id: 'lpg_used_ev',
    name: 'Converted EV tuk-tuk',
    powertrain: 'ev',
    price: 400_000,
    speed: 1.02,
    seats: 3,
    rangeKm: 100,
    breakdownPerDay: 0.012,
    climbs: true,
    convertedFrom: 'lpg_used',
    blurb: 'A good LPG tuk-tuk given a 72 V battery pack and hub motor.',
  },
};
