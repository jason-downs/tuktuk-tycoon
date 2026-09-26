// Per-vehicle upgrades bought at the garage (src/sim/garage.ts applies the rules).
// Flavour and several effects come from docs/research/culture.md §7 (decorations,
// beliefs, the Chiang Mai look) and §4 (who rides); prices from economics.md §5 and
// "Suggested game numbers" where a source exists, otherwise marked [pacing].
//
// Effects:
// - comfort adds to every trip rating (applied in dispatch.ts rateTrip);
// - fans / nightFans / nightlife / hubs add to ratings for particular passengers or
//   trips (applied by the garage system's rating modifier);
// - speed multiplies cruising speed, sight widens how far hails are noticed,
//   reliability multiplies the breakdown chance;
// - climbs lets an LPG tuk-tuk make the Doi Suthep climb (src/sim/mountain.ts);
// - rainproof marks the rain curtains for the garage UI. The weather system
//   (src/sim/weather.ts) and the Songkran splash rule (src/sim/events.ts) look
//   for the id 'rain_curtains' itself, so that id must not change.

import type { Archetype } from '../sim/types';

export interface VehicleUpgrade {
  id: string;
  name: string;
  icon: string;
  price: number;
  desc: string;
  speed?: number;
  comfort?: number;
  sight?: number;
  /** Multiplier on breakdown chance. */
  reliability?: number;
  /** Only for these powertrains (default: any). */
  powertrain?: 'lpg' | 'ev';
  /** Rating change from particular passengers at any hour. */
  fans?: Partial<Record<Archetype, number>>;
  /** Rating change from particular passengers on trips that start after dark. */
  nightFans?: Partial<Record<Archetype, number>>;
  /** Rating bonus on after-dark trips to or from nightlife. */
  nightlife?: number;
  /** Rating bonus on trips to or from the airport, bus or train stations. */
  hubs?: number;
  /** Lets an LPG tuk-tuk make the Doi Suthep climb. */
  climbs?: boolean;
  /** Keeps passengers dry in rain, storms and Songkran water fights. */
  rainproof?: boolean;
  /** Nothing drilled or wired, so it may go on Lung Daeng's rented tuk-tuk. */
  rentable?: boolean;
  /** Game hours off the road while it is fitted (0 or missing: fitted on the spot). */
  hours?: number;
}

