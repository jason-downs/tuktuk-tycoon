// Per-vehicle upgrades bought at the garage. Comfort adds to trip ratings,
// speed multiplies cruising speed, sight extends how far away the driver
// notices hailing passengers.

export interface VehicleUpgrade {
  id: string;
  name: string;
  price: number;
  desc: string;
  speed?: number;
  comfort?: number;
  sight?: number;
  /** Multiplier on breakdown chance. */
  reliability?: number;
  /** Only for these powertrains (default: any). */
  powertrain?: 'lpg' | 'ev';
}

export const VEHICLE_UPGRADES: Record<string, VehicleUpgrade> = {
  malai: {
    id: 'malai',
    name: 'Jasmine phuang malai',
    price: 40,
    desc: 'A fresh garland on the mirror for Mae Yanang, goddess of journeys. Fewer breakdowns, they say.',
    reliability: 0.9,
  },
  cushions: {
    id: 'cushions',
    name: 'Padded bench cushions',
    price: 1_200,
    desc: 'Soft vinyl cushions. Passengers stop wincing over the speed bumps.',
    comfort: 0.15,
  },
  phone_mount: {
    id: 'phone_mount',
    name: 'Phone mount & data plan',
    price: 900,
    desc: 'Spot hails further away: friends at the rank text you where the crowds are.',
    sight: 1.25,
  },
  speaker: {
    id: 'speaker',
    name: 'Bluetooth sound system',
    price: 1_800,
    desc: 'Backpackers love a soundtrack. Retirees less so.',
    comfort: 0.1,
  },
  tyres: {
    id: 'tyres',
    name: 'New tyres',
    price: 3_200,
    desc: 'Grip on wet roads and a smoother ride.',
    speed: 1.03,
    comfort: 0.05,
    reliability: 0.9,
  },
  led: {
    id: 'led',
    name: 'LED party lights',
    price: 3_500,
    desc: 'Glowing canopy strips — the Nimman crowd will pay extra to arrive in style.',
    comfort: 0.15,
  },
  tune: {
    id: 'tune',
    name: 'Engine tune-up',
    price: 6_500,
    desc: 'New plugs, carb clean, LPG regulator service.',
    speed: 1.07,
    reliability: 0.75,
    powertrain: 'lpg',
  },
};
