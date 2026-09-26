import { describe, expect, it } from 'vitest';
import { CONTROL_WEIGHT, dockedOverPad, GAP, placeCoach, type Placement, type Rect } from '../src/ui/tutorial/coachPlacement';

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

  it('keeps pointing at a top-bar button, sliding sideways past the GPS line (1280×800, panels step in Drive)', () => {
    const w = 300;
    const h = 399;
    const nav = rect(834, 19, 1117, 91);
    const gps = rect(434, 152, 846, 241);
    const badge = rect(584, 109, 696, 146);
    const cards = { ...rect(10, 117, 310, 368), weight: CONTROL_WEIGHT };
    const p = placeCoach({ vw: 1280, vh: 800, w, h, floor: 105, anchor: nav, below: true, stackRight: 310, avoid: [gps, badge, cards] });
    expect(p.arrow).toBe('up');
    expect(p.top).toBe(105);
    expect(covers(p, w, h, gps)).toBe(0);
    // The pointer reaches the middle of the tabs.
    expect(p.left + p.arrowAt).toBeCloseTo((nav.left + nav.right) / 2, 0);
  });

  it('stays on its top-bar anchor rather than drifting under the GPS line (1280×800, manage step in Drive)', () => {
    const w = 300;
    const h = 280;
    const toggle = rect(440, 42, 536, 69);
    const gps = rect(434, 152, 846, 241);
    const badge = rect(584, 109, 696, 146);
    const cards = { ...rect(10, 117, 310, 368), weight: CONTROL_WEIGHT };
    for (const height of [h, 64]) {
      const p = placeCoach({ vw: 1280, vh: 800, w, h: height, floor: 105, anchor: toggle, below: true, stackRight: 310, avoid: [gps, badge, cards] });
      expect(p.arrow, `h ${height}`).toBe('up');
      expect(p.top, `h ${height}`).toBe(105);
      expect(p.left + p.arrowAt, `h ${height}`).toBeCloseTo((toggle.left + toggle.right) / 2, 0);
      // It never slides onto the cards, which hold the player's buttons.
      expect(covers(p, w, height, cards), `h ${height}`).toBe(0);
    }
  });

  it('spans the screen under the top bar on phones', () => {
    const p = placeCoach({ vw: 390, vh: 844, w: 374, h: 197, floor: 160, anchor: rect(6, 599, 384, 838), below: false, stackRight: 384, avoid: [] });
    expect(p).toMatchObject({ mobile: true, top: 160, arrow: 'none' });
  });

  it('on a phone, notices when the open card would reach over the touch pad (375×812)', () => {
    const p = placeCoach({ vw: 375, vh: 812, w: 359, h: 197, floor: 160, anchor: null, below: false, stackRight: 369, avoid: [] });
    // The pad stands on the player card alone: the open card ends above it.
    expect(dockedOverPad(p, 197, rect(173, 425, 363, 555))).toBe(false);
    // A passenger's card makes the sheet taller and lifts the pad under the open card.
    expect(dockedOverPad(p, 197, rect(173, 274, 363, 404))).toBe(true);
    // Tucked away, the card is one row and clears it.
    expect(dockedOverPad(p, 77, rect(173, 274, 363, 404))).toBe(false);
    // No pad without a touch screen.
    expect(dockedOverPad(p, 197, null)).toBe(false);
  });
});
