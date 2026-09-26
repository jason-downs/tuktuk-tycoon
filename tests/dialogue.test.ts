import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../src/content/archetypes';
import { composeRequestLine, glossLine, haggleLine, isNarration, spokenName } from '../src/content/dialogue';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar, timeOf } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game, rushHour } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { Rng } from '../src/sim/rng';
import type { Archetype, Place } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const ARCHS = Object.keys(ARCHETYPES) as Archetype[];
const landmark = (id: string) => world.landmarks.find((l) => l.id === id)!;

/** Short names a line might use for a landmark, besides its spoken name. */
const EXTRA_ALIASES: Record<string, string[]> = {
  warorot_market: ['Warorot', 'Kad Luang'],
  cmu_main_gate: ['Chiang Mai University', 'CMU'],
  wat_doi_suthep: ['Doi Suthep'],
  loi_kroh_bars: ['Loi Kroh'],
  lang_mor_market: ['Lang Mor'],
  ton_lamyai: ['Ton Lamyai'],
  night_bazaar: ['Night Bazaar'],
  saturday_walking_street: ['Wua Lai'],
  central_festival: ['Central Festival'],
  one_nimman: ['One Nimman'],
  moon_muang_soi_7: ['Moon Muang Soi'],
  chang_phueak_bus: ['Chang Phueak bus'],
};

