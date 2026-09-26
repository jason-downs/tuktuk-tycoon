// Pointer gestures on the 3D view. One pointer drags and taps (World3DView
// handles those); two pointers pinch: the change in the distance between them
// zooms the camera and their midpoint pans it. A pinch owns the gesture until
// every pointer has lifted, so the finger left behind neither drags nor taps.

export interface PinchStep {
  /** Multiply the camera distance by this: below 1 when the fingers spread (zoom in). */
  factor: number;
  /** The midpoint between the two fingers now and at the previous step, CSS px. */
  mid: { x: number; y: number };
  prevMid: { x: number; y: number };
  /** How far (px) the midpoint has moved since the pinch began. */
  travel: number;
}

export type PointerStart = 'single' | 'pinch' | 'extra';

export class PointerGestures {
  private readonly pts = new Map<number, { x: number; y: number }>();
  private spread = 0;
  private mid = { x: 0, y: 0 };
  private travel = 0;
  /** Two pointers went down together, and not all of them have lifted yet. */
  pinching = false;

  /** A pointer went down: the first one starts a drag, the second a pinch; more are ignored. */
  down(id: number, x: number, y: number): PointerStart {
    this.pts.set(id, { x, y });
    if (this.pts.size === 2) {
      this.pinching = true;
      this.travel = 0;
      this.measure();
      return 'pinch';
    }
    return this.pts.size === 1 && !this.pinching ? 'single' : 'extra';
  }

  /** A pointer moved. While two are down in a pinch, returns the zoom and pan for this step. */
  move(id: number, x: number, y: number): PinchStep | null {
    const p = this.pts.get(id);
    if (!p) return null;
    p.x = x;
    p.y = y;
    if (!this.pinching || this.pts.size < 2) return null;
    const prevSpread = this.spread;
    const prevMid = this.mid;
    this.measure();
    this.travel += Math.hypot(this.mid.x - prevMid.x, this.mid.y - prevMid.y);
    return { factor: this.spread > 0 && prevSpread > 0 ? prevSpread / this.spread : 1, mid: this.mid, prevMid, travel: this.travel };
  }

  /** A pointer lifted or was cancelled. Returns true if it belonged to a pinch, so its lift is not a tap or the end of a drag. */
  up(id: number): boolean {
    if (!this.pts.delete(id)) return this.pinching;
    const wasPinch = this.pinching;
    if (this.pts.size === 0) this.pinching = false;
    else if (this.pts.size >= 2) this.measure();
    return wasPinch;
  }

  /** Distance and midpoint of the first two pointers. */
  private measure(): void {
    const [a, b] = [...this.pts.values()];
    this.spread = Math.hypot(b.x - a.x, b.y - a.y);
    this.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
