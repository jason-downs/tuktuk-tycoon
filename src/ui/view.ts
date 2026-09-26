/** What the UI needs from whichever view renders the world (3D city or flat map). */
export interface GameView {
  readonly kind: '3d' | 'map';
  /** Move the camera to a sim-space point; zoom follows web-map levels (16 ≈ street level). */
  flyTo(x: number, y: number, zoom?: number): void;
  destroy(): void;
}
