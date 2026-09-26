import { describe, expect, it } from 'vitest';
import { GAP, placeCoach, type Placement, type Rect } from '../src/ui/tutorial/coachPlacement';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

function covers(p: Placement, w: number, h: number, r: Rect): number {
  const x = Math.min(p.left + w, r.right) - Math.max(p.left, r.left);
  const y = Math.min(p.top + h, r.bottom) - Math.max(p.top, r.top);
  return x > 0 && y > 0 ? x * y : 0;
}

// Rectangles measured in the running game at each window size.
describe('coach card placement', () => {
  it('stays beside the player card but clear of the GPS line and world badge (1280×800)', () => {
    const w = 300;
    const h = 261;
    const gps = rect(413, 152, 867, 240);
    const badge = rect(584, 112, 696, 149);
    const player = rect(10, 120, 310, 371);
    const p = placeCoach({ vw: 1280, vh: 800, w, h, floor: 108, anchor: player, below: false, stackRight: 310, avoid: [gps, badge] });
    expect(p.left).toBe(player.right + GAP);
    expect(p.arrow).toBe('left');
    expect(covers(p, w, h, gps)).toBe(0);
    expect(covers(p, w, h, badge)).toBe(0);
    expect(p.top + h).toBeLessThanOrEqual(800 - 8);
  });

  it('a free-standing step also keeps off the GPS line', () => {
    const w = 300;
    const h = 240;
    const gps = rect(413, 152, 867, 240);
    const p = placeCoach({ vw: 1280, vh: 800, w, h, floor: 108, anchor: null, below: false, stackRight: 310, avoid: [gps] });
    expect(p.left).toBe(310 + GAP);
    expect(covers(p, w, h, gps)).toBe(0);
  });

  it('sits above the haggle sheet, pointing down at it, when there is no room beside or below (1024×768)', () => {
    const w = 300;
    const h = 250;
    const sheet = rect(252, 380, 772, 754);
    const gps = rect(330, 159, 694, 247);
    const p = placeCoach({ vw: 1024, vh: 768, w, h, floor: 115, anchor: sheet, below: false, stackRight: 310, avoid: [gps] });
    expect(covers(p, w, h, sheet)).toBe(0);
    expect(p.arrow).toBe('down');
    expect(p.top + h).toBeLessThanOrEqual(sheet.top);
  });

  it('on a short window it may overlap the top of the sheet but never its fare picker or buttons (1100×700)', () => {
    const w = 300;
    const h = 229;
    const sheet = rect(290, 237, 810, 686);
    const presets = rect(309, 429, 791, 493);
    const buttons = rect(309, 599, 791, 644);
    const gps = rect(330, 152, 770, 223);
    const badge = rect(494, 112, 606, 149);
    const p = placeCoach({ vw: 1100, vh: 700, w, h, floor: 108, anchor: sheet, below: false, stackRight: 310, avoid: [gps, badge] });
    expect(covers(p, w, h, presets)).toBe(0);
    expect(covers(p, w, h, buttons)).toBe(0);
  });

  it('goes beside the sheet when the window is wide enough (1280×800)', () => {
    const sheet = rect(380, 337, 900, 786);
    const p = placeCoach({ vw: 1280, vh: 800, w: 300, h: 229, floor: 108, anchor: sheet, below: false, stackRight: 310, avoid: [] });
    expect(p.left).toBe(sheet.right + GAP);
    expect(p.arrow).toBe('left');
  });

  it('spans the screen under the top bar on phones', () => {
    const p = placeCoach({ vw: 390, vh: 844, w: 374, h: 197, floor: 160, anchor: rect(6, 599, 384, 838), below: false, stackRight: 384, avoid: [] });
    expect(p).toMatchObject({ mobile: true, top: 160, arrow: 'none' });
  });
});
