import { useId } from 'react';
import { PAINTS } from '../content/paints';

/**
 * Top-down tuk-tuk in a livery, facing right: the same shapes as the map sprite
 * (src/map/sprites.ts) as inline SVG, for garage swatches and vehicle cards.
 */
export function TukTukArt({ paint, className }: { paint: string; className?: string }) {
  const p = PAINTS[paint] ?? PAINTS.nakhon_blue;
  const sheen = `tt-sheen-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className={className} viewBox="-34 -24 68 48" role="img" aria-label={`${p.name} tuk-tuk`}>
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <ellipse cx="1" cy="3" rx="30" ry="17" fill="rgba(40, 25, 10, 0.28)" />
      <rect x="-24" y="-21" width="12" height="6" rx="2" fill="#1a1a1a" />
      <rect x="-24" y="15" width="12" height="6" rx="2" fill="#1a1a1a" />
      <rect x="20" y="-3" width="10" height="6" rx="2" fill="#1a1a1a" />
      <rect x="-21" y="-20" width="6" height="4" fill="#c0392b" />
      <rect x="-21" y="16" width="6" height="4" fill="#c0392b" />
      <path
        d="M-29,-15 L4,-15 Q18,-13 30,-6 Q34,0 30,6 Q18,13 4,15 L-29,15 Q-32,0 -29,-15 Z"
        fill={p.body}
        stroke="rgba(0, 0, 0, 0.35)"
        strokeWidth="1.2"
      />
      <path d="M-27,-12.5 L4,-12.5 Q17,-11 27,-5 M-27,12.5 L4,12.5 Q17,11 27,5" fill="none" stroke={p.trim} strokeWidth="1.6" />
      <rect x="-27" y="-13.5" width="37" height="27" rx="6" fill={p.canopy} />
      <rect x="-27" y="-13.5" width="37" height="27" rx="6" fill={`url(#${sheen})`} />
      <rect x="-25" y="-11.5" width="33" height="23" rx="5" fill="none" stroke={p.trim} strokeWidth="1.4" />
      <rect x="2" y="-4" width="6" height="8" rx="1.5" fill="#f4d03f" />
      <rect x="11" y="-8" width="5" height="16" rx="2" fill="rgba(170, 215, 240, 0.9)" />
      <circle cx="31" cy="0" r="2.6" fill="#fdf2c0" />
    </svg>
  );
}
