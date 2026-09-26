// Frame statistics overlay for the 3D view: frame time percentiles, draw
// calls and triangles. Shown with ?stats in the URL or the backtick key.

import type { WebGLRenderer } from 'three';

const WINDOW = 120;

export class FrameStats {
  private readonly el: HTMLDivElement;
  private readonly times: number[] = [];
  private last = performance.now();
  private shown: boolean;
  private lastText = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'frame-stats';
    container.appendChild(this.el);
    this.shown = new URLSearchParams(window.location.search).has('stats');
    this.el.style.display = this.shown ? 'block' : 'none';
  }

  toggle(): void {
    this.shown = !this.shown;
    this.el.style.display = this.shown ? 'block' : 'none';
  }

  /** Call once per rendered frame, after rendering. */
  record(now: number, renderer: WebGLRenderer): void {
    this.times.push(now - this.last);
    this.last = now;
    if (this.times.length > WINDOW) this.times.shift();
    if (!this.shown || now - this.lastText < 500) return;
    this.lastText = now;
    const sorted = [...this.times].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const info = renderer.info;
    this.el.textContent = `${(1000 / Math.max(1, p(0.5))).toFixed(0)} fps · p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · ${info.render.calls} draws · ${(info.render.triangles / 1000).toFixed(0)}k tris · ${info.memory.geometries} geos`;
  }

  /** Frame-time percentiles in ms, for automated checks. */
  summary(): { p50: number; p95: number } {
    const sorted = [...this.times].sort((a, b) => a - b);
    return { p50: sorted[Math.floor(0.5 * sorted.length)] ?? 0, p95: sorted[Math.floor(0.95 * sorted.length)] ?? 0 };
  }

  dispose(): void {
    this.el.remove();
  }
}
