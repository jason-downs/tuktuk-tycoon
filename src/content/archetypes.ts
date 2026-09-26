// Passenger archetypes, from docs/research/culture.md §4 (who rides and what
// they want) and §11a (dialogue). maxRatio is the highest multiple of the going
// street fare a passenger will accept; economics.md: tourists accept 1.0–1.5×,
// locals haggle hard at ~0.8×.

import type { Archetype, PlaceCategory } from '../sim/types';

export interface ArchetypeInfo {
  label: string;
  icon: string;
  color: string;
  /** Range the passenger's max acceptable fare ratio is drawn from. */
  maxRatio: [number, number];
  /** Chance of a tip on a fairly priced trip, and its size in THB. */
  tipChance: number;
  tip: [number, number];
  party: [number, number];
  /** How much this passenger values a fast ride (−1 hates speed … 1 loves it). */
  thrill: number;
  lines: string[];
}

export const ARCHETYPES: Record<Archetype, ArchetypeInfo> = {
  backpacker: {
    label: 'Backpacker',
    icon: '🎒',
    color: '#e0892b',
    maxRatio: [0.85, 1.2],
    tipChance: 0.08,
    tip: [10, 20],
    party: [1, 3],
    thrill: 0.8,
    lines: [
      'Sawatdee khrap! Tha Phae Gate — how much? Eighty? Paeng bpai… sixty?',
      "Our hostel's on a Moon Muang soi. The map says it's one-way the wrong way — is that why you're going round the whole moat?",
      'A guy at the gate said Wat Phra Singh is closed today and a ride to a gem shop is free. That’s… a scam, right?',
      'Sunday Walking Street, please — we want to get there before the road shuts.',
      'Loi Kroh Road, then the Night Bazaar. We’ve got one night left!',
    ],
  },
  tourist_cn: {
    label: 'Chinese tourist',
    icon: '📸',
    color: '#d6453d',
    maxRatio: [1.1, 1.7],
    tipChance: 0.12,
    tip: [20, 40],
    party: [2, 4],
    thrill: 0.1,
    lines: [
      'Nǐ hǎo! Chiang Mai University — the one from the film. Can we still go in and look around?',
      'Can I scan your QR with Alipay? It says they work now.',
      'Warorot Market — where they filmed the market chase!',
    ],
  },
  tourist_kr: {
    label: 'Korean tourist',
    icon: '☕',
    color: '#4a7bd0',
    maxRatio: [1.05, 1.5],
    tipChance: 0.15,
    tip: [20, 40],
    party: [1, 3],
    thrill: 0,
    lines: [
      'Annyeong-haseyo! One Nimman, please. We’re staying the whole month this time.',
      'Tee time is at seven. Can you come back at five-thirty? It’s still dark!',
    ],
  },
  tourist_west: {
    label: 'Western tourist',
    icon: '🧭',
    color: '#8a5cc2',
    maxRatio: [1.05, 1.6],
    tipChance: 0.25,
    tip: [20, 50],
    party: [1, 4],
    thrill: 0.4,
    lines: [
      'Hi! Wat Chedi Luang — is that the big ruined one? How much to get there?',
      'Take us somewhere for khao soi, then the Night Bazaar. We’re in your hands!',
      'Yin dee jao! Not a single tailor on the way. I’ll tell everyone at the hostel.',
    ],
  },
  retiree: {
    label: 'Retiree',
    icon: '🧓',
    color: '#6d8b5e',
    maxRatio: [1.0, 1.3],
    tipChance: 0.35,
    tip: [20, 40],
    party: [1, 2],
    thrill: -0.8,
    lines: [
      'Morning, phi. Same as Tuesday: over the river to Wat Ket, then Warorot for coffee.',
      'Take the river road, would you? No rush. Jai yen yen.',
      'My knees and that step don’t get on. Hold her steady while I climb in?',
    ],
  },
  nomad: {
    label: 'Digital nomad',
    icon: '💻',
    color: '#2e9c8f',
    maxRatio: [0.9, 1.15],
    tipChance: 0.1,
    tip: [10, 20],
    party: [1, 1],
    thrill: 0.3,
    lines: [
      'Nimman Soi 9, the café with the good wifi. My call starts in twelve minutes — please hurry!',
      'Grab says seventy baht. Match it and I’ll book you every morning.',
      'Is it true the smoke gets bad in March? Everyone’s telling me to go south.',
    ],
  },
  thai_tourist: {
    label: 'Thai visitor',
    icon: '🧣',
    color: '#c9a227',
    maxRatio: [0.9, 1.25],
    tipChance: 0.1,
    tip: [10, 20],
    party: [2, 4],
    thrill: 0.1,
    lines: [
      'Phi khrap, bpai Doi Suthep dai mai? Can this tuk-tuk actually make the climb?',
      'We drove up from Bangkok for the cold. Where’s the khao soi that’s lam khanat?',
      'Take us out to Bo Sang? My mother wants a painted umbrella.',
    ],
  },
  student: {
    label: 'CMU student',
    icon: '🎓',
    color: '#7f3fbf',
    maxRatio: [0.75, 1.0],
    tipChance: 0.03,
    tip: [5, 10],
    party: [1, 3],
    thrill: 0.6,
    lines: [
      'Phi, CMU front gate — go by Huay Kaew, mai pen rai if it’s slow.',
      'Three of us to Lang Mor night market. Student price, na?',
      'Exam at eight, I overslept! Go fast, please!',
    ],
  },
  vendor: {
    label: 'Market vendor',
    icon: '🧺',
    color: '#b5651d',
    maxRatio: [0.75, 0.95],
    tipChance: 0.05,
    tip: [5, 10],
    party: [1, 2],
    thrill: -0.2,
    lines: [
      'Sawatdee jao! Kad Luang, jao. Mind the flower baskets, they’re for Ton Lamyai.',
      'Two sacks of sticky rice and a cooler of sai ua. Tao dai jao?',
      'Pik ban, jao — back to Nong Hoi before the rain.',
    ],
  },
  monk: {
    label: 'Monk',
    icon: '🧡',
    color: '#e8871e',
    maxRatio: [0, 0.6],
    tipChance: 0,
    tip: [0, 0],
    party: [1, 2],
    thrill: -0.5,
    lines: ['Wat Suan Dok, please.', 'The monk nods, gathers his robe and takes the far end of the bench.'],
  },
  elder: {
    label: 'Local elder',
    icon: '👵',
    color: '#9c6b4e',
    maxRatio: [0.75, 1.0],
    tipChance: 0.1,
    tip: [10, 20],
    party: [1, 2],
    thrill: -0.9,
    lines: [
      'Ai, kin khao laew ka? No? Then take me to Fa Ham and I’ll show you real khao soi.',
      'Aew hue muan noe — have fun, young one. And drive slowly.',
      'Ror moen bai moen ngao! I waited so long I nearly walked.',
      'Pi ma kan ki khon? Four of us, jao — and a durian. Sorry about the smell.',
    ],
  },
  business: {
    label: 'Business traveller',
    icon: '💼',
    color: '#34495e',
    maxRatio: [1.1, 1.6],
    tipChance: 0.2,
    tip: [20, 60],
    party: [1, 2],
    thrill: 0.2,
    lines: ['Airport, please — and quickly, my flight boards in an hour.', 'Central Festival, the convention hall. I’m late.'],
  },
};

