/** What the UI needs from whichever view renders the world (3D city or flat map). */
export interface GameView {
  readonly kind: '3d' | 'map';
  /** Move the camera to a sim-space point; zoom follows web-map levels (16 ≈ street level). */
  flyTo(x: number, y: number, zoom?: number): void;
  destroy(): void;
  /** Screen position (CSS px within the view) of a sim point h metres above the ground, or null when off-camera. */
  screenPoint?(x: number, y: number, h?: number): { x: number; y: number } | null;
  /** The ground the camera shows, as corner points in sim metres (the minimap outlines it). */
  footprint?(): { x: number; y: number }[];
  /** Pause rendering while another view is shown, and resume it. */
  setActive?(active: boolean): void;
}
