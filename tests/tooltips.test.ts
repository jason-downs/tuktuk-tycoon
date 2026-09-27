// Where a control's tooltip goes (ui/Tooltips.tsx placeTip).
import { describe, expect, it } from 'vitest';
import { placeTip, type TipRect } from '../src/ui/Tooltips';

const rect = (left: number, top: number, right: number, bottom: number): TipRect => ({ left, top, right, bottom });
const mid = (r: TipRect) => (r.left + r.right) / 2;

describe('tooltip placement', () => {
  it('hangs centred under a top-bar button', () => {
    const garage = rect(109, 64, 147, 98);
    const p = placeTip(garage, 62, 32, 846, 998);
    expect(p.below).toBe(true);
    expect(p.top).toBeGreaterThan(garage.bottom);
    expect(p.left + 31).toBeCloseTo(mid(garage), 5);
    expect(p.left + p.arrowAt).toBeCloseTo(mid(garage), 5);
  });

  it('stays inside the window at its right edge, its arrow still on the button', () => {
    const menu = rect(754, 20, 780, 52);
    const w = 255;
    const p = placeTip(menu, w, 67, 846, 998);
    expect(p.left + w).toBeLessThanOrEqual(846 - 8);
    expect(p.left + p.arrowAt).toBeCloseTo(mid(menu), 5);
  });

  it('goes over a control near the bottom of the window', () => {
    const autopilot = rect(120, 470, 136, 486);
    const p = placeTip(autopilot, 200, 50, 846, 514);
    expect(p.below).toBe(false);
    expect(p.top + 50).toBeLessThan(autopilot.top);
  });
});