export const VEHICLE_UPGRADES: Record<string, VehicleUpgrade> = {
  malai: {
    id: 'malai',
    name: 'Jasmine phuang malai',
    icon: '🌼',
    // [research] culture.md §7: sold in traffic for ~20 THB; an offering to Mae Yanang.
    price: 20,
    desc: 'A fresh garland on the mirror for Mae Yanang, goddess of journeys. Fewer breakdowns, they say.',
    reliability: 0.92, // [pacing] the belief made mechanical
    fans: { elder: 0.05, thai_tourist: 0.05 },
    rentable: true,
  },
  yant: {
    id: 'yant',
    name: 'Monk’s blessing (yant)',
    icon: '🙏',
    // [research] culture.md §7: a monk daubs a yant in gold leaf on the front ceiling. Donation [pacing].
    price: 500,
    desc: 'A monk blesses the tuk-tuk and daubs a yant in gold leaf on the ceiling. Lung Daeng approves.',
    reliability: 0.95,
    fans: { monk: 0.2, elder: 0.15, thai_tourist: 0.1, vendor: 0.05 },
    rentable: true,
  },
  cushions: {
    id: 'cushions',
    name: 'Padded bench cushions',
    icon: '🛋️',
    price: 1_200, // [pacing]
    desc: 'Soft vinyl cushions. Passengers stop wincing over the speed bumps.',
    comfort: 0.1,
    fans: { retiree: 0.15, elder: 0.15 },
    rentable: true,
  },
  phone_mount: {
    id: 'phone_mount',
    name: 'Phone mount & data plan',
    icon: '📱',
    price: 900, // [pacing]
    desc: 'Spot hails further away: friends at the rank text you where the crowds are.',
    sight: 1.25,
    rentable: true,
  },
  rain_curtains: {
    id: 'rain_curtains',
    name: 'Roll-down rain curtains',
    icon: '☔',
    // [research] culture.md §7: clear roll-down curtains are part of the Chiang Mai look. Price [pacing].
    price: 1_800,
    desc: 'Clear plastic curtains that roll down when the monsoon hits, or when Songkran water fights start. Nobody arrives soaked.',
    rainproof: true,
    hours: 1,
  },
  fans: {
    id: 'fans',
    name: 'Canopy fans & USB chargers',
    icon: '🌀',
    // [research] culture.md §7: a small fan in the cockpit is typical. Price [pacing].
    price: 1_600,
    desc: 'Two clip-on fans for the back bench and a USB socket for flat phones.',
    comfort: 0.05,
    fans: { nomad: 0.15, business: 0.1, tourist_kr: 0.05 },
    hours: 1,
  },
  qr_pay: {
    id: 'qr_pay',
    name: 'PromptPay & Alipay QR terminal',
    icon: '💳',
    // [research] culture.md §4: since 30 Oct 2025 Alipay/WeChat Pay scan Thai QR codes, but personal
    // PromptPay QRs may reject foreign apps, so a merchant terminal matters. Price [pacing].
    price: 1_500,
    desc: 'A merchant QR stand that takes PromptPay, Alipay and WeChat Pay. Chinese visitors no longer hunt for cash.',
    fans: { tourist_cn: 0.35, tourist_kr: 0.1, nomad: 0.1, business: 0.1 },
  },
  speaker: {
    id: 'speaker',
    name: 'Bluetooth sound system',
    icon: '🔊',
    // [research] culture.md §7: sound-system "party tuk-tuks". Price [pacing].
    price: 1_800,
    desc: 'Backpackers love a soundtrack. Retirees, elders and monks would rather you turned it off.',
    fans: { backpacker: 0.25, student: 0.2, tourist_west: 0.05, retiree: -0.25, elder: -0.25, monk: -0.3, business: -0.1 },
    nightlife: 0.1,
    hours: 1,
  },
  led: {
    id: 'led',
    name: 'LED party lights',
    icon: '💡',
    // [research] culture.md §7: LED party tuk-tuks and Chiang Mai night light tours. Price [pacing].
    price: 3_500,
    desc: 'Glowing canopy strips. After dark the Nimman and Loi Kroh crowd love them; older passengers squint.',
    nightFans: {
      backpacker: 0.3,
      student: 0.25,
      tourist_cn: 0.15,
      tourist_kr: 0.15,
      tourist_west: 0.15,
      thai_tourist: 0.15,
      retiree: -0.15,
      elder: -0.2,
      monk: -0.3,
    },
    nightlife: 0.2,
    hours: 2,
  },
  luggage_rack: {
    id: 'luggage_rack',
    name: 'Roof luggage rack',
    icon: '🧳',
    price: 2_200, // [pacing]
    desc: 'Chrome rails and straps on the canopy. Airport and bus-station runs stop being a game of Tetris.',
    hubs: 0.25,
    fans: { backpacker: 0.05 },
    hours: 1,
  },
  tyres: {
    id: 'tyres',
    name: 'New tyres',
    icon: '🛞',
    // Tyre prices were not found (economics.md §5, unverified). Price [pacing].
    price: 3_200,
    desc: 'Fresh 4.00-12 tyres: grip on wet roads and a smoother ride.',
    speed: 1.03,
    comfort: 0.05,
    reliability: 0.9,
    hours: 1,
  },
  tune: {
    id: 'tune',
    name: 'Engine tune-up',
    icon: '🔩',
    // [research] economics.md §5: oil, filters, plugs and valves are the LPG running costs. Price [pacing].
    price: 6_500,
    desc: 'New plugs, carb clean, LPG regulator service.',
    speed: 1.07,
    reliability: 0.75,
    powertrain: 'lpg',
    hours: 2,
  },
  mountain_gear: {
    id: 'mountain_gear',
    name: 'Mountain rebuild (engine & gearing)',
    icon: '⛰️',
    // [research] economics.md "Suggested game numbers": engine rebuild ≈25,000; LPG tuk-tuks can't climb
    // Doi Suthep without it. culture.md §7: mountain tuk-tuks are specially modified with a 650 cc engine.
    price: 25_000,
    desc: 'Rebuilt 650 cc engine, low first gear and uprated brakes. Enough to haul passengers up Doi Suthep.',
    reliability: 0.85,
    climbs: true,
    powertrain: 'lpg',
    hours: 8,
  },
};
