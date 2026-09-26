// Colours for buildings, temples and landmarks (docs/3d/world.md §3.1): faded
// shophouse pastels, shutters, signs and awnings, roof tiles and metal, Lanna
// temple gold, lacquer and tile, brick and laterite.
import { hex, type RGB } from './mesh';

export const BC = {
  // Detail
  shutterGrey: hex('#9da3a6'),
  shutterBlue: hex('#5d86a8'),
  shutterMint: hex('#8fbfae'),
  grilleWhite: hex('#eeeeee'),
  grilleGreen: hex('#3e7a5c'),
  grilleBrown: hex('#6a4a33'),
  glassDark: hex('#2f4a55'),
  glassTeal: hex('#5f9ea0'),
  glassBlue: hex('#3d5f73'),
  glassNight: hex('#26343b'),
  acUnit: hex('#e9e7e1'),
  tankSteel: hex('#c9cdd0'),
  tankBlue: hex('#3f78b5'),
  tankBeige: hex('#d9c7a2'),
  steelDark: hex('#3b3d3f'),
  concrete: hex('#bdb7ab'),
  concreteDark: hex('#8f8a80'),
  slab: hex('#d9d4c8'),
  interiorWarm: hex('#8a735a'),
  interiorCool: hex('#7d8a8f'),
  interiorDark: hex('#4a3f36'),
  stoolRed: hex('#c8312b'),
  plant: hex('#4f7f3a'),
  plantLight: hex('#6f9f45'),
  pot: hex('#b0643e'),
  laundry: [hex('#e8e2d0'), hex('#d9534f'), hex('#5b8fd1'), hex('#f0c330'), hex('#f2f2f2')] as RGB[],
  // Timber
  teak: hex('#6b4428'),
  teakDark: hex('#5a3a22'),
  teakGrey: hex('#8d8478'),
  shutterTeal: hex('#5f8f86'),
  shutterGreen: hex('#6f9a6a'),
  // Roofs
  tileTerracotta: hex('#c2562f'),
  tileBrick: hex('#9e3b2a'),
  tileBrown: hex('#6e4430'),
  tileGrey: hex('#6f7478'),
  tileBlueGrey: hex('#5a7185'),
  tileGreen: hex('#4f7a55'),
  zinc: hex('#a4acb0'),
  rust: hex('#a0532e'),
  metalBlue: hex('#4c78a8'),
  metalRed: hex('#b4452f'),
  roofConcrete: hex('#b8b2a8'),
  pool: hex('#3fc1d4'),
  // Temple
  gold: hex('#d8a431'),
  goldLit: hex('#ffcf5a'),
  goldDark: hex('#a67a1e'),
  lacquerRed: hex('#8f1f24'),
  lacquerBlack: hex('#231815'),
  templeWhite: hex('#f4f0e6'),
  templePlinth: hex('#e2dccd'),
  roofOrange: hex('#c9582b'),
  roofRed: hex('#9b2f25'),
  borderGreen: hex('#2f6e4a'),
  mosaicTeal: hex('#3aa39a'),
  mosaicBlue: hex('#2e5fa8'),
  nagaGreen: hex('#3f8f4f'),
  silver: hex('#cfd4da'),
  silverDark: hex('#9aa2ab'),
  weathered: hex('#cfcabd'),
  stucco: hex('#e8e0cf'),
  // Brick
  brickOld: hex('#9a4a2c'),
  brickNew: hex('#c0623a'),
  brickRuin: hex('#8f5d43'),
  laterite: hex('#a9744f'),
  chediLuang: hex('#9b6b4f'),
  chediLuangTan: hex('#b79f7b'),
  lichen: hex('#5f5a4a'),
  moss: hex('#66733f'),
  mortar: hex('#d8c3a2'),
  doorGrey: hex('#8d8478'),
  bronze: hex('#5a4630'),
  // Lights (glow layer)
  neonPink: hex('#ff4fa3'),
  neonCyan: hex('#3ff0ff'),
  neonGreen: hex('#6dff6a'),
  neonAmber: hex('#ffb13b'),
  bulb: hex('#ffcf7a'),
  lampWarm: hex('#ffd28a'),
  glare: hex('#eaf6ff'),
  lanternRed: hex('#e8322a'),
};

/** Sign-band colours per shop bay (unbranded). */
export const SIGN_COLOURS: RGB[] = ['#2f6db5', '#c8312b', '#f0c330', '#2e8b57', '#f28c28', '#ffffff', '#7b2d8b', '#1f3f7a', '#e8e0cf', '#d9534f'].map(hex);

/** Script-like stripes painted on signs. */
export const SIGN_INK: RGB[] = ['#ffffff', '#1e1e1e', '#c8312b', '#f0c330', '#1f3f7a'].map(hex);

/** Awning canvas and corrugated sheet colours. */
export const AWNINGS: [RGB, number][] = [
  [hex('#2f6db5'), 4],
  [hex('#c8312b'), 3],
  [hex('#2e8b57'), 3],
  [hex('#f28c28'), 2],
  [hex('#f0c330'), 1],
  [hex('#e9e4d8'), 2],
  [hex('#a4acb0'), 3],
  [hex('#a0532e'), 2],
];

/** Low-pitched tin and tile roofs for houses and small blocks. */
export const HOUSE_ROOFS: [RGB, number][] = [
  [hex('#c2562f'), 6],
  [hex('#9e3b2a'), 3],
  [hex('#6e4430'), 3],
  [hex('#6f7478'), 3],
  [hex('#5a7185'), 3],
  [hex('#4f7a55'), 2],
  [hex('#a4acb0'), 2],
];

export const METAL_ROOFS: [RGB, number][] = [
  [hex('#a4acb0'), 5],
  [hex('#4c78a8'), 3],
  [hex('#a0532e'), 2],
  [hex('#b4452f'), 2],
  [hex('#8f969a'), 3],
];

/** House walls: cream and white, a few pastels. */
export const HOUSE_WALLS: [RGB, number][] = [
  [hex('#efe4c9'), 10],
  [hex('#f3f0e8'), 10],
  [hex('#e9dcc0'), 5],
  [hex('#f2e2b8'), 3],
  [hex('#d9e3d0'), 2],
  [hex('#e8c9a8'), 2],
];

/** Neon colours for bar signs. */
export const NEON: RGB[] = ['#ff4fa3', '#3ff0ff', '#6dff6a', '#ffb13b', '#b26bff', '#ff5a3c'].map(hex);
