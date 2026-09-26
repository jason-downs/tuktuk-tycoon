// Graphics quality presets for the 3D view (docs/3d/architecture.md §13):
// shadow map size, render pixel ratio and particle counts. The choice is kept
// per browser in localStorage; storage can be missing or throw (private
// windows, blocked site data), in which case the default applies.

export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualityPreset {
  shadowMapSize: number;
  /** Upper bound on the renderer's pixel ratio. */
  pixelRatio: number;
  rainStreaks: number;
  splashDrops: number;
  mistPuffs: number;
  krathongs: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { shadowMapSize: 1024, pixelRatio: 1, rainStreaks: 3000, splashDrops: 480, mistPuffs: 900, krathongs: 60 },
  medium: { shadowMapSize: 2048, pixelRatio: 1.5, rainStreaks: 7000, splashDrops: 1200, mistPuffs: 2400, krathongs: 140 },
  high: { shadowMapSize: 4096, pixelRatio: 2, rainStreaks: 12000, splashDrops: 2400, mistPuffs: 2400, krathongs: 240 },
};

export const DEFAULT_QUALITY: QualityLevel = 'medium';
const STORAGE_KEY = 'tuktuk.quality3d';

type Listener = (level: QualityLevel) => void;
const listeners = new Set<Listener>();
let current: QualityLevel | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): QualityLevel {
  try {
    const v = storage()?.getItem(STORAGE_KEY);
    return v && (QUALITY_LEVELS as string[]).includes(v) ? (v as QualityLevel) : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function qualityLevel(): QualityLevel {
  return (current ??= load());
}

export function qualityPreset(): QualityPreset {
  return QUALITY[qualityLevel()];
}

/** Change the quality level, remember it for this browser and tell listeners. */
export function setQuality(level: QualityLevel): void {
  if (!QUALITY[level] || level === qualityLevel()) return;
  current = level;
  try {
    storage()?.setItem(STORAGE_KEY, level);
  } catch {
    // Storage full or blocked: the level still applies for this session.
  }
  for (const l of listeners) l(level);
}

/** Subscribe to quality changes; returns the unsubscribe function. */
export function onQualityChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Pixel ratio the renderer should use: the device's, capped by the quality preset. */
export function renderPixelRatio(): number {
  const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(device, qualityPreset().pixelRatio);
}

/** Forget the cached level so the next read comes from storage again (tests). */
export function resetQualityCache(): void {
  current = null;
}
