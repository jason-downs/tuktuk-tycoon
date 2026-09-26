// What Lung Daeng says at each tutorial step. He is the old tuk-tuk owner the
// player rents from, a Chiang Mai man who drops Kham Mueang words (culture.md §5:
// pho = look, bo pen yang = no problem, jai yen yen = keep calm, aew hue muan
// noe = have fun out there). The rent and the 04:00 settlement come from
// src/sim/balance.ts; a day lasts 48 minutes at 1× (docs/design.md).

import type { TutorialStep } from '../sim/tutorial';

export interface CoachStep {
  title: string;
  /** Paragraphs. Tokens: {rent}, {fare}, {tip}, {rating}. */
  body: string[];
  /** Shown above the body after a passenger walked away. */
  lost?: string;
  /** Selector of the UI the card sits beside. */
  anchor?: string;
  /** Selector of the UI to highlight; defaults to the anchor. */
  highlight?: string;
  /** Put the card below the anchor; by default it sits to the anchor's right. */
  below?: boolean;
  /** Label of the card's button; steps without one advance on a game event. */
  action?: string;
  /** What the card is waiting for, on steps without a button. */
  waitFor?: string;
}

export const COACH: Record<TutorialStep, CoachStep> = {
  welcome: {
    title: 'Lung Daeng hands you the keys',
    body: [
      'Sawatdee khrap! I’m Lung Daeng. Here are the keys to my old tuk-tuk — tired, like me, but honest.',
      'Rent is ฿{rent} a day, settled at 04:00. Let’s earn it.',
    ],
    anchor: '.card.player',
    action: 'Let’s go',
  },
  select: {
    title: 'Find a passenger',
    body: [
      'Pho — look at the map! People waving near you want a ride. The ring round each one shows how long they’ll wait.',
      'Click a waving passenger to see where they’re going.',
    ],
    lost: 'They walked off. Bo pen yang — plenty more where they came from.',
    waitFor: 'Click a waving passenger',
  },
  pickup: {
    title: 'Pick them up',
    body: ['Their card shows the trip, the going rate and how long they’ll wait. Press Pick up and I’ll draw your route.'],
    anchor: '.card.request',
    waitFor: 'Press Pick up',
  },
  drive: {
    title: 'Drive to the kerb',
    body: [
      'Follow the pink line. Your tuk-tuk drives itself — or press M to take the handlebars.',
      'Jai yen yen: the moat roads are one-way, so the route may go the long way round.',
    ],
    anchor: '.card.player',
    waitFor: 'On the way to the passenger…',
  },
  haggle: {
    title: 'Name your price',
    body: [
      'The going rate is fair. Tourists often pay the Tourist price; locals haggle hard.',
      'Ask too much and they counter or walk off — and overcharged riders give fewer stars (★). Stars bring passengers back.',
    ],
    anchor: '.dialog.haggle',
    waitFor: 'Quote a fare',
  },
  dropoff: {
    title: 'Take them there',
    body: ['Deal! Drive to the pin. They pay when you arrive, then rate the ride.'],
    anchor: '.card.player',
    waitFor: 'On the way to the drop-off…',
  },
  paid: {
    title: 'Your first fare',
    body: [
      'You earned ฿{fare}{tip} and ★{rating}.',
      'Now watch the LPG bar on your card. When it runs low press ⛽ Refuel, or right-click a green ⛽ pump on the map. An empty tank means pushing her there!',
    ],
    anchor: '.card.player',
    action: 'Got it',
  },
  speed: {
    title: 'Time is yours',
    body: ['Use the speed buttons, or keys 1–5; Space pauses. A day passes in 48 minutes at 1×, and rent is due at 04:00.'],
    anchor: '.topbar .speed',
    below: true,
    action: 'Next',
  },
  autopilot: {
    title: 'Let her drive',
    body: [
      'Tired hands? Tick Autopilot on your card and she finds passengers and haggles at your company fare by herself.',
      'Untick it to drive again. Manual driving (M) and Autopilot can’t both be on.',
    ],
    anchor: '.card.player',
    highlight: '.card.player .toggle',
    action: 'Next',
  },
  panels: {
    title: 'Your office',
    body: ['One tuk-tuk is a job; a fleet is a business. These panels run your company — open a few:'],
    anchor: '.topbar .panels-nav',
    below: true,
    action: 'Done',
  },
  finish: {
    title: 'Aew hue muan noe!',
    body: [
      'That’s all an old man can teach you. Rent more tuk-tuks, hire drivers, and put your colours on every rank in town.',
      'Press ? any time for help. Aew hue muan noe — have fun out there!',
    ],
    action: 'Khop khun khrap!',
  },
};

/** What each management panel is for, in top-bar order (panels are registered by other modules). */
export const PANEL_TOUR: { id: string; blurb: string }[] = [
  { id: 'fleet', blurb: 'Every tuk-tuk you run and what it’s doing.' },
  { id: 'hire', blurb: 'Drivers looking for work, and tuk-tuks to rent or buy.' },
  { id: 'garage', blurb: 'Repairs, upgrades and paint.' },
  { id: 'business', blurb: 'Partnerships, permits, depots and loans.' },
  { id: 'goals', blurb: 'Targets, and rewards for reaching them.' },
  { id: 'finance', blurb: 'The daily ledger: where the money went.' },
  { id: 'calendar', blurb: 'Festivals, markets and holidays ahead.' },
];
