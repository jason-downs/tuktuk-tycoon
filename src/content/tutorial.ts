// What Lung Daeng says at each tutorial step. He is the old tuk-tuk owner the
// player rents from, a Chiang Mai man who drops Kham Mueang words (culture.md §5:
// pho = look, bo pen yang = no problem, jai yen yen = keep calm, aew hue muan
// noe = have fun out there). The rent and the 04:00 settlement come from
// src/sim/balance.ts; the moat's one-way directions from culture.md §2.

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
  drive: {
    title: 'Take the handlebars',
    body: [
      'Hold W (or ↑) to go and S (or ↓) to brake. A and D pick your turn at the next junction — the arrow shows which way.',
      'The moat roads are one-way: the inner ring runs anticlockwise, the outer ring clockwise. Jai yen yen — the GPS knows the way round.',
    ],
    anchor: '.card.player',
    waitFor: 'Hold W to drive off',
  },
  find: {
    title: 'Find a passenger',
    body: [
      'Pho — people waving at the kerb want a ride; the ring round each one shows how long they’ll wait. Arrows at the screen edge and dots on the radar point to them.',
      'Pull up within 25 m, stop, and press E. Or click one and press Pick up to let the GPS drive you there.',
    ],
    lost: 'They walked off. Bo pen yang — plenty more where they came from.',
    waitFor: 'Stop beside a waving passenger and press E',
  },
  approach: {
    title: 'Pull up at the kerb',
    body: [
      'Follow the pink line. Stop within 25 m and press E and they’ll walk over — or let the GPS stop there for you.',
      'Red lights stop the traffic. You can run one by hand, but your passengers won’t love it, and now and then the police are watching.',
    ],
    anchor: '.card.player',
    waitFor: 'On the way to the passenger…',
  },
  haggle: {
    title: 'Name your price',
    body: [
      'The going rate is fair. Tourists often pay the Tourist price; locals haggle hard. Keys 1–4 pick a price, Enter quotes, Esc lets them go.',
      'Ask too much and they counter or walk off — and overcharged riders give fewer stars (★). Stars bring passengers back.',
    ],
    anchor: '.dialog.haggle',
    waitFor: 'Quote a fare',
  },
  dropoff: {
    title: 'Take them there',
    body: [
      'Deal! Drive to the pink pin; they pay when you arrive, then rate the ride.',
      'Tired hands? G hands the wheel to the GPS, and G or W takes it back.',
    ],
    anchor: '.card.player',
    waitFor: 'On the way to the drop-off…',
  },
  paid: {
    title: 'Your first fare',
    body: [
      'You earned ฿{fare}{tip} and ★{rating}.',
      'Now watch the LPG bar on your card. When it runs low, stop beside a ⛽ pump and press E, or press ⛽ Refuel and the GPS takes you to one. An empty tank means pushing her there!',
    ],
    anchor: '.card.player',
    action: 'Got it',
  },
  manage: {
    title: 'Drive now, manage later',
    body: [
      'One tuk-tuk is a job; a fleet is a business. Tab switches to Manage: your tuk-tuk drives itself, the speed buttons (1–5, Space pauses) run the clock, and you can dispatch any free tuk-tuk to a passenger.',
      'M opens the flat city map for planning. Tab again puts you back at the wheel.',
    ],
    anchor: '.topbar .mode-toggle',
    below: true,
    action: 'Next',
  },
  panels: {
    title: 'Your office',
    body: ['These panels run your company — open a few:'],
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