/** Who hails a ride from each kind of place (relative weights). */
export const ORIGIN_MIX: Record<PlaceCategory, Partial<Record<Archetype, number>>> = {
  gate: { backpacker: 3, tourist_west: 3, tourist_cn: 2, tourist_kr: 1, thai_tourist: 2, elder: 0.5 },
  temple: { tourist_west: 2, tourist_cn: 2, thai_tourist: 2, monk: 1.2, elder: 1, backpacker: 1 },
  market: { vendor: 3, elder: 2, tourist_cn: 1.5, thai_tourist: 1.5, backpacker: 1, tourist_west: 1 },
  mall: { thai_tourist: 2, tourist_kr: 2, tourist_cn: 1.5, student: 1.5, nomad: 1, tourist_west: 1 },
  transport: { tourist_west: 2, thai_tourist: 3, tourist_cn: 2, tourist_kr: 2, backpacker: 2, business: 2 },
  university: { student: 6, tourist_cn: 1 },
  school: { student: 2, elder: 1 },
  hospital: { elder: 3, retiree: 2, thai_tourist: 0.5 },
  nightlife: { backpacker: 3, tourist_west: 3, nomad: 1, student: 1, tourist_kr: 0.5 },
  attraction: { tourist_west: 2, tourist_cn: 2, tourist_kr: 1.5, thai_tourist: 2, backpacker: 1 },
  museum: { tourist_west: 2, thai_tourist: 1.5, tourist_kr: 1, backpacker: 1 },
  viewpoint: { tourist_west: 2, tourist_kr: 1.5, thai_tourist: 1.5, retiree: 1 },
  park: { elder: 1.5, thai_tourist: 1.5, retiree: 1, student: 1 },
  hotel: { tourist_west: 3, tourist_cn: 2, tourist_kr: 2, thai_tourist: 2, business: 1.5, retiree: 0.5 },
  hostel: { backpacker: 6, tourist_west: 1 },
  cafe: { nomad: 4, tourist_kr: 2, student: 1, thai_tourist: 1 },
  restaurant: { tourist_west: 2, thai_tourist: 2, tourist_kr: 1, nomad: 1, elder: 1 },
  shop: { elder: 2, vendor: 1, retiree: 1, student: 1 },
  fuel: {},
  civic: { elder: 2, business: 1 },
};

/** Where each archetype likes to go (relative weights by destination category). */
export const DEST_AFFINITY: Record<Archetype, Partial<Record<PlaceCategory, number>>> = {
  backpacker: { hostel: 4, gate: 3, temple: 2, nightlife: 3, market: 2, attraction: 1.5, cafe: 1, transport: 1 },
  tourist_cn: { temple: 3, market: 3, university: 2, mall: 2, attraction: 2, hotel: 3, gate: 1.5, viewpoint: 1 },
  tourist_kr: { cafe: 3, mall: 3, hotel: 3, temple: 1.5, market: 1.5, attraction: 1, restaurant: 1.5 },
  tourist_west: { temple: 3, hotel: 3, market: 2, gate: 2, restaurant: 2, nightlife: 1.5, museum: 1.5, attraction: 1.5 },
  retiree: { market: 2, hospital: 2, restaurant: 2, cafe: 1.5, temple: 1, shop: 2, viewpoint: 1 },
  nomad: { cafe: 4, mall: 2, restaurant: 2, hostel: 1, hotel: 1, nightlife: 1 },
  thai_tourist: { temple: 3, cafe: 2, restaurant: 3, market: 2, attraction: 2, hotel: 2, transport: 1.5, mall: 1.5 },
  student: { university: 4, mall: 2, market: 2, cafe: 1.5, nightlife: 1.5, restaurant: 1 },
  vendor: { market: 6, shop: 1 },
  monk: { temple: 6, hospital: 2 },
  elder: { market: 3, temple: 3, hospital: 2, shop: 1.5, restaurant: 1 },
  business: { transport: 4, hotel: 3, mall: 2, civic: 1.5, restaurant: 1 },
};