const plainName = (p: Place) => p.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
const ALIASES = world.landmarks.map((l) => ({
  place: l,
  names: [spokenName(l).replace(/^the /i, ''), plainName(l), ...(EXTRA_ALIASES[l.id] ?? [])].filter((n) => n.length >= 4),
}));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, name: string) => new RegExp(`(^|[^\\p{L}])${escapeRe(name)}([^\\p{L}]|$)`, 'iu').test(text);
const near = (a: Place, b: Place, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

/** Landmarks named in a line that are neither the origin, the destination, nor next door to either. */
function strayLandmarks(text: string, from: Place, to: Place): string[] {
  let rest = text;
  for (const n of [to.name, plainName(to), spokenName(to), from.name, plainName(from), spokenName(from)]) {
    rest = rest.replace(new RegExp(escapeRe(n), 'giu'), ' ');
  }
  const stray: string[] = [];
  for (const { place, names } of ALIASES) {
    if (near(place, to, 400) || near(place, from, 400)) continue;
    if (names.some((n) => mentions(rest, n))) stray.push(place.id);
  }
  return stray;
}

describe('passenger dialogue', () => {
  const game = Game.create(world, { seed: 11 });
  const rng = new Rng(99);

  /** Times spread over the year, including Yi Peng and Songkran evenings. */
  const TIMES = [
    timeOf(2026, 10, 2, 6.5),
    timeOf(2026, 10, 3, 9),
    timeOf(2026, 10, 5, 13),
    timeOf(2026, 10, 8, 17.5),
    timeOf(2026, 10, 24, 19),
    timeOf(2026, 11, 12, 23),
    timeOf(2027, 2, 10, 14),
    timeOf(2027, 3, 14, 11),
    timeOf(2027, 7, 3, 16),
  ];

  function sample(from: Place, to: Place, arch: Archetype, time: number) {
    game.state.time = time;
    return composeRequestLine(game, from, to, arch, calendar(time));
  }

  it('names the actual destination whenever a line is templated, and never a stray landmark', () => {
    const cases: [Place, Place, Archetype, number][] = [];
    // Every landmark as a destination for every archetype…
    for (const to of world.landmarks) {
      for (const arch of ARCHS) {
        const from = world.places[rng.int(0, world.places.length - 1)];
        if (from !== to) cases.push([from, to, arch, rng.pick(TIMES)]);
      }
    }
    // …plus random POI trips.
    for (let i = 0; i < 3000; i++) {
      const from = world.places[rng.int(0, world.places.length - 1)];
      const to = world.places[rng.int(0, world.places.length - 1)];
      if (from !== to && to.cat !== 'fuel') cases.push([from, to, rng.pick(ARCHS), rng.pick(TIMES)]);
    }
    let templated = 0;
    for (const [from, to, arch, time] of cases) {
      const line = sample(from, to, arch, time);
      // Some real names contain braces ("Caffè B{e}arista"), so look for unfilled tokens outside them.
      const withoutNames = [spokenName(to), spokenName(from)].reduce((t, n) => t.split(n).join(''), line.text);
      expect(withoutNames).not.toMatch(/\{\w+\}|undefined/);
      expect(line.text.length).toBeGreaterThan(3);
      if (line.templated) {
        templated++;
        expect(line.text.toLowerCase(), `${arch} → ${to.name}`).toContain(spokenName(to).toLowerCase());
      }
      expect(strayLandmarks(line.text, from, to), `${arch} ${from.name} → ${to.name}: ${line.text}`).toEqual([]);
    }
    // Most lines name where the passenger is going.
    expect(templated / cases.length).toBeGreaterThan(0.75);
  });

  it('uses place-specific research lines only for their place', () => {
    const warorot = landmark('warorot_market');
    const gate = landmark('tha_phae_gate');
    const nimman = landmark('one_nimman');
    let chase = 0;
    for (let i = 0; i < 200; i++) {
      if (/filmed the market chase/.test(sample(gate, warorot, 'tourist_cn', TIMES[i % TIMES.length]).text)) chase++;
      expect(sample(gate, nimman, 'tourist_cn', TIMES[i % TIMES.length]).text).not.toMatch(/Warorot|market chase/);
    }
    expect(chase).toBeGreaterThan(0);
  });

  it('speaks Kham Mueang for market vendors and narrates monks', () => {
    const from = landmark('warorot_market');
    const to = landmark('wat_phra_singh');
    const vendorLines = Array.from({ length: 60 }, (_, i) => sample(landmark('chiang_mai_gate'), landmark('somphet_market'), 'vendor', TIMES[i % 3]).text);
    expect(vendorLines.some((l) => /\b(jao|khrap)\b/i.test(l))).toBe(true);
    const monkLines = Array.from({ length: 60 }, (_, i) => sample(from, to, 'monk', TIMES[i % 3]).text);
    for (const l of monkLines) expect(isNarration(l) || l.toLowerCase().includes(spokenName(to).toLowerCase())).toBe(true);
    expect(monkLines.some(isNarration)).toBe(true);
  });

  it('fills haggle replies with the fare and keeps monks respectful', () => {
    const g = Game.create(world, { seed: 5 });
    const cal = calendar(g.state.time);
    const from = landmark('tha_phae_gate');
    const to = landmark('wat_chedi_luang');
    for (const arch of ARCHS) {
      const req = makeRequest(g, from, to, arch, 'street', cal);
      const counter = haggleLine(g, req, 'counter', 120);
      expect(counter).toContain('฿120');
      for (const mood of ['thanks', 'leave'] as const) expect(haggleLine(g, req, mood)).not.toMatch(/[{}]/);
      if (arch === 'monk') {
        expect(isNarration(counter)).toBe(true);
        expect(isNarration(haggleLine(g, req, 'leave'))).toBe(true);
        expect(haggleLine(g, req, 'merit')).toMatch(/merit/i);
      }
    }
  });

  it('grumbles about the traffic only in the weekday rush that slows it', () => {
    const from = landmark('tha_phae_gate');
    const to = landmark('wat_phra_singh');
    const grumbles = (time: number) => {
      let n = 0;
      for (let i = 0; i < 400; i++) if (/traffic always this bad/.test(sample(from, to, 'tourist_west', time).text)) n++;
      return n;
    };
    // Monday 2 Nov 2026: the evening rush is 16:00–18:00 (calendar.md §8).
    expect(grumbles(timeOf(2026, 10, 2, 17.25))).toBeGreaterThan(0);
    expect(grumbles(timeOf(2026, 10, 2, 18.25))).toBe(0);
    expect(rushHour(1, calendar(timeOf(2026, 10, 2, 17.25)))).toBe(0.6);
    expect(rushHour(1, calendar(timeOf(2026, 10, 2, 18.25)))).toBe(1);
  });

  it('glosses Thai and Kham Mueang words but not inside place names', () => {
    const segs = glossLine('Sawatdee jao! Pai song ti Kad Na Mor dai ko jao?', ['Kad Na Mor']);
    const glossed = segs.filter((s) => s.gloss).map((s) => s.text);
    expect(glossed).toEqual(['Sawatdee jao', 'Pai song ti', 'dai ko', 'jao']);
    expect(segs.map((s) => s.text).join('')).toBe('Sawatdee jao! Pai song ti Kad Na Mor dai ko jao?');
    expect(glossLine('Paeng bpai! ฿80?')[0]).toEqual({ text: 'Paeng bpai', gloss: 'too expensive!' });
  });
});
